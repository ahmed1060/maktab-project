import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { locationFilterChoices, NO_CLIENT, type FilterPlace } from "@/lib/place-filters"

/**
 * The Tasks and Costs pages' location filter (CLIENTS_PLAN.md §3). A
 * location archived after tasks were done there keeps them, and their costs
 * still due, so the filter offers it too, marked, after the ones in use.
 */

const place = (id: string, name: string, clientId: string | null, over: Partial<FilterPlace> = {}): FilterPlace => ({ id, name, clientId, needsPin: false, archived: false, ...over })

const PLACES = [
    place("acme-site", "Maadi site", "k1"),
    place("acme-hq", "Nasr City", "k1"),
    place("acme-old", "Old store", "k1", { archived: true }),
    place("beta-hq", "Smouha", "k2", { needsPin: true }),
    place("beta-site", "Sidi Gaber", "k2"),
    place("port", "Port gate", null),
    place("depot", "Depot", null, { archived: true }),
]
const CLIENTS: Record<string, string> = { k1: "Acme", k2: "Beta" }
const choices = (clientId: string) => locationFilterChoices(PLACES, clientId, p => (p.clientId ? `${CLIENTS[p.clientId]} - ${p.name}` : p.name), l => `${l} · archived`)

describe("the location filter's choices", () => {
    it("offers the archived ones too, marked, after the ones in use", () => {
        expect(choices("").map(c => c.label)).toEqual([
            "Acme - Maadi site", "Acme - Nasr City", "Beta - Sidi Gaber", "Port gate",
            "Acme - Old store · archived", "Depot · archived",
        ])
    })

    it("offers the picked client's and the shared ones, archived or not", () => {
        expect(choices("k1").map(c => c.value)).toEqual(["acme-site", "acme-hq", "port", "acme-old", "depot"])
    })

    it("offers only the shared ones with No client", () => {
        expect(choices(NO_CLIENT).map(c => c.value)).toEqual(["port", "depot"])
    })

    it("leaves out a location with no pin, which has no task to find", () => {
        expect(choices("k2").map(c => c.value)).toEqual(["beta-site", "port", "depot"])
    })

    it("is read from the list that has the archived ones, not the task picker's", () => {
        const hook = readFileSync("components/locations/usePlaceFilters.ts", "utf8")
        expect(hook).toContain("/api/locations?pick=filters")
        expect(hook).not.toContain("pick=all")
    })
})
