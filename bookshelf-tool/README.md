# Bookshelf Tool

A self-contained, interactive 3D bookshelf. Each book is built from two flat
images (a cover and a spine) assembled into a 3D box with pure CSS transforms
(`transform-style: preserve-3d` + `rotateY` + `translateZ`). There is no WebGL,
no `<canvas>`, and no 3D model. Clicking a book flips it open (`rotateY` 90°→0°
over 650 ms on an ease-in-out-cubic curve) while the shelf reflows and the
neighboring books lean away. Modeled on the bookshelf at grizz.fyi.

## Run it

It is a single static file with no build step. Serve the folder with any static
server and open `index.html`:

```
cd bookshelf-tool
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Add a book

1. Drop two images into `assets/`: `<name>-cover.jpg` and `<name>-spine.png`.
   The spine must be **vertical** (title reading top-to-bottom); rotate it 90°
   if it is a horizontal scan.
2. Add one entry to the `TITLES` array in `index.html`:

   ```js
   { title: "Book Title", h: 20.3, cover: "assets/name-cover.jpg", spine: "assets/name-spine.png" },
   ```

   `h` is the book's real **height in centimetres**. Get it from the book's
   Amazon "Product details → Dimensions" and take the **largest** of the three
   numbers (Amazon lists them in an inconsistent order). Cover width follows the
   cover image's aspect ratio automatically, so an accurate height also yields an
   accurate on-screen width.
3. Add a matching base-tilt value to `BASE_TILT`.

## Height sanity checks

`HEIGHT_CHECKS` in `index.html` holds declared relative-height truths (e.g.
"Working Backwards is taller than Zen"). On load, `verifyHeights()` confirms each
holds in both the cm source values and the rendered pixels, and logs the result
to the console. Append `#debug` to the URL to label every book with its cm height
and print a pass/fail panel on the page.

## How the motion works

- **Flip:** an "openness" scalar 0→1 eased over 650 ms drives `rotateY` from 90°
  (closed, spine facing you) to 0° (open, cover facing you).
- **Reflow:** a corner-projection function computes each rotating book's real
  on-screen width so neighbors slide over to make room.
- **Lean:** opening a book animates the surrounding books' tilt away from it,
  strongest for immediate neighbors and decaying with distance.
