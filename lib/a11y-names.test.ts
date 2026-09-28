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

describe("dropdowns and file pickers", () => {
    it("every one has a name, or sits inside a label", () => {
        // A second axe run found the ones with no label beside them at all:
        // the payroll month and year, the list's "go to page" box, the sort
        // order, the profile's company, the upload pickers.
        const tagAttrs = (s: string, i: number) => {
            let depth = 0, quote = ""
            for (let j = i; j < s.length; j++) {
                const c = s[j]
                if (quote) { if (c === quote) quote = ""; continue }
                if (depth === 0 && (c === '"' || c === "'" || c === "`")) quote = c
                else if (c === "{") depth++
                else if (c === "}") depth--
                else if (c === ">" && depth === 0) return s.slice(i, j)
            }
            return s.slice(i)
        }
        const unnamed: string[] = []
        for (const f of SCREENS) {
            const s = readFileSync(f, "utf8")
            for (const m of s.matchAll(/<(select|input)\b/g)) {
                const attrs = tagAttrs(s, m.index! + m[0].length)
                if (m[1] === "input" && !attrs.includes('type="file"')) continue
                if (/\b(aria-label|aria-labelledby|id)=/.test(attrs)) continue
                if (/display: ?'none'/.test(attrs) || attrs.includes("aria-hidden")) continue
                const before = s.slice(Math.max(0, m.index! - 600), m.index!)
                if (before.lastIndexOf("<label") > before.lastIndexOf("</label>")) continue
                unnamed.push(`${f}:${s.slice(0, m.index!).split("\n").length} ${m[1]}`)
            }
        }
        expect(unnamed).toEqual([])
    })

    it("the page box under every list says what it's for", () => {
        expect(readFileSync("components/Pagination.tsx", "utf8")).toContain("aria-label={t('go_to_page' as any)}")
    })
})
