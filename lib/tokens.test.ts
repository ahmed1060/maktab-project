import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * D1's safety net.
 *
 * Tokenising 1,500 colour literals has exactly one silent failure mode: a
 * var(--typo) renders as nothing at all. The element keeps its layout, loses
 * its colour, and neither typecheck nor build says a word — the first report
 * would be somebody noticing that a badge went transparent.
 *
 * So: every token referenced anywhere in the UI must be defined in globals.css,
 * and every token defined must be referenced. The second half matters too —
 * an orphan token is a colour D2 will dutifully give a dark value that nothing
 * ever uses.
 */

const CSS = readFileSync("app/globals.css", "utf8")

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path, out)
        else if (/\.(tsx?|css)$/.test(entry)) out.push(path)
    }
    return out
}

const SOURCES = [...walk("app"), ...walk("components")]

const DEFINED = new Set(
    [...CSS.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map(m => m[1])
)

const REFERENCED = new Map<string, string[]>()
for (const file of SOURCES) {
    for (const m of readFileSync(file, "utf8").matchAll(/var\(\s*(--[a-z0-9-]+)\s*[,)]/gi)) {
        const token = m[1]
        REFERENCED.set(token, [...(REFERENCED.get(token) ?? []), file])
    }
}

describe("every referenced token is defined", () => {
    it("has no var(--typo) anywhere in app/ or components/", () => {
        const missing = [...REFERENCED.entries()]
            .filter(([token]) => !DEFINED.has(token))
            .map(([token, files]) => `${token}  (${[...new Set(files)].slice(0, 3).join(", ")})`)

        expect(missing, `undefined tokens:\n${missing.join("\n")}`).toEqual([])
    })

    it("references a meaningful number of them, so this test cannot pass by finding nothing", () => {
        expect(REFERENCED.size).toBeGreaterThan(40)
    })
})

describe("every defined token is used", () => {
    it("has no orphans D2 would have to give a dark value for nothing", () => {
        // Tokens that exist for the stylesheet's own use rather than for a
        // component to reference.
        const CSS_ONLY = new Set([
            "--glass-border", "--glass-bg", "--glass-shadow", "--radius",
            "--primary", "--primary-hover", "--secondary", "--accent",
        ])

        const orphans = [...DEFINED]
            .filter(token => !REFERENCED.has(token) && !CSS_ONLY.has(token))
            // A token referenced by another token's definition still counts.
            .filter(token => !new RegExp(`var\\(\\s*${token}\\s*[,)]`).test(CSS))

        expect(orphans, `orphaned tokens:\n${orphans.join("\n")}`).toEqual([])
    })
})

describe("D1 left no raw colour behind", () => {
    it("has no hex literals outside the two files that keep fixed identity", () => {
        // ManageTemplatesModal draws national flags. A flag does not follow a
        // theme, and it is the only thing left that does not.
        const EXEMPT = ["ManageTemplatesModal"]

        const offenders: string[] = []
        for (const file of SOURCES) {
            if (EXEMPT.some(e => file.includes(e))) continue
            if (file.endsWith("globals.css")) continue
            const hits = readFileSync(file, "utf8").match(/#[0-9a-fA-F]{3,8}\b/g)
            if (hits) offenders.push(`${file}: ${[...new Set(hits)].join(" ")}`)
        }

        expect(offenders, `hardcoded colours:\n${offenders.join("\n")}`).toEqual([])
    })
})
