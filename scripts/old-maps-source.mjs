import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

// Largest ground distance represented by one source-image pixel, from the
// ground-metres -> source-pixels Jacobian. A positive orientation alone cannot
// detect extreme stretching: both principal scales matter for scan readability.
export function groundMetresPerSourcePixel(a, b, c, d) {
  const det = Math.abs(a * d - b * c)
  if (!Number.isFinite(det) || det === 0) return Infinity
  const norm2 = a * a + b * b + c * c + d * d
  return Math.sqrt((norm2 + Math.sqrt(Math.max(0, norm2 * norm2 - 4 * det * det))) / 2) / det
}

// Deterministic scan enhancement. Keep the source intact and rebuild the
// derivative from it, so repeated builds cannot accumulate sharpening.
export async function enhanceSheet(source, cache, original) {
  const { scale, sharpen } = source.enhance
  if (scale !== 2) throw new Error('Scan enhancement supports only 2×')
  const target = path.join(cache, source.file)
  if (path.resolve(target) === path.resolve(original)) throw new Error('Enhancement must preserve the original scan')
  const { width, height } = await sharp(original).metadata()
  await sharp(original).resize(width * scale, height * scale, { kernel: 'lanczos3' })
    .sharpen(sharpen).png().toFile(target)
  return target
}

// Least-squares affine registration keeps a survey sheet's straight grid lines
// straight. Use centred coordinates to avoid cancellation at large pixel values.
export function fitAffine(points) {
  if (points.length < 3) throw new Error('Affine fit needs at least three points')
  const n = points.length
  const mx = points.reduce((s, p) => s + p.x, 0) / n
  const my = points.reduce((s, p) => s + p.y, 0) / n
  const mv = points.reduce((s, p) => s + p.val, 0) / n
  let xx = 0, xy = 0, yy = 0, xv = 0, yv = 0
  for (const p of points) {
    const x = p.x - mx, y = p.y - my, v = p.val - mv
    xx += x * x; xy += x * y; yy += y * y; xv += x * v; yv += y * v
  }
  const det = xx * yy - xy * xy
  if (!Number.isFinite(det) || det <= Number.EPSILON * Math.max(xx * yy, 1) * 32) throw new Error('Degenerate affine control points')
  const a = (xv * yy - yv * xy) / det, b = (yv * xx - xv * xy) / det
  const c = mv - a * mx - b * my
  const f = (x, y) => c + a * x + b * y
  // Same evaluator representation as the polynomial tail of fitTPS.
  f.points = []; f.weights = [c, a, b]
  return f
}

// Retain the entire scan, including paper margins, legends and insets. The
// registration origin is historical: keep the existing GCP/spline coordinates
// unchanged and translate only when sampling pixels from the complete sheet.
export async function fullSheetPlate(input, source, fullRes = false) {
  const { width, height } = await sharp(input).metadata()
  const k = source.shrink ?? 1, reduction = fullRes ? 1 : k
  const [left, top] = source.registrationOrigin
  let img = sharp(input)
  if (reduction > 1) {
    const paddedWidth = Math.ceil(width / reduction) * reduction
    const paddedHeight = Math.ceil(height / reduction) * reduction
    // Exact integer reduction preserves pixel centres without anisotropic rounding.
    // Sharp applies extend after resize within one pipeline: materialise the
    // padding first so it contributes to the exact reduction dimensions.
    const padded = await img.extend({ right: paddedWidth - width, bottom: paddedHeight - height, extendWith: 'copy' })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true })
    img = sharp(padded.data, { raw: padded.info })
      .resize(paddedWidth / reduction, paddedHeight / reduction, { kernel: 'lanczos3' })
  }
  const plate = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    ...plate,
    scale: k / reduction,
    offset: [(left + 0.5) / reduction - 0.5, (top + 0.5) / reduction - 0.5],
    // Bounds in unchanged registration pixels (the first/last source centres).
    frame: { left: -left / k, top: -top / k, right: (width - 1 - left) / k, bottom: (height - 1 - top) / k },
  }
}

// Trace all four sheet edges through the inverse registration so a fixed geographic
// margin cannot silently cut off restored paper. The affine seed is only a starting
// estimate; Newton solves the existing spline, including any coast adjustment.
export function locateSheetEdges(project, frame, seed) {
  const points = [], steps = 64
  for (let edge = 0; edge < 4; edge++) for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = edge < 2 ? frame.left + t * (frame.right - frame.left) : edge === 2 ? frame.left : frame.right
    const v = edge < 2 ? edge === 0 ? frame.top : frame.bottom : frame.top + t * (frame.bottom - frame.top)
    let [x, y] = seed(u, v)
    for (let n = 0; n < 80; n++) {
      const p = project(x, y), eu = p[0] - u, ev = p[1] - v
      if (Math.hypot(eu, ev) < 0.001) break
      const h = 0.001, ex = project(x + h, y), ey = project(x, y + h)
      const a = (ex[0] - p[0]) / h, b = (ey[0] - p[0]) / h
      const c = (ex[1] - p[1]) / h, d = (ey[1] - p[1]) / h, det = a * d - b * c
      if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break
      const dx = (d * eu - b * ev) / det, dy = (a * ev - c * eu) / det
      const damping = Math.max(1, Math.hypot(dx, dy))
      x -= dx / damping; y -= dy / damping
    }
    const p = project(x, y)
    if (![x, y, ...p].every(Number.isFinite) || Math.hypot(p[0] - u, p[1] - v) > 0.01) {
      throw new Error(`Cannot locate full sheet edge at ${u}, ${v}`)
    }
    points.push([x, y])
  }
  return points
}

// BNP caps individual IIIF responses at 5000 px. Assemble native-resolution
// regions without resampling, and cache a lossless sheet for the existing warp.
export async function downloadIiifSheet(source, cache, download) {
  const file = path.join(cache, source.file)
  const { width, height, regionSize = 4800 } = source.iiif
  if (![width, height, regionSize].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('IIIF dimensions and region size must be positive integers')
  }
  if (fs.existsSync(file)) {
    const meta = await sharp(file).metadata()
    if (meta.width !== width || meta.height !== height) throw new Error(`Unexpected cached sheet size: ${file}`)
    return file
  }
  const parts = []
  for (let top = 0; top < height; top += regionSize) {
    for (let left = 0; left < width; left += regionSize) {
      const w = Math.min(regionSize, width - left), h = Math.min(regionSize, height - top)
      const region = `${left},${top},${w},${h}`
      const part = path.join(cache, `${source.file}.${region}.jpg`)
      await download(`${source.url}/${region}/full/0/native.jpg`, part)
      const meta = await sharp(part).metadata()
      if (meta.width !== w || meta.height !== h) throw new Error(`IIIF region was resized: ${part}`)
      parts.push({ input: part, left, top })
      console.log(`   source region ${region}`)
    }
  }
  const temporary = `${file}.tmp.png`
  await sharp({ create: { width, height, channels: 3, background: '#fff' } })
    .composite(parts).png().toFile(temporary)
  fs.renameSync(temporary, file)
  return file
}
