import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fullSheetPlate, locateSheetEdges, downloadIiifSheet, fitAffine, enhanceSheet, groundMetresPerSourcePixel } from './old-maps-source.mjs'

describe('scan stretch diagnostics', () => {
  it('measures the most stretched direction even when the raster never folds', () => {
    expect(groundMetresPerSourcePixel(1 / 6, 0, 0, -1 / 6)).toBeCloseTo(6)
    expect(groundMetresPerSourcePixel(1 / 6, 0, 0, -1 / 120)).toBeCloseTo(120)
  })
  it('detects shear and is unchanged by rotating the source axes', () => {
    const a = 0.2, b = 0.19, c = 0, d = -0.01, t = Math.PI / 3
    const before = groundMetresPerSourcePixel(a, b, c, d)
    const after = groundMetresPerSourcePixel(Math.cos(t) * a - Math.sin(t) * c, Math.cos(t) * b - Math.sin(t) * d, Math.sin(t) * a + Math.cos(t) * c, Math.sin(t) * b + Math.cos(t) * d)
    expect(before).toBeGreaterThan(100)
    expect(after).toBeCloseTo(before, 8)
    expect(groundMetresPerSourcePixel(1, 2, 2, 4)).toBe(Infinity)
    expect(groundMetresPerSourcePixel(NaN, 0, 0, 1)).toBe(Infinity)
  })
})

describe('affine registration', () => {
  it('recovers translation, rotation and scale and keeps grid midpoints straight', () => {
    const points = [[0, 0], [10, 0], [0, 10], [10, 10], [5, 8]]
      .map(([x, y]) => ({ x: x + 10000, y: y + 20000, val: 4 + 2 * x - 3 * y }))
    const f = fitAffine(points)
    expect(f(10003, 20004)).toBeCloseTo(-2, 8)
    expect(f(10005, 20005)).toBeCloseTo((f(10000, 20000) + f(10010, 20010)) / 2, 8)
  })
  it('retains measurable residuals instead of forcing noisy observations to match', () => {
    const f = fitAffine([{ x: 0, y: 0, val: 1 }, { x: 2, y: 0, val: 2 }, { x: 0, y: 2, val: 2 }, { x: 2, y: 2, val: 5 }])
    expect(f(0, 0)).toBeCloseTo(0.5)
    expect(f(2, 2)).toBeCloseTo(4.5)
  })
  it('rejects collinear and insufficient control points', () => {
    expect(() => fitAffine([{ x: 0, y: 0, val: 0 }])).toThrow('three')
    expect(() => fitAffine([0, 1, 2].map(x => ({ x, y: x, val: x })))).toThrow('Degenerate')
  })
})

const directories = []
function temporaryCache() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-macau-map-source-'))
  directories.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('mini-macau-map-source-')) throw new Error('Unexpected test directory')
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('conservative scan enhancement', () => {
  it('doubles both axes without overwriting the source or compounding on repeated builds', async () => {
    const cache = temporaryCache(), original = path.join(cache, 'original.png')
    const raw = Buffer.from(Array.from({ length: 7 * 9 * 3 }, (_, i) => (i * 41) % 256))
    await sharp(raw, { raw: { width: 7, height: 9, channels: 3 } }).png().toFile(original)
    const before = fs.readFileSync(original)
    const source = { file: 'enhanced.png', enhance: { scale: 2, sharpen: { sigma: 0.6, m1: 0.4, m2: 0.8 } } }
    const enhanced = await enhanceSheet(source, cache, original)
    const meta = await sharp(enhanced).metadata(), first = fs.readFileSync(enhanced)
    expect([meta.width, meta.height]).toEqual([14, 18])
    await enhanceSheet(source, cache, original)
    expect(fs.readFileSync(enhanced)).toEqual(first)
    expect(fs.readFileSync(original)).toEqual(before)
    await expect(enhanceSheet({ ...source, file: 'original.png' }, cache, original)).rejects.toThrow('preserve the original')
  })
})

