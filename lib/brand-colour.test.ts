import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { BRAND_PRESETS, brandStyleSheet, brandTokens, contrast, DEFAULT_BRAND, isBrandHex, nearErrorRed, readBrandHex, type BrandTokens } from "@/lib/brand-colour"

/**
 * The brand colour is a setting (UI_PLAN.md §4.6), so it can be any colour
 * somebody types. These hold the shades worked out from it to DESIGN.md
 * §2.1's promises, for a spread of colours across every hue, strength and
 * shade, not only the default.
 */

const LIGHT = { page: "#f6f9fc", panel: "#ffffff" }
const DARK = { page: "#0a1220", panel: "#0f1a2b", raised: "#16233a" }

function hslHex(h: number, s: number, l: number): string {
    const k = (n: number) => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return "#" + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("")
}

const SPREAD: string[] = []
for (let h = 0; h < 360; h += 15) for (const s of [0.2, 0.6, 1]) for (const l of [0.1, 0.3, 0.5, 0.7, 0.9]) SPREAD.push(hslHex(h, s, l))
SPREAD.push("#ffffff", "#000000", DEFAULT_BRAND)

describe("the brand colour's shades", () => {
    it("Nizmo's indigo is darkened just enough for white text", () => {
        expect(contrast("#ffffff", DEFAULT_BRAND)).toBeLessThan(4.5)
        const { light } = brandTokens(DEFAULT_BRAND)
        expect(light["--brand"]).toBe("#6063ea")
        expect(contrast("#ffffff", light["--brand"])).toBeCloseTo(4.70, 2)
    })

    it("leaves a colour that already passes as it was chosen", () => {
        expect(brandTokens("#533afd").light["--brand"]).toBe("#533afd")
        expect(brandTokens("#0D253D").light["--brand"]).toBe("#0d253d")
    })

    it.each(SPREAD)("%s keeps every promise in light mode", picked => {
        const t = brandTokens(picked).light
        // A primary button: white text at 4.5:1, through hover and press.
        for (const fill of [t["--brand"], t["--brand-hover"], t["--brand-press"]]) {
            expect(contrast(t["--on-brand"], fill)).toBeGreaterThanOrEqual(4.5)
        }
        // The brand as text, on everything it sits on.
        for (const ground of [LIGHT.page, LIGHT.panel, t["--brand-tint"], t["--brand-tint-strong"]]) {
            expect(contrast(t["--brand-text"], ground)).toBeGreaterThanOrEqual(4.5)
        }
    })

    it.each(SPREAD)("%s keeps every promise in dark mode", picked => {
        const t = brandTokens(picked).dark
        // A button stands out from the dark panel, and its text reads on it,
        // through hover and press too.
        for (const fill of [t["--brand"], t["--brand-hover"], t["--brand-press"]]) {
            expect(contrast(fill, DARK.panel)).toBeGreaterThanOrEqual(3)
            expect(contrast(t["--on-brand"], fill)).toBeGreaterThanOrEqual(4.5)
        }
        // And hover and press still look different from it.
        expect(new Set([t["--brand"], t["--brand-hover"], t["--brand-press"]]).size).toBe(3)
        for (const ground of [DARK.page, DARK.panel, DARK.raised, t["--brand-tint"], t["--brand-tint-strong"]]) {
            expect(contrast(t["--brand-text"], ground)).toBeGreaterThanOrEqual(4.5)
        }
    })

    it("a very dark colour is lightened for dark-mode buttons rather than vanishing", () => {
        const navy = brandTokens("#0d253d")
        expect(navy.light["--brand"]).toBe("#0d253d")
        expect(navy.dark["--brand"]).not.toBe("#0d253d")
        // Pressed included: it was 2.37:1 when the fill barely reached 3:1.
        for (const fill of [navy.dark["--brand"], navy.dark["--brand-hover"], navy.dark["--brand-press"]]) {
            expect(contrast(fill, DARK.panel)).toBeGreaterThanOrEqual(3)
        }
    })

    it("anything that isn't a #rrggbb colour gets the default", () => {
        const fallback = brandTokens(DEFAULT_BRAND)
        for (const bad of [null, undefined, "", "indigo", "#fff", "#6366f1ff", "6366f1", "#gggggg", "red; } body { display:none"]) {
            expect(isBrandHex(bad)).toBe(false)
            expect(brandTokens(bad)).toEqual(fallback)
        }
    })
})

