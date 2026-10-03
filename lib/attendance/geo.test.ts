import { describe, it, expect } from "vitest"
import { distanceMeters, parsePoint } from "./geo"

describe("a point pasted from a map", () => {
    it("reads latitude and longitude as Google Maps copies them, or with a space", () => {
        expect(parsePoint("30.0444, 31.2357")).toEqual({ latitude: 30.0444, longitude: 31.2357 })
        expect(parsePoint(" 30.0444,31.2357 ")).toEqual({ latitude: 30.0444, longitude: 31.2357 })
        expect(parsePoint("-33.8688 151.2093")).toEqual({ latitude: -33.8688, longitude: 151.2093 })
    })

    it("refuses anything that isn't a point on the map", () => {
        for (const bad of ["", "Cairo", "30.0444", "91, 31", "30, 181", "30,, 31", "30.0444, 31.2357, 5"]) expect(parsePoint(bad), bad).toBeNull()
    })
})

describe("the distance between two points", () => {
    it("is zero to itself, and right at the scale of a street and a city", () => {
        const tahrir = { latitude: 30.0444, longitude: 31.2357 }
        expect(distanceMeters(tahrir, tahrir)).toBe(0)
        // 0.001 degrees of latitude is about 111 m anywhere.
        expect(distanceMeters(tahrir, { latitude: 30.0454, longitude: 31.2357 })).toBeCloseTo(111.2, 0)
        // Cairo to Alexandria is about 180 km as the crow flies.
        expect(distanceMeters(tahrir, { latitude: 31.2001, longitude: 29.9187 }) / 1000).toBeGreaterThan(175)
        expect(distanceMeters(tahrir, { latitude: 31.2001, longitude: 29.9187 }) / 1000).toBeLessThan(185)
    })
})
