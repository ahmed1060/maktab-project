import { describe, it, expect } from "vitest"
import { getClientIp } from "./api-utils"

function headersWith(entries: Record<string, string>) {
    const h = new Headers()
    for (const [k, v] of Object.entries(entries)) h.set(k, v)
    return h
}

describe("getClientIp (F-10)", () => {
    it("prefers x-vercel-forwarded-for when present", () => {
        const h = headersWith({
            'x-vercel-forwarded-for': '203.0.113.5',
            'x-forwarded-for': '198.51.100.9, 203.0.113.5',
        })
        expect(getClientIp(h)).toBe('203.0.113.5')
    })

    it("takes only the first hop of x-forwarded-for, not the whole client-controllable list", () => {
        const h = headersWith({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2' })
        expect(getClientIp(h)).toBe('203.0.113.5')
    })

    it("trims whitespace around the first hop", () => {
        const h = headersWith({ 'x-forwarded-for': '  203.0.113.5  , 10.0.0.1' })
        expect(getClientIp(h)).toBe('203.0.113.5')
    })

    it("falls back to 'unknown' when neither header is present", () => {
        expect(getClientIp(headersWith({}))).toBe('unknown')
    })
})