describe("the brand colour in the page", () => {
    const sheet = brandStyleSheet("#0d9488")
    const t = brandTokens("#0d9488")

    it("carries every token for both themes", () => {
        for (const [theme, selector] of [["light", "html:root{"], ["dark", 'html:root[data-theme="dark"]{']] as const) {
            const at = sheet.indexOf(selector)
            expect(at).toBeGreaterThanOrEqual(0)
            const body = sheet.slice(at + selector.length, sheet.indexOf("}", at))
            for (const [name, value] of Object.entries(t[theme])) expect(body).toContain(`${name}:${value}`)
        }
    })

    it("outranks the stylesheet's default whichever loads last", () => {
        // html:root (0,1,1) beats :root (0,1,0); a plain :root would depend on order.
        expect(sheet.startsWith("html:root{")).toBe(true)
        expect(sheet).not.toMatch(/(^|})\s*:root/)
    })

    it("is in the root layout's head, from the colour setting's function", () => {
        const layout = readFileSync("app/layout.tsx", "utf8")
        expect(layout).toMatch(/<head>[\s\S]*brandStyleSheet\(/)
    })
})

describe("the stylesheet's default", () => {
    // What a page without the head sheet falls back on: the default's shades exactly.
    const css = readFileSync("app/globals.css", "utf8")
    const start = css.indexOf("Design tokens (DESIGN.md)")
    const read = (selector: string): Record<string, string> => {
        const at = css.indexOf(selector, start)
        const body = css.slice(at, css.indexOf("\n}", at))
        return Object.fromEntries([...body.matchAll(/(--brand[a-z-]*|--on-brand)\s*:\s*(#[0-9a-f]{6})\s*;/g)].map(m => [m[1], m[2]]))
    }
    const expected = brandTokens(DEFAULT_BRAND)

    it.each([["light", ":root {"], ["dark", ':root[data-theme="dark"] {']] as const)("%s matches the default indigo's shades", (theme, selector) => {
        expect(start).toBeGreaterThan(0)
        expect(read(selector)).toEqual(expected[theme] as BrandTokens)
    })
})

// The setting itself (UI_PLAN.md §4.6, DESIGN.md §2.1 and §5.3).
describe("choosing a brand colour", () => {
    it("reads a typed code, with or without #, short or long, in any case", () => {
        expect(readBrandHex("#2563EB")).toBe("#2563eb")
        expect(readBrandHex("2563eb")).toBe("#2563eb")
        expect(readBrandHex(" #abc ")).toBe("#aabbcc")
        for (const bad of ["", "#12345", "#1234567", "blue", "#gg0000", "rgb(0,0,0)", null, undefined, 42]) expect(readBrandHex(bad as any)).toBeNull()
    })

    it("offers a few ready-made colours, the default first, none close to the error red", () => {
        expect(BRAND_PRESETS[0]).toEqual({ key: "indigo", hex: DEFAULT_BRAND })
        expect(BRAND_PRESETS.length).toBeGreaterThanOrEqual(6)
        for (const p of BRAND_PRESETS) {
            expect(isBrandHex(p.hex)).toBe(true)
            expect(p.hex).toBe(p.hex.toLowerCase())
            expect(nearErrorRed(p.hex)).toBe(false)
        }
        expect(new Set(BRAND_PRESETS.map(p => p.key)).size).toBe(BRAND_PRESETS.length)
    })

    it("warns of a colour close to the error red, not of one merely warm or greyish", () => {
        // The error red itself, and reds and pinks within 20° of its hue.
        for (const red of ["#e11d48", "#b3093c", "#dc2626", "#ef4444", "#be123c", "#f43f5e"]) expect(nearErrorRed(red)).toBe(true)
        // Orange, purple, brown-grey and a grey with a red cast are not.
        for (const other of ["#ea580c", "#9333ea", "#78716c", "#8a7f80", DEFAULT_BRAND, "#2563eb"]) expect(nearErrorRed(other)).toBe(false)
    })
})
