import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { hereAttribution, hereTileUrl, LEAFLET_CREDIT } from "@/lib/here-tiles"

/** The place-pin map uses HERE, which the system already pays for, not OpenStreetMap. */
describe("HERE map images", () => {
    it("street map, labelled in the page's language", () => {
        const url = new URL(hereTileUrl("map", "ar", "k-1").replace("{z}/{x}/{y}", "11/1226/858"))
        expect(url.origin + url.pathname).toBe("https://maps.hereapi.com/v3/base/mc/11/1226/858/png8")
        expect(Object.fromEntries(url.searchParams)).toEqual({ style: "explore.day", size: "256", lang: "ar", apiKey: "k-1" })
    })

    it("satellite imagery with street names", () => {
        const url = new URL(hereTileUrl("satellite", "en", "k-1").replace("{z}/{x}/{y}", "1/0/0"))
        expect(url.pathname.endsWith("/jpeg")).toBe(true)
        expect(url.searchParams.get("style")).toBe("explore.satellite.day")
    })

    it("on a high-density screen, twice the pixels for the same tile, drawn at the standard size", () => {
        const sharp = new URL(hereTileUrl("satellite", "en", "k-1", { sharp: true }).replace("{z}/{x}/{y}", "11/1226/858"))
        const standard = new URL(hereTileUrl("satellite", "en", "k-1").replace("{z}/{x}/{y}", "11/1226/858"))
        // The same tile, so the same area and one request each; 512 pixels at scale 2 keeps the labels' size.
        expect(sharp.pathname).toBe(standard.pathname)
        expect(Object.fromEntries(sharp.searchParams)).toEqual({ style: "explore.satellite.day", size: "512", scale: "2", lang: "en", apiKey: "k-1" })
        expect(standard.searchParams.get("scale")).toBeNull()
        const picker = readFileSync("components/PointPicker.tsx", "utf8")
        expect(picker).toContain("hereTileUrl(style, locale, hereKey!, { sharp: L.Browser.retina })")
        // Leaflet's tile stays 256 points: a larger one, or Leaflet's own retina mode, would change the area or the labels.
        expect(picker).not.toMatch(/tileSize|zoomOffset|detectRetina/)
    })

    it("keeps Leaflet's placeholders intact", () => {
        expect(hereTileUrl("map", "en", "k")).toContain("/{z}/{x}/{y}/")
    })

    it("credits HERE", () => {
        expect(hereAttribution(2026)).toBe("&copy; 2026 HERE")
    })

    it("credits Leaflet by name alone, without the flag its default draws", () => {
        expect(LEAFLET_CREDIT).toMatch(/^<a href="https:\/\/leafletjs\.com"[^>]*>Leaflet<\/a>$/)
        expect(LEAFLET_CREDIT).not.toContain("<svg")
        expect(readFileSync("components/PointPicker.tsx", "utf8")).toContain("map.attributionControl.setPrefix(LEAFLET_CREDIT)")
    })
})
