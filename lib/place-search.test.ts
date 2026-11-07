import { describe, it, expect, vi } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { foundPlaces, placeSearchUrl, searchable, PLACE_SEARCH_LIMIT } from "@/lib/place-search"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * The place search, in a place on the map (DESIGN.md §5.3). Its suggestions
 * were a list of its own making, reached only with a mouse; a place with no
 * point on the map could be picked, which dropped no pin; and a search that
 * found nothing, or failed, said nothing.
 */

vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ t: (key: string) => key, locale: "en" }) }))

const SRC = readFileSync("components/locations/PlaceSearch.tsx", "utf8")
const FIELDS = readFileSync("components/locations/PlaceFields.tsx", "utf8")
const UI = readFileSync("components/ui/ui.css", "utf8")
/** A rule's body in ui.css, by its exact selector. */
const rule = (selector: string) => {
    const start = UI.indexOf(`\n${selector} {`)
    if (start < 0) throw new Error(`no rule for ${selector}`)
    return UI.slice(start, UI.indexOf("}", start))
}

describe("what the place search asks", () => {
    it("asks once three letters are typed", () => {
        expect(searchable("ca")).toBe(false)
        expect(searchable("  ca  ")).toBe(false)
        expect(searchable("cai")).toBe(true)
        expect(searchable("برج")).toBe(true)
    })

    it("asks HERE for up to eight places in Egypt, near Cairo first, in the language typed", () => {
        expect(PLACE_SEARCH_LIMIT).toBe(8)
        expect(placeSearchUrl(" Cairo tower ", "k1")).toBe(
            "https://autosuggest.search.hereapi.com/v1/autosuggest?q=Cairo%20tower&at=30.0444,31.2357&in=countryCode:EGY&lang=en&limit=8&apiKey=k1")
        expect(placeSearchUrl("برج القاهرة", "k1")).toContain(`q=${encodeURIComponent("برج القاهرة")}&`)
        expect(placeSearchUrl("برج القاهرة", "k1")).toContain("&lang=ar&")
    })
})

describe("what it suggests", () => {
    const tower = {
        id: "here:pds:place:1", title: "Cairo Tower", resultType: "place",
        address: { label: "Cairo Tower, Hadayek Al Andalus, Zamalek, Cairo, Egypt" },
        position: { lat: 30.04595, lng: 31.22427 },
    }

    it("each place by its name, with the rest of its address, and its point", () => {
        expect(foundPlaces({ items: [tower] })).toEqual([
            { id: "here:pds:place:1", name: "Cairo Tower", address: "Hadayek Al Andalus, Zamalek, Cairo, Egypt", point: "30.045950, 31.224270" },
        ])
    })

    it("in Arabic too, whose addresses HERE may join with an Arabic comma", () => {
        const [place] = foundPlaces({ items: [{ ...tower, title: "برج القاهرة", address: { label: "برج القاهرة، الزمالك، القاهرة، مصر" } }] })
        expect(place.name).toBe("برج القاهرة")
        expect(place.address).toBe("الزمالك، القاهرة، مصر")
    })

    it("only a place with a point on the map, so picking one always drops the pin", () => {
        const query = { id: "here:cm:taxonomy:pharmacy", title: "Pharmacy", resultType: "categoryQuery", href: "https://example.test" }
        expect(foundPlaces({ items: [query, tower] }).map(p => p.name)).toEqual(["Cairo Tower"])
        // An entrance stands in for a place with no position of its own.
        const gate = { ...tower, position: undefined, access: [{ lat: 30.046, lng: 31.2245 }] }
        expect(foundPlaces({ items: [gate] })[0].point).toBe("30.046000, 31.224500")
        expect(foundPlaces({ items: [{ ...tower, position: { lat: Number.NaN, lng: 31 } }] })).toEqual([])
        expect(foundPlaces({ items: [{ ...tower, title: "  " }] })).toEqual([])
    })

    it("no address line when it would only say the name again", () => {
        const street = { ...tower, title: "26 July Street, Zamalek, Cairo, Egypt", address: { label: "26 July Street, Zamalek, Cairo, Egypt" } }
        expect(foundPlaces({ items: [street] })[0].address).toBeNull()
        expect(foundPlaces({ items: [{ ...tower, address: undefined }] })[0].address).toBeNull()
    })

    it("nothing from an answer that isn't one", () => {
        for (const answer of [null, undefined, "x", {}, { items: "x" }, { items: [null, 3] }]) expect(foundPlaces(answer)).toEqual([])
    })
})

