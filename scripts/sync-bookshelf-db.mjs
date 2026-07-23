#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Sync the bookshelf from your Goodreads shelf + the mybookshelf.dev spine DB.
//
// This is the "real spines, synced with Goodreads" path. It:
//   1. Reads your Goodreads shelf via mybookshelf.dev's backend
//      (getgrbookshelf?userid=..&shelfname=..) → splits into found/unfound.
//   2. For FOUND books: downloads the community spine image from S3 and
//      SELF-HOSTS it under /spines/ (we don't hotlink their bucket).
//   3. For UNFOUND books: uses a local /spines/<slug>.* if you've added your
//      own scan (e.g. the-humans.png), else renders a CSS faux spine.
//   4. Writes books.js for bookshelf.js to render.
//
// Notes / honesty:
//   - The mybookshelf.dev API is undocumented (a public API is "in progress").
//     Treat this as a periodic pull, not a live runtime dependency.
//   - Coverage = whatever the community has uploaded. Re-run over time as it grows.
//   - Spine images are crowdsourced; quality varies. Drop your own scan into
//     /spines/<slug>.png to override any book (found or unfound).
//
// Usage:  node scripts/sync-bookshelf-db.mjs [goodreads_user_id] [shelf]
//   e.g.  node scripts/sync-bookshelf-db.mjs 38480050 read
// ─────────────────────────────────────────────────────────────────────────

import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const USER_ID = process.argv[2] || '38480050'
const SHELF = process.argv[3] || 'read'
const API = 'https://vi64h2xk34.execute-api.us-east-1.amazonaws.com/alpha'
const S3 = 'https://bookshelf-spines.s3.amazonaws.com/'
const SPINE_H = 208 // display height of a book in the shelf (px), matches CSS

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const spinesDir = join(root, 'spines')

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Minimal, dependency-free image dimensions for PNG/JPEG (what the DB serves).
function imageSize(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) // PNG
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  if (buf[0] === 0xff && buf[1] === 0xd8) { // JPEG: scan for SOF marker
    let o = 2
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue }
      const m = buf[o + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) }
      o += 2 + buf.readUInt16BE(o + 2)
    }
  }
  return null
}

// Deterministic faux-spine color for books with no image.
const fauxColor = (str) => {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  const hue = h % 360, sat = 52 + (h % 26), light = 30 + ((h >> 3) % 22)
  return { bg: `hsl(${hue} ${sat}% ${light}%)`, text: light < 55 ? '#ffffff' : '#111111' }
}

// width from a book's physical dimensions string ("6 x 1.48 x 9 inches")
const widthFromDims = (dims) => {
  if (!dims) return null
  const nums = dims.toLowerCase().split('x').map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n))
  if (nums.length < 2) return null
  const h = Math.max(...nums), thickness = Math.min(...nums)
  return Math.round(SPINE_H * (thickness / h))
}

const coversDir = join(root, 'covers')          // USER-matched covers (same edition as the spine)
const autoCoversDir = join(coversDir, 'auto')    // auto-fetched covers — NOT edition-verified

// stable base-lean per book (degrees), random-ish sign + magnitude 0.6–1.4
const tiltFor = (s) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  const mag = 0.6 + (h % 80) / 100
  return Math.round(((h >> 3) % 2 ? 1 : -1) * mag * 100) / 100
}

const coverMeta = (buf, path) => {
  const sz = imageSize(buf)
  return { path, coverW: sz ? Math.round(SPINE_H * (sz.w / sz.h)) : 150 }
}

// auto cover from OpenLibrary by ISBN — NOT edition-verified, so quarantined to /covers/auto
// and only ever used for faux-spine books (no real spine to mismatch).
async function fetchAutoCover(isbn, name) {
  if (!isbn) return null
  const clean = String(isbn).replace(/[^0-9Xx]/g, '')
  if (clean.length < 10) return null
  try {
    const r = await fetch(`https://covers.openlibrary.org/b/isbn/${clean}-L.jpg`)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 2500) return null                     // OpenLibrary's "missing" placeholder
    await writeFile(join(autoCoversDir, name + '.jpg'), buf)
    return coverMeta(buf, `/covers/auto/${name}.jpg`)
  } catch { return null }
}

