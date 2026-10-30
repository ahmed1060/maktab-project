import { describe, it, expect } from "vitest"
import { pickExtra } from "@/components/filters/extra-filters"
import type { ExtraFilter } from "@/components/locations/usePlaceFilters"

/**
 * The client, location and saved name filters as the filter bar's selects
 * (components/filters): picking one clears any that follows it and no
 * longer offers its own pick, as EmployeeFilter's panel did.
 */
const places: Record<string, { value: string; label: string }[]> = {
    acme: [{ value: "", label: "All locations" }, { value: "gate", label: "Main gate" }],
    zeta: [{ value: "", label: "All locations" }, { value: "dock", label: "Dock" }],
}
const filters = (hidden = false): ExtraFilter[] => [
    { key: "clientId", label: "Client", value: "acme", options: [{ value: "", label: "All clients" }, { value: "acme", label: "Acme" }, { value: "zeta", label: "Zeta" }] },
    { key: "locationId", label: "Location", value: "gate", options: picked => places[picked.clientId] ?? [{ value: "", label: "All locations" }], hidden },
]

describe("picking a filter", () => {
    it("clears a location of another client", () => {
        expect(pickExtra(filters(), { clientId: "acme", locationId: "gate" }, "clientId", "zeta")).toEqual({ clientId: "zeta", locationId: "" })
    })

    it("keeps one still offered", () => {
        expect(pickExtra(filters(), { clientId: "acme", locationId: "gate" }, "clientId", "acme")).toEqual({ clientId: "acme", locationId: "gate" })
    })

    it("keeps a hidden one, set by a shared link, until Reset", () => {
        expect(pickExtra(filters(true), { clientId: "acme", locationId: "gate" }, "clientId", "zeta")).toEqual({ clientId: "zeta", locationId: "gate" })
    })
})
