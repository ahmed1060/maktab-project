import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { isUnroutableAddress, demoAddress, DEMO_EMAIL_DOMAIN } from "./unroutable-address"
import { stripComments } from "./strip-comments"

describe("an address that cannot reach anybody", () => {
    it("recognises the reserved top-level domains", () => {
        expect(isUnroutableAddress("someone@nizmo-demo.invalid")).toBe(true)
        expect(isUnroutableAddress("someone@anything.test")).toBe(true)
        expect(isUnroutableAddress("someone@anything.example")).toBe(true)
        expect(isUnroutableAddress("someone@anything.localhost")).toBe(true)
    })

    it("recognises the reserved documentation domains", () => {
        // These do resolve, to IANA's own servers, so a message bounces rather
        // than arriving — the same outcome by a different route.
        expect(isUnroutableAddress("someone@example.com")).toBe(true)
        expect(isUnroutableAddress("someone@example.net")).toBe(true)
        expect(isUnroutableAddress("someone@example.org")).toBe(true)
    })

    it("is not fooled by case or a trailing dot", () => {
        expect(isUnroutableAddress("Someone@Nizmo-Demo.INVALID")).toBe(true)
        expect(isUnroutableAddress("someone@nizmo-demo.invalid.")).toBe(true)
        expect(isUnroutableAddress("  someone@example.com  ")).toBe(true)
    })

    it("treats anything it cannot parse as unroutable", () => {
        // The conservative direction. An address the mail layer cannot
        // understand is not one it should hand to a mail server either.
        for (const bad of ["", "   ", "no-at-sign", "@nodomain.com", "trailing@", null, undefined]) {
            expect(isUnroutableAddress(bad as any), String(bad)).toBe(true)
        }
    })

    it("lets a real address through", () => {
        // The other half of the guard, and the one that would make it useless
        // if it were wrong: a live address must still be deliverable.
        expect(isUnroutableAddress("ahmed@gmail.com")).toBe(false)
        expect(isUnroutableAddress("hr@nizmo.vercel.app")).toBe(false)
        expect(isUnroutableAddress("someone@invalid-company.co.uk")).toBe(false)
        // "invalid" as a label rather than the TLD.
        expect(isUnroutableAddress("someone@invalid.com")).toBe(false)
    })
})

describe("a demo address", () => {
    it("is always unroutable", () => {
        expect(isUnroutableAddress(demoAddress("Sara Kamal"))).toBe(true)
        expect(demoAddress("Sara Kamal")).toBe(`sara-kamal@${DEMO_EMAIL_DOMAIN}`)
    })

    it("refuses a local part with nothing usable in it", () => {
        expect(() => demoAddress("   ")).toThrow()
        expect(() => demoAddress("!!!")).toThrow()
    })

    it("uses the reserved TLD, not a lookalike", () => {
        // nizmo-demo.invalid cannot resolve. nizmo-demo.com could be bought by
        // anybody tomorrow, and then the demo data has a real destination.
        expect(DEMO_EMAIL_DOMAIN.endsWith(".invalid")).toBe(true)
    })
})

describe("the mail layer refuses before it sends", () => {
    const email = stripComments(readFileSync("lib/email.ts", "utf8"))

    it("checks both senders", () => {
        expect(email.split("refuseUnroutable(").length - 1).toBe(3) // one definition, two calls
    })

    it("checks before the transporter, so the answer does not depend on configuration", () => {
        // A reserved address is settled: there is nothing to configure that
        // would make it deliverable. Checking after would make a demo send
        // throw EMAIL_NOT_CONFIGURED locally and silently attempt delivery in
        // production, which is the wrong way round.
        const plain = email.slice(email.indexOf("export async function sendPlainEmail"))
        expect(plain.indexOf("refuseUnroutable")).toBeLessThan(plain.indexOf("EMAIL_NOT_CONFIGURED"))

        const code = email.slice(email.indexOf("export async function sendVerificationCodeEmail"))
        expect(code.indexOf("refuseUnroutable")).toBeLessThan(code.indexOf("EMAIL_NOT_CONFIGURED"))
    })

    it("reports a skip rather than pretending it sent", () => {
        expect(email).toContain("SKIPPED_UNROUTABLE")
        expect(email).toContain("return 'SENT'")
    })
})