async function main() {
  await mkdir(spinesDir, { recursive: true })
  await mkdir(autoCoversDir, { recursive: true })
  const localSpines = new Set((await readdir(spinesDir).catch(() => [])))
  const localFor = (title) => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
      const f = `${slug(title)}.${ext}`
      if (localSpines.has(f)) return `/spines/${f}`
    }
    return null
  }
  // user-matched covers only (top level of /covers, never /covers/auto)
  const userCovers = new Set((await readdir(coversDir).catch(() => [])).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)))
  const localCoverFor = async (title) => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
      const f = `${slug(title)}.${ext}`
      if (userCovers.has(f)) { try { return coverMeta(await readFile(join(coversDir, f)), `/covers/${f}`) } catch {} }
    }
    return null
  }
  const pending = []   // real spine, no edition-matched cover yet

  console.log(`Fetching shelf: user ${USER_ID}, shelf "${SHELF}"`)
  const res = await fetch(`${API}/getgrbookshelf?userid=${USER_ID}&shelfname=${encodeURIComponent(SHELF)}`)
  const data = await res.json()
  if (data.statusCode !== 200) { console.error('API error', data); process.exit(1) }
  const found = (data.body.found || []).map((a) => (Array.isArray(a) ? a[0] : a)).filter(Boolean)
  const unfound = data.body.unfound || []
  console.log(`Found ${found.length} real spines, ${unfound.length} without.`)

  const books = []

  // FOUND → download + self-host the real spine
  for (const b of found) {
    let w = null
    try {
      const img = await fetch(S3 + b.fileName)
      const buf = Buffer.from(await img.arrayBuffer())
      await writeFile(join(spinesDir, b.fileName), buf)
      const sz = imageSize(buf)
      if (sz) w = Math.round(SPINE_H * (sz.w / sz.h))
      console.log(`  ✓ ${b.title} (${b.fileName}${sz ? `, ${sz.w}x${sz.h}` : ''})`)
    } catch (e) {
      console.warn(`  ! failed to download ${b.fileName}: ${e.message}`)
    }
    if (!w) w = widthFromDims(b.dimensions) || 32
    w = Math.max(16, Math.min(150, w))
    // real spine → ONLY a user-matched cover (same edition); never an auto cover.
    const cov = await localCoverFor(b.title)
    if (!cov) pending.push(b.title)
    books.push({
      title: b.title, author: b.author, spine: `/spines/${b.fileName}`, w,
      spineColor: b.domColor || '#e5e5e5', coverColor: b.domColor || '#e5e5e5',
      cover: cov?.path, coverW: cov?.coverW, tilt: tiltFor(b.title + b.author),
    })
  }

  // UNFOUND → local spine override if present, else faux spine
  for (const b of unfound) {
    const tilt = tiltFor(b.title + b.author)
    const local = localFor(b.title)
    if (local) {
      // real spine → user-matched cover only
      const cov = await localCoverFor(b.title)
      if (!cov) pending.push(b.title)
      books.push({ title: b.title, author: b.author, spine: local, w: 26, cover: cov?.path, coverW: cov?.coverW, tilt })
      console.log(`  ◐ ${b.title} → local spine${cov ? ' + matched cover' : ' (cover pending)'}`)
      continue
    }
    // faux spine → any cover is fine (no real spine to mismatch): user cover, else auto
    const cov = (await localCoverFor(b.title)) || (await fetchAutoCover(b.isbn13 || b.isbn, slug(b.title)))
    const { bg, text } = fauxColor(b.title + b.author)
    const w = Math.max(24, Math.min(44, 22 + Math.round((b.title || '').length * 0.7)))
    books.push({ title: b.title, author: b.author, spineColor: bg, coverColor: bg, text, w, cover: cov?.path, coverW: cov?.coverW, tilt })
  }

  const realCount = books.filter((b) => b.spine).length
  const header = `// AUTO-GENERATED by scripts/sync-bookshelf-db.mjs on ${new Date().toISOString().slice(0, 10)}
// Source: Goodreads user ${USER_ID}, shelf "${SHELF}" + mybookshelf.dev spine DB.
// ${realCount} real spines (self-hosted in /spines/), ${books.length - realCount} faux.
// Re-run \`npm run sync:books\` to refresh. Drop your own scan at /spines/<slug>.png to override a book.
`
  const body = books.map((b) => '  ' + JSON.stringify(b)).join(',\n')
  await writeFile(join(root, 'books.js'), `${header}\nwindow.BOOKS = [\n${body},\n]\n`)
  console.log(`\nWrote books.js — ${books.length} books (${realCount} real, ${books.length - realCount} faux).`)
  if (pending.length) {
    console.log(`\n⚠ ${pending.length} real spine(s) need an edition-matched cover (drop /covers/<slug>.jpg from the SAME copy):`)
    pending.forEach((t) => console.log(`   · ${t}`))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
