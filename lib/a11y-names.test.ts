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

describe("buttons that show only a symbol", () => {
    // About 40 buttons showed only ×, ☰, ⚙️, ✍️, +, an arrow or an icon, and
    // a screen reader announced each as just "button" (or read the emoji's
    // name); a dozen had a title, which keyboard and touch users never see
    // and screen readers don't read reliably (accessibility audit, 4 October
    // 2026, H1). Each now has an aria-label from the translations.
    const LETTERS = /[A-Za-z\u0600-\u06FF]{2,}/
    const tagEnd = (s: string, i: number) => {
        let depth = 0, quote = ""
        for (let j = i; j < s.length; j++) {
            const c = s[j]
            if (quote) { if (c === quote) quote = ""; continue }
            if (depth === 0 && (c === '"' || c === "'" || c === "`")) quote = c
            else if (c === "{") depth++
            else if (c === "}") depth--
            else if (c === ">" && depth === 0) return j
        }
        return s.length
    }
    /** Whether what a button shows could be read as its name. */
    const showsWords = (inner: string) => {
        const text = inner.replace(/&times;/g, "×").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/<[^>]*>/g, "")
        if (LETTERS.test(text.replace(/\{[^}]*\}/g, ""))) return true
        const exprs = [...text.matchAll(/\{([^}]*)\}/g)].map(m => m[1])
        if (exprs.length === 0) return false
        const literals = exprs.flatMap(e => [...e.matchAll(/'([^']*)'|"([^"]*)"/g)].map(m => m[1] ?? m[2]))
        // Text from a variable or a translation: words. Only symbols in quotes: an icon.
        if (exprs.some(e => /\bt\(|\w+\.\w+|^\s*\w+\s*$/.test(e.replace(/'[^']*'|"[^"]*"/g, "")) && !/^\s*\w+ === /.test(e))) return true
        return literals.some(l => LETTERS.test(l))
    }

    it("each has a name a screen reader can say", () => {
        const unnamed: string[] = []
        for (const f of SCREENS) {
            const s = readFileSync(f, "utf8")
            for (const m of s.matchAll(/<button\b/g)) {
                const end = tagEnd(s, m.index! + m[0].length)
                const attrs = s.slice(m.index!, end)
                if (attrs.trimEnd().endsWith("/") || /aria-label(ledby)?=/.test(attrs)) continue
                const inner = s.slice(end + 1, s.indexOf("</button>", end))
                if (!showsWords(inner)) unnamed.push(`${f}:${s.slice(0, m.index!).split("\n").length}`)
            }
        }
        expect(unnamed).toEqual([])
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
