import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
// @ts-expect-error: a plain .mjs script, tested as it is run
import { variantsOf, fullBleedBackground } from "./icon-variants.mjs"

/** Review on #31: the app's icon is drawn from the site's mark, and Android's background fills the icon. */
describe("the app icon's images", () => {
    const site = readFileSync(new URL("../../app/icon.svg", import.meta.url), "utf8")

    it("come from the site's own mark", () => {
        const v = variantsOf(site)
        expect(v.rounded).toBe(site)
        expect(v.fullBleed).not.toMatch(/rx=/)
        expect(v.fullBleed).toContain("<path")
        expect(v.background).not.toContain("<path")
        expect(v.background).toContain("url(#nizmo)")
        expect(v.foreground).not.toContain("<rect")
        expect(v.foreground).toContain("<path")
    })

    it("stop, rather than draw the wrong thing, when the mark changes shape", () => {
        expect(() => variantsOf(site.replace("<path", "<circle r=\"1\"/><path").replace(/<path\b[^>]*\/>/, ""))).toThrow(/icon-variants/)
    })

    it("keep Android's adaptive background full bleed, and the foreground inside the safe zone", () => {
        const written = `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background>
        <inset android:drawable="@mipmap/ic_launcher_background" android:inset="16.7%" />
    </background>
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%" />
    </foreground>
</adaptive-icon>`
        const fixed = fullBleedBackground(written)
        expect(fixed).toContain('<background android:drawable="@mipmap/ic_launcher_background"/>')
        expect(fixed).toContain('<inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%" />')
        const committed = readFileSync(new URL("../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml", import.meta.url), "utf8")
        expect(committed).toContain('<background android:drawable="@mipmap/ic_launcher_background"/>')
    })
})
