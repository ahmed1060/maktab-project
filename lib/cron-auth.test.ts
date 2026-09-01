import { describe, it, expect, afterEach } from "vitest"
import { isValidCronRequest } from "./cron-auth"

function reqWithAuth(header: string | null) {
    const headers = new Headers()
    if (header !== null) headers.set("authorization", header)
    return new Request("http://localhost/api/cron/example", { headers })
}

describe("isValidCronRequest", () => {
    const original = process.env.CRON_SECRET

    afterEach(() => {
        process.env.CRON_SECRET = original
    })

    it("fails closed when CRON_SECRET is not configured, even for the literal 'Bearer undefined'", () => {
        delete process.env.CRON_SECRET
        // This is the exact string the old `Bearer ${process.env.CRON_SECRET}`
        // comparison produced (and accepted) when the secret was unset.
        expect(isValidCronRequest(reqWithAuth("Bearer undefined"))).toBe(false)
    })

    it("rejects a missing Authorization header", () => {
        process.env.CRON_SECRET = "a-real-secret-value"
        expect(isValidCronRequest(reqWithAuth(null))).toBe(false)
    })

    it("rejects the wrong secret", () => {
        process.env.CRON_SECRET = "a-real-secret-value"
        expect(isValidCronRequest(reqWithAuth("Bearer wrong-secret"))).toBe(false)
    })

    it("accepts the correct secret", () => {
        process.env.CRON_SECRET = "a-real-secret-value"
        expect(isValidCronRequest(reqWithAuth("Bearer a-real-secret-value"))).toBe(true)
    })

    it("does not throw on a header of a different length than expected", () => {
        process.env.CRON_SECRET = "a-real-secret-value"
        expect(() => isValidCronRequest(reqWithAuth("short"))).not.toThrow()
        expect(isValidCronRequest(reqWithAuth("short"))).toBe(false)
    })
})
