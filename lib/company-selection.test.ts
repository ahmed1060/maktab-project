import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * The Super Admin's company choice as an external store. Node has no
 * localStorage or window, so both are stood in for with the smallest thing
 * that behaves like them.
 */

class MemoryStorage {
    private map = new Map<string, string>()
    getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null }
    setItem(k: string, v: string) { this.map.set(k, String(v)) }
    removeItem(k: string) { this.map.delete(k) }
    clear() { this.map.clear() }
}

let storageListeners: ((e: { key: string | null }) => void)[] = []

async function load(storage: unknown = new MemoryStorage()) {
    vi.resetModules()
    storageListeners = []
    vi.stubGlobal("localStorage", storage)
    vi.stubGlobal("window", {
        addEventListener: (type: string, fn: (e: { key: string | null }) => void) => { if (type === "storage") storageListeners.push(fn) },
        removeEventListener: (type: string, fn: (e: { key: string | null }) => void) => { storageListeners = storageListeners.filter(l => l !== fn) },
    })
    return import("./company-selection")
}

beforeEach(() => vi.unstubAllGlobals())

describe("company selection store", () => {
    it("starts on All Companies with nothing chosen", async () => {
        const s = await load()
        expect(s.readCompanySelection()).toBeNull()
        expect(s.hasCompanySelection()).toBe(false)
    })

    it("stores a company, and All Companies as ALL — which still counts as a choice", async () => {
        const s = await load()
        s.writeCompanySelection("c1")
        expect(s.readCompanySelection()).toBe("c1")
        s.writeCompanySelection(null)
        expect(s.readCompanySelection()).toBeNull()
        expect(localStorage.getItem("selectedCompanyId")).toBe("ALL")
        expect(s.hasCompanySelection()).toBe(true)
    })

    it("tells subscribers about a write in this tab, and stops when unsubscribed", async () => {
        const s = await load()
        const seen = vi.fn()
        const unsubscribe = s.subscribeCompanySelection(seen)
        s.writeCompanySelection("c1")
        expect(seen).toHaveBeenCalledTimes(1)
        unsubscribe()
        s.writeCompanySelection("c2")
        expect(seen).toHaveBeenCalledTimes(1)
        expect(storageListeners).toHaveLength(0)
    })

    it("follows another tab's write, and ignores unrelated keys", async () => {
        const s = await load()
        const seen = vi.fn()
        s.subscribeCompanySelection(seen)
        for (const l of storageListeners) l({ key: "somethingElse" })
        expect(seen).not.toHaveBeenCalled()
        for (const l of storageListeners) l({ key: "selectedCompanyId" })
        expect(seen).toHaveBeenCalledTimes(1)
    })

    it("still holds the choice for this page when storage is unusable", async () => {
        const broken = {
            getItem() { throw new Error("SecurityError") },
            setItem() { throw new Error("SecurityError") },
        }
        const s = await load(broken)
        expect(s.readCompanySelection()).toBeNull()
        s.writeCompanySelection("c1")
        expect(s.readCompanySelection()).toBe("c1")
    })
})
