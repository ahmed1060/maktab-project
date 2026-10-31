import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { googleMapsLink } from "@/lib/attendance/geo"

/**
 * "Map" next to a check-in place, or a check-in, opens Google Maps: what
 * people here use, and what opens the Maps app on a phone. Before, these
 * opened OpenStreetMap.
 */
describe("map links", () => {
    it("open the point in Google Maps", () => {
        expect(googleMapsLink(30.0444, 31.2357)).toBe("https://www.google.com/maps/search/?api=1&query=30.0444,31.2357")
        expect(googleMapsLink(-33.8688, 151.2093)).toBe("https://www.google.com/maps/search/?api=1&query=-33.8688,151.2093")
    })

    it.each([
        "components/AttendanceLocationsPanel.tsx",
        "app/(dashboard)/dashboard/check-ins/page.tsx",
        // A flagged check-in's, on the Requests page since part 4c.
        "app/(dashboard)/dashboard/requests/RequestsClient.tsx",
    ])("%s uses it, not OpenStreetMap", f => {
        const s = readFileSync(f, "utf8")
        expect(s).toContain("googleMapsLink")
        expect(s).not.toContain("openstreetmap.org/?")
    })
})
