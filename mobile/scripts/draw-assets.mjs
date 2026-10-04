// Draws the app's icon and splash sources into mobile/assets/ from the site's
// own mark (app/icon.svg: the white "N" on the indigo-to-pink gradient), for
// `npm run assets`, which turns them into every size Android and iOS want.
// Kept as code so a new mark is one edit here, not a dozen files by hand.
import sharp from "sharp"
import { mkdir } from "node:fs/promises"

const gradient = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#6366f1"/><stop offset="0.5" stop-color="#8b5cf6"/><stop offset="1" stop-color="#ec4899"/>
</linearGradient>`
// The "N" as in app/icon.svg, on a 64-unit square.
const n = (stroke = "#ffffff") => `<path d="M18 47 V19 L46 47 V19" fill="none" stroke="${stroke}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`
const svg = body => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${gradient}</defs>${body}</svg>`)

/** The mark with rounded corners, drawn `size` across on a square of `canvas` filled with `background`. */
async function splash(canvas, size, background) {
    const mark = await sharp(svg(`<rect width="64" height="64" rx="14" fill="url(#g)"/>${n()}`)).resize(size, size).png().toBuffer()
    return sharp({ create: { width: canvas, height: canvas, channels: 4, background } })
        .composite([{ input: mark, gravity: "centre" }]).png()
}

await mkdir("assets", { recursive: true })
// Full-bleed: the stores and the phones round the corners themselves.
await sharp(svg(`<rect width="64" height="64" fill="url(#g)"/>${n()}`)).resize(1024, 1024).png().toFile("assets/icon-only.png")
// Android's adaptive icon: the gradient behind, the "N" in front. The generator insets both to the middle 66% that
// every launcher mask shows, so the "N" is drawn at the same size as on icon-only.
await sharp(svg(`<rect width="64" height="64" fill="url(#g)"/>`)).resize(1024, 1024).png().toFile("assets/icon-background.png")
await sharp(svg(n())).resize(1024, 1024).png().toFile("assets/icon-foreground.png")
// The splash: the mark in the middle, on the site's own light and dark backgrounds (mobile/www/index.html).
await (await splash(2732, 640, "#f4f5fb")).toFile("assets/splash.png")
await (await splash(2732, 640, "#12141c")).toFile("assets/splash-dark.png")
console.log("Drew assets/: icon-only, icon-background, icon-foreground, splash, splash-dark")
