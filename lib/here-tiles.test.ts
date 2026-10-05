import { describe, it, expect } from "vitest"
import { hereAttribution, hereTileUrl } from "@/lib/here-tiles"

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

    it("keeps Leaflet's placeholders intact", () => {
        expect(hereTileUrl("map", "en", "k")).toContain("/{z}/{x}/{y}/")
    })

    it("credits HERE", () => {
        expect(hereAttribution(2026)).toBe("&copy; 2026 HERE")
    })
})
