import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fixStillWanted, formatPoint, locateErrorKey, parsePoint } from "@/lib/attendance/geo"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * A check-in place's point can be set from where this device is now, or by a
 * pin on a map, as well as by typing or pasting "lat, lng". Before, typing
 * or pasting was the only way.
 */
describe("filling the point", () => {
    it("writes what the field reads back", () => {
        expect(formatPoint(30.0444, 31.2357)).toBe("30.044400, 31.235700")
        expect(formatPoint(-33.86881234, 151.20929876)).toBe("-33.868812, 151.209299")
        expect(parsePoint(formatPoint(30.0444, 31.2357))).toEqual({ latitude: 30.0444, longitude: 31.2357 })
    })

    it("says why the device couldn't give its position", () => {
        expect(locateErrorKey(1)).toBe("att_loc_here_denied")
        expect(locateErrorKey(2)).toBe("att_loc_here_unavailable")
        expect(locateErrorKey(3)).toBe("att_loc_here_timeout")
    })

    const picker = readFileSync("components/PointPicker.tsx", "utf8")

    it("asks for a fresh, precise fix", () => {
        expect(picker).toContain("getCurrentPosition(")
        expect(picker).toMatch(/enableHighAccuracy: true/)
        expect(picker).toMatch(/maximumAge: 0/)
    })

    it("lets the map set the pin by click, drag, or the centre button", () => {
        expect(picker).toMatch(/map\.on\('click'/)
        expect(picker).toMatch(/draggable: true/)
        expect(picker).toMatch(/on\('dragend'/)
        expect(picker).toContain("pinCentre")
        expect(picker).toContain("L.circle(")
    })

    it("is in the place form, under the typed field", () => {
        const panel = readFileSync("components/AttendanceLocationsPanel.tsx", "utf8")
        expect(panel).toMatch(/<PointPicker value=\{draft\.point\}/)
    })

    it("draws HERE's map, with the key the place search already uses", () => {
        expect(picker).toContain("hereTileUrl(")
        expect(picker).toContain("process.env.NEXT_PUBLIC_HERE_API_KEY")
        expect(picker).not.toContain("openstreetmap")
    })

    it("may load HERE's map images (CSP)", () => {
        const config = readFileSync("next.config.mjs", "utf8")
        expect(config).toMatch(/img-src[^"]*https:\/\/maps\.hereapi\.com/)
        expect(config).not.toContain("tile.openstreetmap.org")
    })

    it.each(["att_loc_here", "att_loc_here_busy", "att_loc_here_found", "att_loc_here_rough", "att_loc_here_denied",
        "att_loc_here_unavailable", "att_loc_here_timeout", "att_loc_here_unsupported", "att_loc_pick", "att_loc_pick_close",
        "att_loc_pick_hint", "att_loc_map_label", "att_loc_pin", "att_loc_pin_centre", "att_loc_layer_map", "att_loc_layer_satellite"])("%s is in English and Arabic", key => {
        expect((en as Record<string, string>)[key]).toBeTruthy()
        expect((ar as Record<string, string>)[key]).toBeTruthy()
    })
})

describe("the picker in the browser", () => {
    it("imports nothing server-only (check-in-rules reaches node:net through the IP check)", () => {
        const picker = readFileSync("components/PointPicker.tsx", "utf8")
        const imports = [...picker.matchAll(/from '([^']+)'/g)].map(m => m[1])
        expect(imports).not.toContain("@/lib/attendance/check-in-rules")
        expect(readFileSync("lib/attendance/geo.ts", "utf8")).not.toMatch(/^import /m)
    })

    it("still takes the position after React remounts it (strict mode mounts twice)", () => {
        const picker = readFileSync("components/PointPicker.tsx", "utf8")
        expect(picker).toMatch(/useEffect\(\(\) => \{ alive\.current = true; return \(\) => \{ alive\.current = false \} \}, \[\]\)/)
    })
})

describe("a slow position", () => {
    // Codex review on #38: a fix arriving after the person typed or picked a
    // point overwrote their choice.
    it("fills the field only if nothing changed while waiting", () => {
        expect(fixStillWanted({ request: 1, value: "" }, { request: 1, value: "" })).toBe(true)
        expect(fixStillWanted({ request: 1, value: "" }, { request: 1, value: "30.1, 31.2" })).toBe(false)
        expect(fixStillWanted({ request: 1, value: "" }, { request: 2, value: "" })).toBe(false)
    })

    it("is checked before the picker writes the position", () => {
        const picker = readFileSync("components/PointPicker.tsx", "utf8")
        const success = picker.slice(picker.indexOf("pos => {"), picker.indexOf("err => {"))
        expect(success.indexOf("if (!wanted()) return")).toBeGreaterThan(-1)
        expect(success.indexOf("if (!wanted()) return")).toBeLessThan(success.indexOf("onChange(text)"))
    })
})
