import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { clearStorageKeepingPhone } from "./kept-storage"

/**
 * The error screen's "start again" clears the site's storage. It cleared the
 * record of which review the phone's waiting face templates were sent with,
 * and they were dropped though their photo was still waiting for a reviewer:
 * approved, the phone had nothing to match against (review on #27).
 */
describe("clearing the site's storage", () => {
    const storage = () => {
        const m = new Map<string, string>([["nizmo-face-sent-review", "r1"], ["sidebar", "open"], ["draft", "x"]])
        return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), clear: () => m.clear() }
    }

    it("leaves what the phone keeps about itself, and clears the rest", () => {
        const s = storage()
        clearStorageKeepingPhone(s)
        expect([...s.m]).toEqual([["nizmo-face-sent-review", "r1"]])
    })

    it("keeps nothing that wasn't there", () => {
        const s = storage()
        s.m.delete("nizmo-face-sent-review")
        clearStorageKeepingPhone(s)
        expect(s.m.size).toBe(0)
    })

    it("is how the error screen starts again", () => {
        const src = readFileSync("components/DashboardErrorBoundary.tsx", "utf8")
        expect(src).toMatch(/clearStorageKeepingPhone\(localStorage\)/)
        expect(src).not.toMatch(/localStorage\.clear\(\)/)
        // The key the face record is kept under is the one kept.
        expect(readFileSync("lib/mobile/face.ts", "utf8")).toMatch(/const SENT_KEY: \(typeof PHONE_KEYS\)\[number\] = "nizmo-face-sent-review"/)
    })
})
