import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * The pin's buttons and its map on the building blocks (DESIGN.md §5.3, "A
 * place on the map"). In the check-in places they were the older pages'
 * buttons; the map's own zoom buttons were named in English whatever the
 * page's language, and 30px under a finger. Where it's used, and how it
 * fills the field, are lib/attendance/point-picker.test.ts's.
 */

vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ t: (key: string) => key, locale: "en" }) }))

const SRC = readFileSync("components/PointPicker.tsx", "utf8")
const UI = readFileSync("components/ui/ui.css", "utf8")
const GLOBALS = readFileSync("app/globals.css", "utf8")
/** A rule's body in ui.css, by its exact selector. */
const rule = (selector: string) => {
    const start = UI.indexOf(`\n${selector} {`)
    if (start < 0) throw new Error(`no rule for ${selector}`)
    return UI.slice(start, UI.indexOf("}", start))
}

const picker = async (key?: string) => {
    vi.stubEnv("NEXT_PUBLIC_HERE_API_KEY", key ?? "")
    const { default: PointPicker } = await import("@/components/PointPicker")
    return renderToStaticMarkup(createElement(PointPicker, { value: "", radius: 100, onChange: () => {} }))
}
afterEach(() => { vi.unstubAllEnvs() })

describe("the pin's buttons", () => {
    it("are the building blocks' secondary buttons, a field's height, not a table row's", async () => {
        const html = await picker("k1")
        expect(html).toMatch(/^<div class="ui-point-picker"><div class="ui-point-picker-buttons">/)
        expect(html).toContain('<button type="button" class="ui-btn ui-btn-secondary">att_loc_here</button>')
        expect(html).toContain('<button type="button" class="ui-btn ui-btn-secondary" aria-expanded="false">att_loc_pick</button>')
        expect(html).not.toContain("ui-btn-sm")
        // The line under them, there before it says anything, so it's heard when it does.
        expect(html).toContain('<p class="ui-hint ui-point-picker-status" role="status"></p>')
    })

    it("offer no map without the key that draws it", async () => {
        expect(await picker()).not.toContain("att_loc_pick")
    })

    it("say how close a position is in the page's digits, as a problem when it's too rough or none came", () => {
        expect(SRC).toContain("const meters = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')")
        expect(SRC).toContain("className={cx(problem ? 'ui-error' : 'ui-hint', 'ui-point-picker-status')}")
        expect(SRC).toContain("const problem = shown?.kind === 'error' || rough")
    })

    it("are drawn by the building blocks alone: no older buttons, styles or colours typed in", () => {
        for (const gone of ["blocks ?", "blocks = false", "blocks?:", "style=", "btn btn-secondary", "--text-soft", "--danger-fg", "0.75rem", "18rem"]) expect(SRC, gone).not.toContain(gone)
        expect(SRC).toContain("import { Button } from '@/components/ui'")
        expect(SRC).toContain("import { cx } from '@/components/ui/cx'")
    })
})

