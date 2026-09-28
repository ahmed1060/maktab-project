import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Every form field and icon-only button has a name a screen reader can say.
 *
 * Found by running axe on every page as each kind of user: 114 fields sat
 * beside a <label> that wasn't tied to them, so a screen reader announced
 * "edit text" with no hint of what for, and the page arrows and password
 * eye buttons were announced as just "button".
 */
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])
const SCREENS = [...files("app"), ...files("components")]

describe("form fields", () => {
    it("a field beside a label is tied to it, or named itself", () => {
        const unnamed: string[] = []
        for (const f of SCREENS) {
            const s = readFileSync(f, "utf8")
            for (const m of s.matchAll(/<label\b([^>]*)>/g)) {
                if (m[1].includes("htmlFor")) continue
                const close = s.indexOf("</label>", m.index!)
                if (close === -1) continue
                const inner = s.slice(m.index! + m[0].length, close)
                if (/<(input|select|textarea)\b/.test(inner)) continue // wrapped: already tied
                const rest = s.slice(close, close + 900)
                const field = rest.match(/<(input|select|textarea)\b([\s\S]*?)\/?>/)
                if (!field || rest.slice(0, field.index).includes("<label")) continue
                const attrs = field[2]
                if (/\b(id|aria-label|aria-labelledby)=/.test(attrs)) continue
                if (/type=["'](hidden|checkbox|radio|file|submit)["']/.test(attrs)) continue
                unnamed.push(`${f}:${s.slice(0, close).split("\n").length}`)
            }
        }
        expect(unnamed).toEqual([])
    })
})

describe("icon-only buttons", () => {
    it("the page arrows say which way they go", () => {
        const pager = readFileSync("components/Pagination.tsx", "utf8")
        expect(pager).toContain("aria-label={t('previous_page' as any)}")
        expect(pager).toContain("aria-label={t('next_page' as any)}")
    })

    it("every show/hide password button says which it does", () => {
        const toggles = SCREENS.flatMap(f => {
            const s = readFileSync(f, "utf8")
            return [...s.matchAll(/onClick=\{\(\) => set(\w*Password)\(!/g)].map(m => {
                const before = s.slice(Math.max(0, m.index! - 300), m.index!)
                return { at: `${f}: ${m[1]}`, named: /aria-label=\{\w+ \? t\('hide_password' as any\) : t\('show_password' as any\)\}/.test(before) }
            })
        })
        expect(toggles.length).toBeGreaterThanOrEqual(5)
        expect(toggles.filter(t => !t.named).map(t => t.at)).toEqual([])
    })
})
