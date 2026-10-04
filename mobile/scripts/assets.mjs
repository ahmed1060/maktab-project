// `npm run assets`: the app's icon and splash from the site's own mark
// (app/icon.svg), in every size Android and iOS want. Draws the sources into
// assets/, runs @capacitor/assets on them, then keeps Android's adaptive
// background full bleed (scripts/icon-variants.mjs). Run it again after
// changing the mark; the generated files are committed.
import sharp from "sharp"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { variantsOf, fullBleedBackground } from "./icon-variants.mjs"

const mark = variantsOf(await readFile(new URL("../../app/icon.svg", import.meta.url), "utf8"))
const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png()

/** The mark with its rounded corners, `size` across, in the middle of a `canvas` square of `background`. */
async function splash(canvas, size, background) {
    const tile = await png(mark.rounded, size).toBuffer()
    return sharp({ create: { width: canvas, height: canvas, channels: 4, background } }).composite([{ input: tile, gravity: "centre" }]).png()
}

await mkdir("assets", { recursive: true })
await png(mark.fullBleed, 1024).toFile("assets/icon-only.png")
await png(mark.background, 1024).toFile("assets/icon-background.png")
await png(mark.foreground, 1024).toFile("assets/icon-foreground.png")
// On the site's own light and dark backgrounds (www/index.html).
await (await splash(2732, 640, "#f4f5fb")).toFile("assets/splash.png")
await (await splash(2732, 640, "#12141c")).toFile("assets/splash-dark.png")

execFileSync("npx", ["capacitor-assets", "generate", "--android", "--ios"], { stdio: "inherit" })

for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
    const file = `android/app/src/main/res/mipmap-anydpi-v26/${name}`
    await writeFile(file, fullBleedBackground(await readFile(file, "utf8")))
}
console.log("Icon and splash written. @capacitor/assets also reformats AndroidManifest.xml; that change is only spacing.")
