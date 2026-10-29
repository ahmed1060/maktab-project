import { describe, it, expect } from "vitest"
import { hqOf, locationForClient, locationProblem, rowLocation, sheetLocations, type BulkPlace } from "./bulk-locations"
import { numberedLabels } from "./locations"

/**
 * The bulk upload's locations (CLIENTS_PLAN.md §2.7): names in the template
 * each once, a row's location found through the template's own sheet and
 * never guessed, and checked against its client.
 */

const PLACES: BulkPlace[] = [
    { id: "acme-hq", name: "Nasr City", clientId: "acme", isHq: true, needsPin: false },
    { id: "acme-site", name: "Maadi site", clientId: "acme", isHq: false, needsPin: true },
    { id: "beta-hq", name: "Smouha", clientId: "beta", isHq: true, needsPin: true },
    { id: "port", name: "Port gate", clientId: null, isHq: false, needsPin: false },
]
const SHEET = sheetLocations([
    ["Name", "Client", "Id"],
    ["Acme - Nasr City", "Acme", "acme-hq"],
    ["Acme - Maadi site", "Acme", "acme-site"],
    ["Port gate", "Shared", "port"],
    ["Twice", "", "a"],
    ["Twice", "", "b"],
    ["Gone", "", "archived-since"],
])

describe("the template's location names", () => {
    it("numbers the second and later of names that read the same, skipping a number already taken", () => {
        const labels = numberedLabels([
            { id: "1", label: "Al Noor - Maadi branch" },
            { id: "2", label: "Al Noor - Maadi branch (2)" },
            { id: "3", label: "Al Noor - Maadi branch" },
            { id: "4", label: "Port" },
            { id: "5", label: "Al Noor - Maadi branch" },
        ]).map(l => l.label)
        expect(labels).toEqual(["Al Noor - Maadi branch", "Al Noor - Maadi branch (2)", "Al Noor - Maadi branch (3)", "Port", "Al Noor - Maadi branch (4)"])
        expect(new Set(labels).size).toBe(labels.length)
    })
})

describe("a row's location", () => {
    it("is found through the template's sheet, by its hidden id", () => {
        expect(rowLocation(" Acme - Nasr City ", "acme", SHEET, PLACES)).toEqual({ locationId: "acme-hq", problem: null })
        expect(rowLocation("Port gate", null, SHEET, PLACES)).toEqual({ locationId: "port", problem: null })
    })

    it("is found by the sheet's rows below its heading, so one named as a heading is found too", () => {
        // A shared location called "Name", or "الاسم" in an Arabic template.
        for (const heading of [["Name", "Client", "Id"], ["الاسم", "العميل", "المعرف"]]) {
            const sheet = sheetLocations([heading, [heading[0], "Shared", "named"]])
            expect(sheet.get(heading[0])).toEqual(["named"])
        }
    })

    it("is flagged, never guessed, when the sheet doesn't have its name exactly once", () => {
        expect(rowLocation("Nasr City", "acme", SHEET, PLACES)).toEqual({ locationId: null, problem: "not_in_list" })
        expect(rowLocation("Twice", null, SHEET, PLACES)).toEqual({ locationId: null, problem: "not_in_list" })
        // In the sheet, but archived since it was downloaded.
        expect(rowLocation("Gone", null, SHEET, PLACES).problem).toBe("not_in_list")
    })

    it("is flagged when it's another client's, or has no pin", () => {
        expect(rowLocation("Acme - Nasr City", "beta", SHEET, PLACES).problem).toBe("other_client")
        expect(rowLocation("Acme - Nasr City", null, SHEET, PLACES).problem).toBe("other_client")
        expect(rowLocation("Acme - Maadi site", "acme", SHEET, PLACES).problem).toBe("needs_pin")
    })

    it("is its client's HQ when the cell is empty, if the HQ has its pin", () => {
        expect(rowLocation("", "acme", SHEET, PLACES)).toEqual({ locationId: "acme-hq", problem: null })
        expect(rowLocation(undefined, "beta", SHEET, PLACES)).toEqual({ locationId: null, problem: "required" })
        expect(rowLocation(null, null, SHEET, PLACES)).toEqual({ locationId: null, problem: "required" })
    })
})

describe("the review screen", () => {
    it("keeps a shared location when the client changes, and otherwise picks the new client's HQ", () => {
        expect(locationForClient("port", "acme", PLACES)).toBe("port")
        expect(locationForClient("acme-hq", "beta", PLACES)).toBeNull()
        expect(locationForClient(null, "acme", PLACES)).toBe("acme-hq")
        expect(hqOf(null, PLACES)).toBeNull()
    })

    it("checks a location picked there as the upload does", () => {
        expect(locationProblem(null, "acme", PLACES)).toBe("required")
        expect(locationProblem("port", "beta", PLACES)).toBeNull()
        expect(locationProblem("acme-hq", "beta", PLACES)).toBe("other_client")
    })
})
