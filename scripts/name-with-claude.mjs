#!/usr/bin/env node
// Auto-name raw / generically-named images in /intake using Claude vision — NO API key
// (spawns `claude -p`, which uses your Claude subscription). Renames each image to
// <slug>-<kind>.<ext> so `npm run ingest` can file it. Files already carrying a real
// <slug>-spine / <slug>-cover name are left untouched.
//
// kind (spine vs cover) is taken from a -spine/-cover suffix if present, else inferred
// from aspect ratio (a spine is tall + narrow).

import { readdir, rename, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const exec = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const intake = join(root, 'export')   // the tool's dedicated export folder
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const GENERIC = new Set(['book', 'untitled', 'image', 'img', 'export', 'photo', 'scan'])

function imageSize(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue }
      const m = buf[o + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) }
      o += 2 + buf.readUInt16BE(o + 2)
    }
  }
  return null
}

async function identify(path, kind) {
  const prompt = `Read the image file at ${path} . It is the ${kind === 'spine' ? 'spine' : 'front cover'} of a book. Identify the book. Respond with ONLY a compact JSON object and nothing else: {"title": "<title>", "author": "<author>"}`
  const { stdout } = await exec('claude', ['-p', prompt], { timeout: 150000, maxBuffer: 1 << 20 })
  const m = stdout.match(/\{[\s\S]*?\}/)
  if (!m) throw new Error('no JSON from claude')
  const obj = JSON.parse(m[0])
  if (!obj.title) throw new Error('no title returned')
  return obj
}

const files = (await readdir(intake).catch(() => [])).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
if (!files.length) { console.log('Nothing in /export — drop your exported/raw images there first.'); process.exit(0) }

let named = 0
for (const f of files) {
  const m = f.match(/^(.*)-(spine|cover)\.(png|jpe?g|webp)$/i)
  let base = m ? m[1] : null
  let kind = m ? m[2].toLowerCase() : null
  const ext = (m ? m[3] : f.split('.').pop()).toLowerCase()

  if (!kind) {  // infer spine vs cover from shape
    const sz = imageSize(await readFile(join(intake, f)))
    kind = sz && sz.w / sz.h < 0.4 ? 'spine' : 'cover'
  }
  const needsName = !base || GENERIC.has(base.toLowerCase()) || /^img[_-]?\d+/i.test(base) || /^\d+$/.test(base)
  if (!needsName) { console.log(`  · ${f} — already named, skipped`); continue }

  try {
    process.stdout.write(`  ⧗ identifying ${f} (${kind}) … `)
    const { title, author } = await identify(join(intake, f), kind)
    const target = `${slug(title)}-${kind}.${ext === 'jpeg' ? 'jpg' : ext}`
    await rename(join(intake, f), join(intake, target))
    console.log(`→ ${title}${author ? ' — ' + author : ''}  ⇒  ${target}`)
    named++
  } catch (e) {
    console.log(`✗ ${String(e.message).slice(0, 80)} (left as-is)`)
  }
}
console.log(`\nNamed ${named} file(s). Now run \`npm run ingest\` to file + sync (or use \`npm run intake\` to do it all).`)
