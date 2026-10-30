import { describe, it, expect } from "vitest"
import { parseTaskLocation, placeLine } from "./task-place"

/**
 * The line under a task's title in the Tasks list (DESIGN.md §5.4): where
 * it's done, with its client.
 */
describe("where a task is done, in a list", () => {
    it("names a client's location with its client", () => {
        expect(placeLine({ place: { name: "Maadi branch", client: { name: "Al Noor" } } })).toBe("Al Noor - Maadi branch")
    })

    it("names a shared location with the task's client, or alone", () => {
        expect(placeLine({ client: { name: "Al Noor" }, place: { name: "Warehouse", client: null } })).toBe("Al Noor - Warehouse")
        expect(placeLine({ place: { name: "Warehouse", client: null } })).toBe("Warehouse")
    })

    it("shows the text typed before locations, as JSON with its link or plain", () => {
        expect(placeLine({ location: JSON.stringify({ name: "Nasr City", link: "https://maps.example/x" }) })).toBe("Nasr City")
        expect(placeLine({ client: { name: "Al Noor" }, location: "Nasr City" })).toBe("Al Noor - Nasr City")
    })

    it("is the client alone with no location, and empty with neither", () => {
        expect(placeLine({ client: { name: "Al Noor" } })).toBe("Al Noor")
        expect(placeLine({})).toBe("")
    })

    it("reads a typed location's link", () => {
        expect(parseTaskLocation(JSON.stringify({ name: "Nasr City", link: "https://maps.example/x" }))).toEqual({ name: "Nasr City", link: "https://maps.example/x" })
        expect(parseTaskLocation("")).toEqual({ name: "", link: "" })
    })
})
