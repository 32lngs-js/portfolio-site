#!/usr/bin/env node
// Files prep-tool exports from /intake into the shelf.
//   <slug>-spine.<ext>  → /spines/<slug>.<ext>
//   <slug>-cover.<ext>  → /covers/<slug>.<ext>   (user-matched, same edition as the spine)
// Grouping is by the shared <slug>. Run `npm run ingest` (which then re-syncs).

import { readdir, rename, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const inbox = join(root, 'export'), spines = join(root, 'spines'), covers = join(root, 'covers')
await mkdir(inbox, { recursive: true }); await mkdir(spines, { recursive: true }); await mkdir(covers, { recursive: true })

const files = (await readdir(inbox).catch(() => [])).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
if (!files.length) { console.log('Nothing in /export. Export a pair from tools/prep.html into the export/ folder first.'); process.exit(0) }

const groups = {}
let moved = 0
for (const f of files) {
  const m = f.match(/^(.*)-(spine|cover)\.(png|jpe?g|webp)$/i)
  if (!m) { console.warn(`  ? skipped — name must be <slug>-spine.ext or <slug>-cover.ext: ${f}`); continue }
  const slug = m[1], kind = m[2].toLowerCase(), ext = m[3].toLowerCase() === 'jpeg' ? 'jpg' : m[3].toLowerCase()
  const dest = kind === 'spine' ? spines : covers
  await rename(join(inbox, f), join(dest, `${slug}.${ext}`))
  ;(groups[slug] = groups[slug] || []).push(kind)
  console.log(`  → ${f}  ⇒  ${kind === 'spine' ? 'spines' : 'covers'}/${slug}.${ext}`)
  moved++
}

console.log(`\nFiled ${moved} file(s) across ${Object.keys(groups).length} book(s).`)
for (const [slug, kinds] of Object.entries(groups)) {
  if (kinds.length < 2) console.log(`  ⚠ ${slug}: only the ${kinds[0]} — the matching ${kinds[0] === 'spine' ? 'cover' : 'spine'} is missing.`)
}
