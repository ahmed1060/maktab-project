import { describe, it, expect } from "vitest"
import { draftOf, emptyPlace, pinOfLink, readPlace } from "./place-draft"

/**
 * A place in its form (DESIGN.md §5.3, "A place on the map"): what a
 * location, or a client's HQ, needs before it's saved, said field by field.
 */

describe("a place in its form", () => {
    it("needs a name and a pin, and leaves the radius to the default when it's empty", () => {
        expect(readPlace(emptyPlace).errors).toEqual({ name: "required", point: "required" })
        expect(readPlace({ name: "  Maadi branch ", point: "30.0444, 31.2357", radius: "" })).toEqual({
            place: { name: "Maadi branch", latitude: 30.0444, longitude: 31.2357, radiusMeters: null },
            errors: {},
        })
    })

    it("says a pin that isn't one, or is off the map, is wrong rather than missing", () => {
        expect(readPlace({ name: "HQ", point: "Cairo", radius: "" }).errors).toEqual({ point: "invalid" })
        expect(readPlace({ name: "HQ", point: "95, 31", radius: "" }).errors).toEqual({ point: "invalid" })
    })

    it("takes a whole radius from 20 to 5,000 metres, and nothing else", () => {
        const at = (radius: string) => readPlace({ name: "HQ", point: "30, 31", radius })
        expect(at("20").place?.radiusMeters).toBe(20)
        expect(at("5000").place?.radiusMeters).toBe(5000)
        for (const radius of ["19", "5001", "70.5", "abc"]) expect(at(radius).errors, radius).toEqual({ radius: "invalid" })
    })

    it("says a name over 100 letters is too long", () => {
        expect(readPlace({ name: "x".repeat(101), point: "30, 31", radius: "" }).errors).toEqual({ name: "long" })
    })

    it("opens a saved place as it was, and one without a pin with its pin to place", () => {
        expect(draftOf({ name: "HQ", latitude: 30.0444, longitude: 31.2357, radiusMeters: 150 })).toEqual({ name: "HQ", point: "30.044400, 31.235700", radius: "150" })
        expect(draftOf({ name: "HQ", latitude: null, longitude: null, radiusMeters: null })).toEqual({ name: "HQ", point: "", radius: "" })
    })

    it("finds the pin in the place search's map link, if it has one", () => {
        expect(pinOfLink("https://www.google.com/maps/search/?api=1&query=30.0444,31.2357")).toBe("30.044400, 31.235700")
        expect(pinOfLink("https://maps.google.com/?q=-33.8688, 151.2093")).toBe("-33.868800, 151.209300")
        expect(pinOfLink("https://maps.app.goo.gl/abc")).toBeNull()
        expect(pinOfLink("")).toBeNull()
    })
})
