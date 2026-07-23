// 3D leaning bookshelf — spine⇄cover flip on navigate, modelled on grizz.fyi.
//
// Each book is a real 3D object: the cover is the front face, the spine is a
// side face hinged on the left edge (right edge for manga). Navigating rotates
// the focused book from spine (rotateY 90°) to cover (rotateY 0°) and straightens
// its lean; neighbours stay leaning spines and reflow to make room.
//
// Data (window.BOOKS, see books.js). Per book:
//   spine / cover   image URLs (either may be absent → a faux face is drawn)
//   spineColor / coverColor / text   colors for faux faces
//   w / coverW      pixel widths at shelf height (auto-measured from images if absent)
//   tilt            base lean in degrees; manga: true → hinge on the right
(function () {
  const shelf = document.getElementById('shelf')
  const caption = document.getElementById('shelf-caption')
  if (!shelf || !Array.isArray(window.BOOKS)) return

  const H = 230                                   // book height (px)
  const EASE = 'cubic-bezier(.23,1,.32,1)'
  const DUR = 520                                 // ms
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

  shelf.classList.add('shelf3d')
  shelf.style.setProperty('--book-h', H + 'px')
  shelf.tabIndex = 0

  const fauxFace = (b, kind, width) => {
    const el = document.createElement('div')
    el.className = 'face-faux ' + kind
    if (width) el.style.width = width + 'px'
    el.style.background = (kind === 'cover' ? (b.coverColor || b.spineColor) : b.spineColor) || '#d9d9d6'
    el.style.color = b.text || '#111'
    el.innerHTML = kind === 'cover'
      ? `<span class="ff-title">${b.title}</span><span class="ff-author">${b.author}</span>`
      : `<span class="ff-spine-title">${b.title}</span><span class="ff-spine-author">${b.author}</span>`
    return el
  }

  const els = window.BOOKS.map((b, i) => {
    const book = document.createElement('div')
    book.className = 'book3d' + (b.manga ? ' manga' : '')
    book.dataset.i = i
    book.setAttribute('role', 'listitem')
    book.setAttribute('aria-label', `${b.title} by ${b.author}`)

    const inner = document.createElement('div')
    inner.className = 'book3d-inner'
    inner.style.transition = `transform ${DUR}ms ${EASE}`

    // FRONT face (cover) and SIDE face (spine)
    const cover = document.createElement('div'); cover.className = 'face face-cover'
    const spine = document.createElement('div'); spine.className = 'face face-spine'

    const st = { spineW: b.w || 30, coverW: b.coverW || 150 }

    if (b.cover) {
      const img = new Image(); img.src = b.cover; img.alt = ''
      img.onload = () => { st.coverW = Math.round(H * (img.naturalWidth / img.naturalHeight)); relayout() }
      img.onerror = () => cover.replaceChildren(fauxFace(b, 'cover', st.coverW))
      cover.appendChild(img)
    } else cover.appendChild(fauxFace(b, 'cover', st.coverW))

    if (b.spine) {
      const img = new Image(); img.src = b.spine; img.alt = ''
      img.onload = () => { st.spineW = Math.round(H * (img.naturalWidth / img.naturalHeight)); relayout() }
      img.onerror = () => spine.replaceChildren(fauxFace(b, 'spine', st.spineW))
      spine.appendChild(img)
    } else spine.appendChild(fauxFace(b, 'spine', st.spineW))

    inner.append(cover, spine)
    book.appendChild(inner)
    book.addEventListener('click', () => setActive(i))
    shelf.appendChild(book)
    return { book, inner, b, st }
  })

  let active = Number(shelf.dataset.initialOpenIndex || 0)

  // grizz's lean model: books near the focused one lean more; sides lean opposite ways.
  const leanFor = (i) => {
    if (i === active) return 0
    const base = parseFloat(els[i].b.tilt || 0)
    const w = Math.abs(i - active)
    const dir = i < active ? -1 : 1
    const boost = Math.max(0, 2.2 - w * 0.28)
    const atten = Math.abs(base) * Math.max(0.7, 1 - w * 0.04)
    return clamp((atten + boost) * dir, -4.2, 4.2)
  }

  function relayout() {
    els.forEach(({ book, inner, b, st }, i) => {
      const open = i === active
      const tilt = leanFor(i)
      const ry = open ? 0 : (b.manga ? -90 : 90)
      book.style.width = (open ? st.coverW : st.spineW) + 'px'
      book.style.transform = `rotate(${tilt}deg)`          // lean, pivots on the shelf floor
      inner.style.transform = `rotateY(${ry}deg)`          // spine⇄cover flip, hinges on spine edge
      book.classList.toggle('open', open)
      book.style.zIndex = open ? '3' : '1'
    })
    if (caption) {
      const b = window.BOOKS[active]
      caption.textContent = b ? `${b.title} — ${b.author}` : ''
    }
  }

  function setActive(i) {
    i = clamp(i, 0, els.length - 1)
    if (i === active) return
    active = i
    relayout()
  }

  // Navigation: pointer position over the row, and arrow keys.
  let raf = 0
  shelf.addEventListener('pointermove', (e) => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.book3d')
      if (el) setActive(Number(el.dataset.i))
    })
  })
  shelf.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { setActive(active + 1); e.preventDefault() }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { setActive(active - 1); e.preventDefault() }
    else if (e.key === 'Home') { setActive(0); e.preventDefault() }
    else if (e.key === 'End') { setActive(els.length - 1); e.preventDefault() }
  })

  relayout()
})()
