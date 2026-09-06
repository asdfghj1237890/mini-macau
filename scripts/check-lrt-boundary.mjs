import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// Check filenames in Git and recognizable timetable records in static assets.
// This is a regression gate, not a guarantee against arbitrary encodings.
const forbiddenPath = /(?:^|\/)(?:trips-[^/]+\.json|generate_timetable\.py|TT_[^/]+\.(?:jpg|jpeg|png)|_check_trips\.py|_crop_helper\.py|_crop_hq_rows\.py|_ocr_batch\.py|_sync_taipa_dicts\.py|_win_ocr\.ps1)$|(?:^|\/)(?:timetable_images|timetable_verified|_lrt|lrt-data)\//i
const root = resolve(import.meta.dirname, '..')
const history = process.argv.includes('--history')
const args = history ? ['log', '--all', '--format=', '--name-only'] : ['ls-files']
const paths = execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const violations = new Set(paths.split(/\r?\n/).filter(path => forbiddenPath.test(path)))

if (!history) {
  const dist = resolve(root, process.argv[2] ?? 'dist')
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        scan(path)
      } else {
        const name = relative(dist, path).replaceAll('\\', '/')
        if (forbiddenPath.test(name)) violations.add(`static: ${name}`)
        if (/\.(?:js|json|map|html|txt)$/i.test(name)) {
          const text = readFileSync(path, 'utf8')
          // Matches JSON, minified object literals and JSON embedded in strings.
          if (/\barrivalMinutes(?:\\?["'])?\s*:\s*\d/.test(text)) {
            violations.add(`static timetable record: ${name}`)
          }
        }
      }
    }
  }
  scan(dist)
}

if (violations.size) {
  console.error(`LRT boundary check failed (${history ? 'local refs' : 'Git index/static assets'}):`)
  for (const path of [...violations].sort()) console.error(`  ${path}`)
  process.exitCode = 1
} else {
  console.log(`LRT boundary check passed (${history ? 'local refs' : 'Git index/static assets'}).`)
}
