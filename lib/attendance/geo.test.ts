import { describe, it, expect } from "vitest"
import { parsePoint } from "./geo"

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
