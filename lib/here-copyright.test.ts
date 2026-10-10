import { afterEach, describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { HERE_COPYRIGHT_MAX_AGE_MS, hereAttribution, hereCopyrightUrl, hereProviders, loadHereCopyrights, parseHereCopyrights } from "@/lib/here-tiles"

/**
 * HERE's terms ask for "© <year> HERE, <suppliers>" on the map, with the
 * suppliers for the style showing, at this zoom, in the visible area, from
 * GET /v3/copyright. Before, the map showed "© <year> HERE" alone.
 */

// The example answer in HERE's Raster Tile guide (two of its Guatemala boxes).
const answer = {
    copyrights: {
        in: [{
            boundingBoxes: [
                { east: -89.0225, north: 17.8168, south: 16.5943, west: -91.4256 },
                { east: -90.6245, north: 16.5943, south: 16.473, west: -90.6686 },
            ],
            copyrightText: "Aprobado por el INSTITUTO GEOGRAFICO NACIONAL Resolucion del IGN No 186-2011",
            label: "IGN Guatemala",
            maxLevel: 20,
            minLevel: 10,
        }],
        sat: [{
            boundingBoxes: [{ east: -180, north: 90, south: -90, west: 180 }],
            copyrightText: "Airbus",
            label: "Airbus",
            maxLevel: 20,
            minLevel: 14,
        }],
    },
    resources: { base: { styles: { "explore.day": ["in"], "explore.satellite.day": ["in", "sat"] } } },
}
const list = parseHereCopyrights(answer)!
// Around the guide's box at -90.6245, 16.5943.
const guatemala = { west: -90.7, south: 16.4, east: -90.5, north: 16.6 }
const cairo = { west: 31.1, south: 29.9, east: 31.4, north: 30.2 }
const labels = (p: { label: string }[]) => p.map(x => x.label)

describe("HERE's supplier list", () => {
    it("is asked of the Raster Tile API's copyright endpoint with the key", () => {
        const url = new URL(hereCopyrightUrl("k-1"))
        expect(url.origin + url.pathname).toBe("https://maps.hereapi.com/v3/copyright")
        expect(Object.fromEntries(url.searchParams)).toEqual({ apiKey: "k-1" })
    })

    it("reads the sources and which the base styles use", () => {
        expect(list.styles).toEqual({ "explore.day": ["in"], "explore.satellite.day": ["in", "sat"] })
        expect(list.sources.in[0]).toMatchObject({ label: "IGN Guatemala", minLevel: 10, maxLevel: 20 })
        expect(list.sources.in[0].boxes).toHaveLength(2)
    })

    it("is not read from something else", () => {
        expect(parseHereCopyrights(null)).toBeNull()
        expect(parseHereCopyrights({ error: "Unauthorized" })).toBeNull()
        expect(parseHereCopyrights("x")).toBeNull()
    })
})

describe("the suppliers for the view", () => {
    it("the guide's case: street map over Guatemala, zoom 10 to 20", () => {
        expect(labels(hereProviders(list, "map", 12, guatemala))).toEqual(["IGN Guatemala"])
        expect(labels(hereProviders(list, "map", 20, guatemala))).toEqual(["IGN Guatemala"])
    })

    it("none outside the zoom range", () => {
        expect(hereProviders(list, "map", 9, guatemala)).toEqual([])
    })

    it("none whose boxes are out of view", () => {
        expect(hereProviders(list, "map", 12, cairo)).toEqual([])
    })

    it("a view that only overlaps a box counts", () => {
        expect(labels(hereProviders(list, "map", 12, { west: -95, south: 10, east: -90.65, north: 16.5 }))).toEqual(["IGN Guatemala"])
    })

    it("satellite adds its imagery source, from zoom 14, worldwide", () => {
        expect(labels(hereProviders(list, "satellite", 15, guatemala))).toEqual(["IGN Guatemala", "Airbus"])
        expect(labels(hereProviders(list, "satellite", 15, cairo))).toEqual(["Airbus"])
        expect(hereProviders(list, "satellite", 13, cairo)).toEqual([])
        expect(hereProviders(list, "map", 15, cairo)).toEqual([])
    })

    it("a box across 180° and a view wider than the world", () => {
        const fiji = parseHereCopyrights({
            copyrights: { in: [{ label: "Fiji", minLevel: 0, maxLevel: 20, boundingBoxes: [{ west: 177, south: -21, east: -178, north: -12 }] }] },
            resources: { base: { styles: { "explore.day": ["in"] } } },
        })!
        expect(labels(hereProviders(fiji, "map", 8, { west: -179.5, south: -18, east: -179, north: -17 }))).toEqual(["Fiji"])
        expect(labels(hereProviders(fiji, "map", 8, { west: 178, south: -18, east: 179, north: -17 }))).toEqual(["Fiji"])
        expect(hereProviders(fiji, "map", 8, { west: 10, south: -18, east: 20, north: -17 })).toEqual([])
        expect(labels(hereProviders(fiji, "map", 1, { west: -400, south: -80, east: 400, north: 80 }))).toEqual(["Fiji"])
    })

    it("a supplier with no boxes is credited everywhere, and each label once", () => {
        const both = parseHereCopyrights({
            copyrights: {
                a: [{ label: "X", minLevel: 0, maxLevel: 20 }, { label: "HERE", minLevel: 0, maxLevel: 20 }],
                b: [{ label: "X", minLevel: 0, maxLevel: 20 }],
            },
            resources: { base: { styles: { "explore.day": ["a", "b"] } } },
        })!
        expect(labels(hereProviders(both, "map", 5, cairo))).toEqual(["X"])
    })

    it("none for a style the list doesn't name", () => {
        const only = parseHereCopyrights({ copyrights: answer.copyrights, resources: { base: { styles: { "explore.day": ["in"] } } } })!
        expect(hereProviders(only, "satellite", 15, guatemala)).toEqual([])
    })
})

describe("the notice", () => {
    it("HERE, then the suppliers, with the long text on hover", () => {
        expect(hereAttribution(2026, hereProviders(list, "satellite", 15, guatemala))).toBe(
            '&copy; 2026 HERE, <span title="Aprobado por el INSTITUTO GEOGRAFICO NACIONAL Resolucion del IGN No 186-2011">IGN Guatemala</span>, Airbus')
    })

    it("HERE alone with no suppliers", () => {
        expect(hereAttribution(2026, [])).toBe("&copy; 2026 HERE")
    })

    it("a supplier's text can't add markup", () => {
        const odd = parseHereCopyrights({ copyrights: { a: [{ label: "<b>A&B</b>", copyrightText: '"x"', minLevel: 0, maxLevel: 20 }] }, resources: { base: { styles: { "explore.day": ["a"] } } } })!
        expect(hereAttribution(2026, hereProviders(odd, "map", 3, cairo))).toBe('&copy; 2026 HERE, <span title="&quot;x&quot;">&lt;b&gt;A&amp;B&lt;/b&gt;</span>')
    })
})

describe("fetching the list", () => {
    afterEach(() => { vi.unstubAllGlobals() })

    it("once for up to 24 hours, then again", async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify(answer)))
        vi.stubGlobal("fetch", fetch)
        const t = 1_000_000
        expect(await loadHereCopyrights("k-fresh", t)).toEqual(list)
        await loadHereCopyrights("k-fresh", t + HERE_COPYRIGHT_MAX_AGE_MS - 1)
        expect(fetch).toHaveBeenCalledTimes(1)
        await loadHereCopyrights("k-fresh", t + HERE_COPYRIGHT_MAX_AGE_MS)
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it("a failed fetch gives null and isn't kept", async () => {
        const fetch = vi.fn(async () => new Response("no", { status: 403 }))
        vi.stubGlobal("fetch", fetch)
        expect(await loadHereCopyrights("k-bad", 5)).toBeNull()
        await Promise.resolve()
        vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }))
        expect(await loadHereCopyrights("k-bad", 6)).toBeNull()
    })
})

describe("the map", () => {
    const picker = readFileSync("components/PointPicker.tsx", "utf8")

    it("updates the notice on every move, zoom and layer change", () => {
        expect(picker).toContain("loadHereCopyrights(")
        expect(picker).toMatch(/map\.on\('moveend zoomend baselayerchange'/)
        expect(picker).toContain("hereProviders(")
    })

    it("may fetch the list (CSP)", () => {
        const config = readFileSync("next.config.mjs", "utf8")
        expect(config).toMatch(/connect-src[^"]*https:\/\/maps\.hereapi\.com/)
    })
})