describe("the map", () => {
    it("is a named region, never mirrored, with a cross at its centre", () => {
        expect(SRC).toContain('<div className="ui-map-frame" dir="ltr">')
        expect(SRC).toContain('<div ref={box} className="ui-map" role="region" aria-label={t(\'att_loc_map_label\')} />')
        expect(SRC).toContain('<span aria-hidden="true" className="ui-map-cross" />')
        expect(SRC).toContain('<div className="ui-map-actions">')
    })

    it("names its own buttons in the page's language", () => {
        expect(SRC).toMatch(/L\.map\(box\.current, \{ center: [^}]*, zoomControl: false \}\)/)
        expect(SRC).toContain("L.control.zoom({ zoomInTitle: t('map_zoom_in'), zoomOutTitle: t('map_zoom_out') }).addTo(map)")
        // Leaflet names the layers' button "Layers", with no option to change it.
        expect(SRC).toContain("toggle?.setAttribute('title', t('att_loc_layers'))")
        expect(SRC).toContain("toggle?.setAttribute('aria-label', t('att_loc_layers'))")
    })

    // The probe on PR 215: Tab from the map stopped on the pin, which the
    // keys can't move, ringed in the older pages' colour.
    it("leaves the pin out of the keyboard's way: the arrows and \"Pin the centre\" place it", () => {
        expect(SRC).toMatch(/lf\.L\.marker\(at, \{\s*draggable: true,(\s*\/\/[^\n]*)*\s*keyboard: false,\s*title:/)
    })

    it("draws its pin and radius with the building blocks' classes", () => {
        expect(SRC).toContain("icon: lf.L.divIcon({ className: 'ui-map-pin', iconSize: [22, 22], iconAnchor: [11, 11] })")
        expect(SRC).toContain("className: 'ui-map-ring-halo'")
        expect(SRC).toContain("className: 'ui-map-ring'")
        for (const gone of [".map-pin {", ".map-ring {", ".map-ring-halo {", ".map-cross {"]) expect(GLOBALS, gone).not.toContain(gone)
    })

    it.each(["map_zoom_in", "map_zoom_out", "att_loc_layers"])("%s is in English and Arabic", key => {
        expect((en as Record<string, string>)[key]).toBeTruthy()
        expect((ar as Record<string, string>)[key]).toBeTruthy()
    })
})

describe("its rules (components/ui/ui.css)", () => {
    it("put the buttons right below the pin, and the line under them only when it says something", () => {
        const buttons = rule(".ui-point-picker-buttons")
        for (const want of [/display: flex;/, /flex-wrap: wrap;/, /gap: var\(--space-2\);/]) expect(buttons).toMatch(want)
        // Over .ui-dialog-body p, which takes every paragraph's margin away, as the line is one.
        expect(rule(".ui-point-picker > :not(:first-child)")).toMatch(/margin-block-start: var\(--space-2\);/)
        expect(rule(".ui-point-picker > .ui-point-picker-status:empty")).toMatch(/margin-block-start: 0;/)
        expect(rule(".ui-point-picker-status")).toMatch(/margin: 0;/)
    })

    it("give the map a field's corners and edge, 288px tall, and the app's ring when the keyboard reaches it", () => {
        const map = rule(".ui-map")
        for (const want of [/block-size: 288px;/, /border: 1px solid var\(--field-line\);/, /border-radius: var\(--radius-field\);/]) expect(map).toMatch(want)
        const ring = rule(".ui-map:focus-visible")
        expect(ring).toMatch(/outline: 2px solid var\(--brand-text\);/)
        expect(ring).toMatch(/outline-offset: 2px;/)
        expect(rule(".ui-map-frame")).toMatch(/position: relative;\s*isolation: isolate;/)
    })

    it("ring its own buttons in the pin's colour, which holds on their white in both themes, and make them 44px under a finger", () => {
        const ring = rule(".ui-map .leaflet-control a:focus-visible")
        expect(ring).toMatch(/outline: 2px solid var\(--map-pin\);/)
        expect(ring).toMatch(/outline-offset: 2px;/)
        expect(rule(".ui-map .leaflet-bar a:focus-visible,\n.ui-map .leaflet-control-layers-toggle:focus-visible")).toMatch(/outline-offset: -2px;/)
        expect(UI).toMatch(/@media \(pointer: coarse\) \{\s*\.ui-map\.leaflet-container \.leaflet-bar a \{\s*width: 44px;\s*height: 44px;\s*line-height: 44px;/)
    })

    it("mark the centre with logical properties, as every new rule is (DESIGN.md §7)", () => {
        const cross = rule(".ui-map-cross")
        for (const want of [/position: absolute;/, /inset-block-start: 50%;/, /inset-inline-start: 50%;/, /inline-size: 18px;/, /block-size: 18px;/,
            /margin-block-start: -9px;/, /margin-inline-start: -9px;/, /pointer-events: none;/, /z-index: 1000;/]) {
            expect(cross).toMatch(want)
        }
        expect(cross).not.toMatch(/\b(top|left|right|width|height):/)
    })

    it("keep the pin a dot in the brand colour with a white edge, and the radius ring over a wider white one", () => {
        const pin = rule(".ui-map-pin")
        for (const want of [/background: var\(--map-pin\);/, /border: 3px solid var\(--map-halo\);/, /border-radius: 50%;/, /box-shadow: 0 1px 4px var\(--map-shadow\);/]) expect(pin).toMatch(want)
        expect(rule(".ui-map-ring")).toMatch(/stroke: var\(--map-pin\);\s*fill: var\(--map-pin\);/)
        expect(rule(".ui-map-ring-halo")).toMatch(/stroke: var\(--map-halo\);\s*fill: none;/)
    })
})

describe("in the check-in places", () => {
    it("puts the buttons right below the point, in its group", () => {
        const panel = readFileSync("components/AttendanceLocationsPanel.tsx", "utf8")
        expect(panel).toMatch(/<div className="ui-field">\s*<Field label=\{t\('att_loc_point'\)\}[\s\S]*?\{point && <a className="ui-field-link"[^\n]*\n\s*<PointPicker value=\{draft\.point\} radius=\{Number\(draft\.radius\) \|\| 0\} onChange=\{text => edit\(\{ point: text \}, 'point'\)\} \/>\s*<\/div>/)
    })
})

describe("its words in Arabic", () => {
    // Commands to one person, in the masculine; a verbal noun, or يُرجى and one, instead.
    const MASCULINE = ["ابحث", "الصق", "انقر", "استخدم", "راجع", "قف", "حاول", "اسمح", "اختر", "اسحب", "اسحبه", "ضع"]
    const KEYS = ["location_search", "location_search_placeholder", "place_search_none", "place_search_failed", "place_search_list",
        "att_loc_point_hint", "att_loc_here", "att_loc_here_busy", "att_loc_here_found", "att_loc_here_rough", "att_loc_here_denied",
        "att_loc_here_unavailable", "att_loc_here_timeout", "att_loc_here_unsupported", "att_loc_pick", "att_loc_pick_close",
        "att_loc_pick_hint", "att_loc_map_label", "att_loc_pin", "att_loc_pin_centre", "att_loc_layer_map", "att_loc_layer_satellite",
        "att_loc_layers", "map_zoom_in", "map_zoom_out"]

    it.each(KEYS)("%s speaks to no one person", key => {
        const text = (ar as Record<string, string>)[key]
        for (const word of MASCULINE) expect(text, word).not.toMatch(new RegExp(`(^|[\\s«(،:.])${word}(?=$|[\\s»)،.:])`))
        for (const phrase of ["هل أنت متأكد", "أنك تريد", "هل تريد", "لا تؤكّد"]) expect(text).not.toContain(phrase)
    })

    it("names the buttons as what they do", () => {
        expect([ar.att_loc_here, ar.att_loc_pick, ar.att_loc_pin_centre]).toEqual(["استخدام موقعي الحالي", "تحديد المكان على الخريطة", "وضع الدبوس في المنتصف"])
        expect([en.map_zoom_in, en.map_zoom_out, en.att_loc_layers]).toEqual(["Zoom in", "Zoom out", "Map or satellite"])
        expect([ar.map_zoom_in, ar.map_zoom_out, ar.att_loc_layers]).toEqual(["تكبير", "تصغير", "خريطة أو قمر صناعي"])
    })
})
