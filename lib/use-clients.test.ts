import { describe, it, expect, vi, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Add record's client list on the Records page (components/records/useClients.ts)
 * keeps the clients listed while a search loads. It mustn't keep another
 * company's: a Super Admin who picked another company while the form was open
 * still had the last one's clients, with one chosen, and saved the record to
 * it (Codex on #82).
 *
 * SWR is replaced by what it does with keepPreviousData: while the new key
 * loads, it hands back what its fetcher returned for the last key.
 */

const state = { company: "c1", calls: [] as { key: any; fetcher: (key: any) => Promise<any> }[], kept: undefined as any }
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.company }) }))
vi.mock("swr", () => ({
    default: (key: any, fetcher: any) => {
        state.calls.push({ key, fetcher })
        return { data: state.kept, error: undefined, isLoading: state.kept !== undefined, isValidating: true, mutate: async () => {} }
    },
}))

afterEach(() => { vi.unstubAllGlobals(); state.calls = []; state.kept = undefined; state.company = "c1" })

async function shown() {
    const { useClients } = await import("@/components/records/useClients")
    let result: any
    const Probe = () => { result = useClients(true); return null }
    renderToStaticMarkup(h(Probe))
    return result
}

describe("Add record's clients, after a Super Admin picks another company", () => {
    it("aren't the last company's while the new company's load", async () => {
        vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: { clients: [{ id: "v1", name: "Acme" }], more: false } })))
        await shown()
        const last = state.calls.at(-1)!
        // What SWR keeps from the last company: its fetcher's answer for that key.
        state.kept = await last.fetcher(last.key)
        state.company = "c2"
        const now = await shown()
        expect(now.clients).toEqual([])
        expect(now.loading).toBe(true)
    })

    it("are kept while a search in the same company loads", async () => {
        vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: { clients: [{ id: "v1", name: "Acme" }], more: true } })))
        await shown()
        const last = state.calls.at(-1)!
        state.kept = await last.fetcher(last.key)
        const now = await shown()
        expect(now.clients).toEqual([{ id: "v1", name: "Acme" }])
        expect(now.loading).toBe(false)
    })
})
