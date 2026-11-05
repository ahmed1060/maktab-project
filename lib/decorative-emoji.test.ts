import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Emoji used as icons are hidden from screen readers (accessibility audit,
 * 4 October 2026, L2). Before, they were read out: "warning sign Needs
 * attention", "calendar Requested on". The text beside them already says it.
 *
 * An emoji that means something on its own (the padlock on a locked module)
 * is a labelled image instead: role="img" with an aria-label.
 */
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])

const E = "[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B50}\\u{231A}-\\u{23FF}][\\u{FE0F}\\u{1F3FB}-\\u{1F3FF}]*"
const EMOJI_ONLY = new RegExp(`^(?:${E})+$`, "u")
// {cond ? '✓' : '✕'}: a choice between emoji and nothing else.
const EMOJI_CHOICE = new RegExp(`^\\{[^{}]*\\?\\s*'(?:${E})*\\s*'\\s*:\\s*'(?:${E})*\\s*'\\}$`, "u")
// <span …>✓</span> on one line.
const SOLE = new RegExp(`<(span|div)([^>]*)>\\s*(?:${E})+\\s*</\\1>`, "gu")
// "⚠️ Needs attention": an emoji leading text.
const LEADING = new RegExp(`(^|>)\\s*(?:${E})+\\s+[{\\p{L}]`, "u")

const hidden = (attrs: string) => /aria-hidden(="true"|\{true\}|(?![=\w-]))|role="img"/.test(attrs)

describe("decorative emoji", () => {
    const sources = [...files("app"), ...files("components")].map(f => [f, readFileSync(f, "utf8").split("\n")] as const)

    it("are hidden when they are all an element holds", () => {
        const bad: string[] = []
        for (const [f, lines] of sources) lines.forEach((line, i) => {
            for (const m of line.matchAll(SOLE)) if (!hidden(m[2])) bad.push(`${f}:${i + 1}: ${m[0]}`)
            const s = line.trim()
            if (!EMOJI_ONLY.test(s) && !EMOJI_CHOICE.test(s)) return
            // On its own line: the element opening above says it is hidden, or it
            // is the face of a button that is named some other way.
            const opener = lines.slice(Math.max(0, i - 15), i).join("\n")
            const tag = opener.slice(opener.lastIndexOf("<"))
            const button = opener.slice(opener.lastIndexOf("<button"))
            if (hidden(tag)) return
            if (opener.includes("<button") && /aria-label=/.test(button)) return
            bad.push(`${f}:${i + 1}: ${s}`)
        })
        expect(bad).toEqual([])
    })

    it("are not read out in front of text", () => {
        const bad: string[] = []
        for (const [f, lines] of sources) lines.forEach((line, i) => {
            const s = line.trim()
            if (s.startsWith("//") || s.startsWith("*") || s.startsWith("{/*")) return
            if (LEADING.test(line.replace(/<span aria-hidden="true">[^<]*<\/span>/g, ""))) bad.push(`${f}:${i + 1}: ${s}`)
        })
        expect(bad).toEqual([])
    })

    it("are hidden where icons passed as data are drawn", () => {
        // A company's own icon for a module, in the side bar (components/SideBar.tsx).
        const sideBar = readFileSync("components/SideBar.tsx", "utf8")
        const drawn = sideBar.match(/<span [^>]*>\{entry\.icon\}<\/span>/g) ?? []
        expect(drawn.length).toBeGreaterThan(0)
        for (const span of drawn) expect(span).toContain('aria-hidden="true"')
        // The Modules tab's side bar preview (company settings part 4a): the name beside it says it.
        const preview = readFileSync("components/CompanyModulesCard.tsx", "utf8")
        expect(preview).toContain('<span aria-hidden="true">{entry.icon}</span>')
        expect(preview).toContain("<bdi>{entry.label}</bdi>")
    })

    // The locked-module padlock was the one that meant something: a module
    // the package doesn't include isn't in the side bar now (DESIGN.md §5.1).
    it("include no padlock: what the package doesn't include isn't there", () => {
        expect(readFileSync("components/DashboardShell.tsx", "utf8")).not.toContain("🔒")
        expect(readFileSync("components/SideBar.tsx", "utf8")).not.toContain("🔒")
    })
})