describe('native IIIF sheet assembly', () => {
  const source = { url: 'https://example.test/iiif/sheet', file: 'sheet.png', iiif: { width: 5, height: 4, regionSize: 3 } }
  it('assembles edge regions at native coordinates and reuses the complete cache', async () => {
    const download = vi.fn(async (url, file) => {
      const [left, top, width, height] = url.split('/').at(-4).split(',').map(Number)
      await sharp({ create: { width, height, channels: 3, background: { r: left * 50, g: top * 50, b: 70 } } }).png().toFile(file)
    })
    const cache = temporaryCache()
    const file = await downloadIiifSheet(source, cache, download)
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([5, 4])
    const lastPixel = (3 * 5 + 4) * info.channels
    expect([...data.subarray(lastPixel, lastPixel + 3)]).toEqual([150, 150, 70])
    expect([...data.subarray(0, 3)]).toEqual([0, 0, 70])
    expect(download.mock.calls.map(([url]) => url)).toEqual([
      `${source.url}/0,0,3,3/full/0/native.jpg`, `${source.url}/3,0,2,3/full/0/native.jpg`,
      `${source.url}/0,3,3,1/full/0/native.jpg`, `${source.url}/3,3,2,1/full/0/native.jpg`,
    ])
    await downloadIiifSheet(source, cache, download)
    expect(download).toHaveBeenCalledTimes(4)
  })
  it('rejects a resized server response before publishing a sheet', async () => {
    const cache = temporaryCache()
    const download = async (_url, file) => sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).png().toFile(file)
    await expect(downloadIiifSheet(source, cache, download)).rejects.toThrow('IIIF region was resized')
    expect(fs.existsSync(path.join(cache, source.file))).toBe(false)
  })
  it('rejects an incorrectly sized cached sheet', async () => {
    const cache = temporaryCache()
    await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).png().toFile(path.join(cache, source.file))
    await expect(downloadIiifSheet(source, cache, vi.fn())).rejects.toThrow('Unexpected cached sheet size')
  })
  it('rejects invalid dimensions without starting downloads', async () => {
    await expect(downloadIiifSheet({ ...source, iiif: { ...source.iiif, regionSize: 0 } }, temporaryCache(), vi.fn())).rejects.toThrow('positive integers')
  })
})

describe('complete sheet rendering', () => {
  it('retains every native pixel and the registration origin at both resolutions', async () => {
    const width = 17, height = 23
    const raw = Buffer.from(Array.from({ length: width * height * 3 }, (_, i) => i % 256))
    const input = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer()
    const source = { registrationOrigin: [4, 7], shrink: 3 }
    const native = await fullSheetPlate(input, source, true)
    const preview = await fullSheetPlate(input, source)
    expect(native.data).toEqual(raw)
    expect([native.info.width, native.info.height]).toEqual([width, height])
    expect([preview.info.width, preview.info.height]).toEqual([6, 8])
    expect(preview.frame).toEqual(native.frame)
    for (const [u, v] of [[0, 0], [-4 / 3, -7 / 3], [4, 5]]) {
      for (const [axis, p] of [u, v].entries()) {
        const px = p * preview.scale + preview.offset[axis]
        expect((px + 0.5) * 3 - 0.5).toBeCloseTo(p * native.scale + native.offset[axis], 10)
      }
    }
  })
  it('locates full paper edges outside the fitted landmarks without replacing the curved registration', () => {
    const frame = { left: -10, right: 40, top: -20, bottom: 50 }
    const project = (x, y) => [3 * x + 0.04 * y * y + 12, -2 * y + 40]
    const edges = locateSheetEdges(project, frame, (u, v) => [(u - 12) / 3, (40 - v) / 2])
    expect(edges).toHaveLength(260)
    for (const [x, y] of edges) {
      const [u, v] = project(x, y)
      expect(Math.min(Math.abs(u + 10), Math.abs(u - 40), Math.abs(v + 20), Math.abs(v - 50))).toBeLessThan(0.001)
    }
    expect(edges[0][0]).toBeCloseTo((-10 - 12 - 0.04 * 30 ** 2) / 3, 8)
    expect(edges[0][1]).toBeCloseTo(30, 8)
  })
  it('refuses an unlocatable edge instead of silently truncating the image', () => {
    expect(() => locateSheetEdges(() => [0, 0], { left: -1, right: 1, top: -1, bottom: 1 }, () => [0, 0])).toThrow('Cannot locate full sheet edge')
  })
})
