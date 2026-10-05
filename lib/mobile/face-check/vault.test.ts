import { describe, it, expect } from "vitest"
import { Vault, type Store } from "./vault"

describe("template vault", () => {
    const memory = (): Store & { map: Map<string, unknown> } => {
        const map = new Map<string, unknown>()
        return { map, get: async k => map.get(k), set: async (k, v) => { map.set(k, v) }, delete: async k => { map.delete(k) } }
    }
    const key = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    const templates = [[0.1, 0.2, 0.3]]

    it("keeps templates encrypted, readable only with the server's key and this device's half", async () => {
        const store = memory()
        const vault = new Vault(store)
        const k = key()
        await vault.save("approved", k, templates)
        expect(JSON.stringify([...(store.map.get("approved") as { data: Uint8Array }).data])).not.toContain("0.1")
        expect(await vault.load("approved", k)).toEqual(templates)
        // The server destroyed its half and handed out a new one: unreadable.
        await expect(vault.load("approved", key())).rejects.toMatchObject({ code: "TEMPLATES_UNREADABLE" })
        // Copied to another device, without its device half: unreadable too.
        const other = memory()
        await other.set("approved", store.map.get("approved"))
        await expect(new Vault(other).load("approved", k)).rejects.toMatchObject({ code: "TEMPLATES_UNREADABLE" })
    })

    it("keeps new templates aside until promoted, or drops them", async () => {
        const vault = new Vault(memory())
        const k = key()
        await vault.save("approved", k, templates)
        await vault.save("pending", k, [[9, 9, 9]])
        expect(await vault.load("approved", k)).toEqual(templates)
        await vault.discardPending()
        expect(await vault.has("pending")).toBe(false)
        await vault.save("pending", k, [[9, 9, 9]])
        await vault.promote()
        expect(await vault.load("approved", k)).toEqual([[9, 9, 9]])
        expect(await vault.has("pending")).toBe(false)
        await vault.deleteAll()
        expect(await vault.load("approved", k)).toBeNull()
    })
})