describe("the field", () => {
    const field = async () => {
        const { default: PlaceSearch } = await import("@/components/locations/PlaceSearch")
        return renderToStaticMarkup(createElement(PlaceSearch, { id: "f1", placeholder: "A name or an address…", onPick: () => {} }))
    }

    it("is a building block's field that suggests, as a name from a saved list does", async () => {
        const html = await field()
        expect(html).toMatch(/^<div class="ui-place-search"><span class="ui-control"><input id="f1" class="ui-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="[^"]+"/)
        // Its own suggestions open here; the browser's would cover them. What's typed keeps its own direction.
        expect(html).toMatch(/<input[^>]* autoComplete="off"[^>]* dir="auto"/)
        // A name of its own (the web interface audit on PR 215).
        expect(html).toMatch(/<input[^>]* name="placeSearch"/)
        expect(html).toMatch(/<ul id="[^"]+" role="listbox" aria-label="place_search_list" class="ui-suggestions" hidden="">/)
        // The line under it, and how many it suggests, for screen readers.
        expect(html).toContain('<p class="ui-hint ui-place-search-note" role="status"></p>')
        expect(html).toContain('<span class="ui-visually-hidden" aria-live="polite"></span>')
    })

    it("takes the saved list's keys, drops an answer to an older question, and asks nothing without a key", () => {
        expect(SRC).toContain("pickerKey(e, { shown, active, count: places.length })")
        expect(SRC).toContain("fetch(placeSearchUrl(text, hereKey))")
        expect(SRC).toContain("if (ask !== asked.current) return")
        expect(SRC).toMatch(/if \(!hereKey\) return void answer\(\{ for: text, places: \[\], failed: true \}\)/)
        // A suggestion is picked by a click without the field losing the focus first.
        expect(SRC).toContain("onMouseDown={e => e.preventDefault()} onClick={() => pick(p)}")
        expect(SRC).toContain("countOf(t, locale, places.length, 'places')")
    })

    // Codex on PR 215: eight places with their addresses run past the
    // list's 320px, and the arrows could reach one out of sight, which the
    // field pointing at it doesn't scroll to.
    it("keeps the place under the keys in sight in a list that scrolls", () => {
        expect(SRC).toContain('<ul ref={list} id={listId} role="listbox"')
        expect(SRC).toMatch(/useEffect\(\(\) => \{\s*if \(active < 0\) return\s*list\.current\?\.children\[active\]\?\.scrollIntoView\(\{ block: 'nearest' \}\)\s*\}, \[active\]\)/)
    })

    // Codex on PR 215: after a pick, retyping the place's name, as for
    // another branch of the same business, asked nothing.
    it("asks about a name picked again once it's typed, not when the pick fills it in", () => {
        expect(SRC).toContain("onChange={e => { setTyped(e.target.value); setPicked(null); setOpen(true) }}")
        expect(SRC).toMatch(/const pick = \(p: FoundPlace\) => \{\s*setTyped\(p\.name\)\s*setPicked\(p\.name\)/)
    })

    it("draws nothing itself: no styles typed in, no spinner of its own, nothing logged", () => {
        for (const gone of ["style=", "style jsx", "@keyframes", "console.", "left", "right", "onMouseEnter"]) expect(SRC, gone).not.toContain(gone)
        expect(existsSync("components/LocationSearchInput.tsx")).toBe(false)
    })

    it("isn't named by the file it replaced where the app is set up (found in PR 216)", () => {
        // next.config.mjs says who may ask for the device's position; .env.example, what the search's key is for.
        for (const file of ["next.config.mjs", ".env.example"]) expect(readFileSync(file, "utf8"), file).not.toContain("LocationSearchInput")
        expect(readFileSync("next.config.mjs", "utf8")).toContain("// geolocation=(self): components/PointPicker.tsx (\"Use my current location\") and the")
        expect(readFileSync(".env.example", "utf8")).toContain("# ---- Optional: the place search (components/locations/PlaceSearch.tsx) ----")
    })

    it("drops the pin in the place fields, and names a place that has no name yet", () => {
        expect(FIELDS).toContain("import PlaceSearch from './PlaceSearch'")
        expect(FIELDS).toMatch(/<Field label=\{t\('location_search'\)\}>\{p => <PlaceSearch \{\.\.\.p\} placeholder=\{t\('location_search_placeholder'\)\} onPick=\{place => set\(\{ point: place\.point, name: draft\.name\.trim\(\) \? draft\.name : place\.name \}\)\} \/>\}<\/Field>/)
        expect(FIELDS).not.toContain("pinOfLink")
    })

    it("puts the pin's buttons right below it, in its group", () => {
        expect(FIELDS).toMatch(/<div className="ui-field">\s*<Field\s+label=\{t\('location_pin'\)\}[\s\S]*?<\/Field>\s*\{!locked && <PointPicker value=\{draft\.point\} radius=\{radius\} onChange=\{point => set\(\{ point \}\)\} \/>\}\s*<\/div>/)
    })
})

describe("its rules (components/ui/ui.css)", () => {
    it("hang the suggestions under the field, each a place's name with the rest of its address under it", () => {
        expect(rule(".ui-place-search")).toMatch(/position: relative;/)
        const text = rule(".ui-suggestion-text")
        for (const want of [/display: flex;/, /flex-direction: column;/, /min-width: 0;/]) expect(text).toMatch(want)
        const detail = rule(".ui-suggestion-detail")
        for (const want of [/color: var\(--muted\);/, /font-size: var\(--text-sm\);/, /line-height: var\(--leading-sm\);/]) expect(detail).toMatch(want)
    })

    it("turn a small spinner at the field's end while it waits, still with reduce motion", () => {
        const spinner = rule(".ui-control[data-busy]::after")
        for (const want of [/position: absolute;/, /inset-inline-end: var\(--space-3\);/, /border: 2px solid var\(--muted\);/,
            /border-inline-end-color: transparent;/, /animation: spin 0\.8s linear infinite;/, /pointer-events: none;/]) {
            expect(spinner).toMatch(want)
        }
        expect(spinner).not.toMatch(/\b(left|right)\b/)
        expect(rule(".ui-control[data-busy] > .ui-input")).toMatch(/padding-inline-end: 36px;/)
        // In the building blocks' one block for reduce motion, with the button's.
        const reduced = UI.slice(UI.indexOf("@media (prefers-reduced-motion: reduce) {"))
        const shared = reduced.slice(0, reduced.indexOf("\n}\n"))
        expect(shared).toMatch(/\.ui-control\[data-busy\]::after,\n\s*\.ui-btn\[aria-busy="true"\]::after,/)
    })

    it("give the line under it room only when it says something, in a dialog too", () => {
        // Over .ui-dialog-body p, which takes every paragraph's margin away.
        expect(rule(".ui-place-search > .ui-place-search-note")).toMatch(/margin: var\(--space-1\) 0 0;/)
        expect(rule(".ui-place-search > .ui-place-search-note:empty")).toMatch(/margin: 0;/)
        expect(UI).toMatch(/\n\.ui-dialog-body p \{\s*margin: 0;/)
    })
})

describe("its words", () => {
    it.each(["place_search_none", "place_search_failed", "place_search_list", "count_places_one", "count_places_other"])("%s is in English and Arabic", key => {
        expect((en as Record<string, string>)[key]).toBeTruthy()
        expect((ar as Record<string, string>)[key]).toBeTruthy()
    })

    it("say what to do instead, when nothing matches or the search isn't answering", () => {
        expect(en.place_search_none).toBe("No places match. Paste the coordinates below, or pick the spot on the map.")
        expect(en.place_search_failed).toBe("The place search isn't answering. Paste the coordinates below, or pick the spot on the map.")
        expect(ar.place_search_none).toBe("لا توجد أماكن مطابقة. يُرجى لصق الإحداثيات أدناه، أو اختيار المكان على الخريطة.")
        expect(ar.place_search_failed).toBe("البحث عن الأماكن لا يستجيب الآن. يُرجى لصق الإحداثيات أدناه، أو اختيار المكان على الخريطة.")
        // Its label, a verbal noun rather than a command to one person.
        expect(ar.location_search).toBe("البحث عن المكان")
    })

    it("count places in Arabic's six forms", () => {
        expect([ar.count_places_zero, ar.count_places_one, ar.count_places_two, ar.count_places_few, ar.count_places_many, ar.count_places_other])
            .toEqual(["{n} مكان", "مكان واحد", "مكانان", "{n} أماكن", "{n} مكانًا", "{n} مكان"])
        expect([en.count_places_one, en.count_places_other]).toEqual(["1 place", "{n} places"])
    })
})
