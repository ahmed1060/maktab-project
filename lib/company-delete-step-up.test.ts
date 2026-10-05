import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "./strip-comments"

/**
 * Deleting a company — and the other Super Admin actions that used to ask for
 * a passcode — is confirmed with a recent authenticator code (lib/step-up.ts),
 * not a passcode written into the code.
 *
 * Before, the Companies page compared the typed passcode with a literal in
 * the browser and then called the API without it; the server compared the
 * missing passcode with its own copy of the literal and refused. Deleting a
 * company always failed, as did permanently deleting a user and resetting an
 * Admin's password, which no screen sent a passcode for either.
 */

const touched: string[] = []
vi.mock("@/lib/prisma", () => ({
    prisma: new Proxy({}, { get: (_t, model: string) => new Proxy({}, { get: (_m, op: string) => async () => { touched.push(`${model}.${op}`); return null } }) }),
}))
vi.mock("@/lib/services/system-settings.service", () => ({ SystemSettingsService: { get: async () => ({ stepUpMinutes: 60 }) } }))

const { CompanyService } = await import("@/lib/services/company.service")
const { StepUpError } = await import("@/lib/step-up")
const superAdmin = (patch: Record<string, unknown>) => ({ user: { id: "sa1", role: "SUPER_ADMIN", mfaEnabled: true, ...patch } })

describe("deleting a company", () => {
    beforeEach(() => { touched.length = 0 })

    it("asks for a code when none was entered this hour, and touches nothing", async () => {
        await expect(CompanyService.delete("c1", superAdmin({ stepUpAt: null }))).rejects.toBeInstanceOf(StepUpError)
        await expect(CompanyService.delete("c1", superAdmin({ stepUpAt: Date.now() - 61 * 60_000 }))).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" })
        expect(touched).toEqual([])
    })

    it("asks somebody without two-factor authentication to set it up first", async () => {
        await expect(CompanyService.delete("c1", superAdmin({ mfaEnabled: false, stepUpAt: Date.now() }))).rejects.toMatchObject({ code: "MFA_ENROL_REQUIRED" })
        expect(touched).toEqual([])
    })

    it("goes ahead with a code entered this hour", async () => {
        // Past the confirmation: the next thing is looking the company up
        // (null here, so it stops at "not found").
        await expect(CompanyService.delete("c1", superAdmin({ stepUpAt: Date.now() - 5 * 60_000 }))).rejects.toThrow("COMPANY_NOT_FOUND")
        expect(touched[0]).toBe("company.findUnique")
    })
})

describe("no passcode anywhere", () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
        const p = join(dir, f)
        return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.includes(".test.") ? [p] : []
    })

    it("the verification passcode service is gone, and nothing checks one", () => {
        const offenders = [...files("app"), ...files("components"), ...files("lib")].filter(f => {
            const src = stripComments(readFileSync(f, "utf8"))
            return /VerificationService\.isValid|from ["'].*\/verification\.service["']|INVALID_PASSCODE|searchParams\.get\(['"]passcode['"]\)/.test(src)
        })
        expect(offenders).toEqual([])
    })

    it("the Companies page neither asks for nor checks one", () => {
        const page = stripComments(readFileSync("app/(dashboard)/dashboard/companies/page.tsx", "utf8"))
        expect(page).not.toMatch(/passcode/i)
        expect(page).not.toContain("'2025'")
        expect(page).toContain("fetch(`/api/companies?id=${companyToDelete.id}`, { method: 'DELETE' })")
    })
})
