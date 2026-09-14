import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "./strip-comments"

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

describe("no raw colour survives in any notation", () => {
    // The tokenising pass ran four times because each pass only caught the
    // notation it was written for: hex first, then 'white'/'black' keywords,
    // then white rgba(), then black rgba() and named colours. A fifth gap —
    // every rgba() that was neither white nor black — stayed open until the
    // control that used one was about to go on every screen. The rgba check
    // below is now general rather than per-colour, which is what closes the
    // class instead of the instance.
    const EXEMPT_FILE = "ManageTemplatesModal"

    const scan = (pattern: RegExp, what: string) => {
        const offenders: string[] = []
        for (const file of SOURCES) {
            if (file.includes(EXEMPT_FILE)) continue
            if (file.endsWith("globals.css")) continue
            const lines = readFileSync(file, "utf8").split("\n")
            lines.forEach((line, i) => {
                if (pattern.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`)
            })
        }
        expect(offenders, `${what}:\n${offenders.join("\n")}`).toEqual([])
    }

    it("has no rgba() literal of any colour", () => {
        // Supersedes the two notation-specific rgba checks this replaces, which
        // matched only 255,255,255 and 0,0,0 and are the reason this gap stayed
        // open after four tokenising passes.
        //
        // A white veil stays white on a dark ground — that is what left the
        // company switcher and the header buttons as pale blobs. Black does
        // three jobs, shadow, scrim and hairline, and all three break
        // differently there: a 5% black shadow is simply invisible, so cards
        // lose the separation it was carrying.
        //
        // What neither check could see was everything in between.
        // SegmentedToggle drew its track with rgba(15, 23, 42, 0.06) — slate,
        // not black — which composites to within one value of the dark surface
        // it sits on, so the control lost its track and its selected pill lost
        // its lift, on the one screen that used it. The fix is not a third
        // special case: a raw rgba() is a colour outside the palette whatever
        // its channels are, and color-mix over a token expresses the same thing
        // while following the theme.
        scan(/rgba\(/, "raw rgba() — use color-mix(in srgb, var(--token) N%, transparent)")
    })

    it("has no 'white' or 'black' keyword colours", () => {
        scan(/:\s*'(white|black)'/, "keyword colours")
    })

    it("has no CSS named colours", () => {
        // 'red' is #ff0000, harsher than the danger palette and jarring beside
        // it; 'blue' is the browser's unstyled-link colour.
        scan(/:\s*'(red|blue|green|orange|yellow|purple|pink|gray|grey)'/, "named colours")
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

describe("a token is used in the role it was defined for", () => {
    // Two dark-mode bugs, one cause: a token whose job is to be a *surface*
    // was read as a *foreground*. --panel-* is documented in globals.css as
    // "a surface whose job is to hide what is behind it"; on light it is white
    // at 80%, so painting text with it looked correct, and on dark it is the
    // panel colour itself — which painted the sidebar's labels the colour of
    // the sidebar. Nothing could catch that but a rule about roles.
    //
    // Comments stripped: the prose above and in globals.css names every token
    // these checks forbid.
    const code = (file: string) => stripComments(readFileSync(file, "utf8"))
    const CSS_CODE = stripComments(CSS)

    const SURFACE_ONLY = ["--panel-", "--veil-", "--sidebar-bg", "--segment-raised", "--logo-plate"]

    it("never paints text with a surface or elevation token", () => {
        const offenders: string[] = []
        for (const file of SOURCES) {
            if (file.endsWith(".css")) continue
            code(file).split("\n").forEach((line, i) => {
                const m = line.match(/(?:^|\W)color:\s*'var\((--[a-z0-9-]+)\)'|style\.color\s*=\s*'var\((--[a-z0-9-]+)\)'/)
                const token = m?.[1] ?? m?.[2]
                if (token && SURFACE_ONLY.some(p => token.startsWith(p)) && token !== "--segment-raised-shadow") {
                    offenders.push(`${file}:${i + 1}  ${token}`)
                }
            })
        }
        expect(offenders, `surface token used as a colour:\n${offenders.join("\n")}`).toEqual([])
    })

    it("gives the sidebar its own foreground, declared once for both themes", () => {
        // The sidebar is dark in light mode too, which is why --logo-plate is
        // also theme-independent. A dark value for these would be the original
        // bug wearing a better name.
        for (const token of ["--sidebar-fg", "--sidebar-fg-strong"]) {
            const declarations = CSS_CODE.match(new RegExp(`^\\s*${token}\\s*:`, "gm")) ?? []
            expect(declarations, token).toHaveLength(1)
        }
    })

    it("gives the raised half of a toggle a value in each theme", () => {
        // The opposite rule, and the reason it cannot share the sidebar's:
        // this one sits on whatever the page's surface is, so it has to flip.
        for (const token of ["--segment-raised", "--segment-raised-shadow"]) {
            const declarations = CSS_CODE.match(new RegExp(`^\\s*${token}\\s*:`, "gm")) ?? []
            expect(declarations, token).toHaveLength(2)
        }
    })

    it("does not draw the selected half of a toggle with the panel behind it", () => {
        // --surface *is* the dropdown panel on dark, so the selected pill was
        // the same colour as the menu and read as a hole punched in the track.
        const toggle = code("components/SegmentedToggle.tsx")
        expect(toggle).not.toMatch(/background:\s*selected\s*\?\s*'var\(--surface\)'/)
        expect(toggle).toContain("var(--segment-raised)")
    })

    it("does not build a drop shadow out of the text colour", () => {
        // color-mix over --text-strong is a shadow on light and a halo on dark.
        const toggle = code("components/SegmentedToggle.tsx")
        expect(toggle).not.toMatch(/boxShadow[^\n]*color-mix[^\n]*--text-strong/)
    })
})

describe("globals.css tokenises its own rules, not just its token block", () => {
    /**
     * The gap every previous pass left open.
     *
     * The raw-colour scan above skips globals.css, and had to: it is the file
     * where tokens are *defined*, and a definition is a literal by nature. But
     * the exemption was written for the whole file, so the stylesheet's own
     * rules were never tokenised — 42 literals across .input, .card:hover,
     * .badge and the .modal-* utilities, none of which any check could see.
     *
     * .input was the one that mattered: a hardcoded white ground under
     * color: var(--text-main), on 115 elements. Every text field in the product
     * rendered near-white text on near-white in dark mode. It stayed hidden
     * because placeholders take their own colour, so a field only looked broken
     * once somebody typed in it.
     *
     * So the exemption is now the declaration, not the file.
     */
    const DECLARATION = /^\s*--[a-z0-9-]+\s*:/

    // Accent and brand colours that are deliberately the same on both grounds:
    // an indigo focus ring, the purple attention pulse, white on a filled
    // gradient button, the chevron baked into a data: URI.
    const INVARIANT = /rgba\(99, 102, 241|rgba\(168, 85, 247|data:image|color:\s*white|2px solid #fff|rgba\(255, 255, 255, 0\.3\)/

    it("leaves no raw colour in any rule", () => {
        const offenders = stripComments(CSS)
            .split("\n")
            .map((line, i) => ({ line: line.trim(), n: i + 1 }))
            .filter(({ line }) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\b(?:white|black)\b/.test(line))
            .filter(({ line }) => !DECLARATION.test(line))
            .filter(({ line }) => !INVARIANT.test(line))
            .map(({ line, n }) => `globals.css:${n}  ${line.slice(0, 90)}`)

        expect(offenders, `raw colour in a rule:\n${offenders.join("\n")}`).toEqual([])
    })

    it("gives every input a themed ground rather than a white one", () => {
        // The specific regression, named: .input sets a themed foreground, so
        // its background must be themed too or the two meet in the middle.
        const rule = stripComments(CSS).match(/\.input\s*\{[^}]*\}/)?.[0] ?? ""
        expect(rule).toContain("color: var(--text-main)")
        expect(rule).toMatch(/background:\s*var\(--/)
    })
})
