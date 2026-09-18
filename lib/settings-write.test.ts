import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { updateCompanySchema } from "./validations/company.schema"
import { MAX_PAYROLL_DAY } from "./payday"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * G2 and G3: the two gaps where something was built and nothing could reach it.
 *
 * Both were invisible to every existing test, because a column with a default
 * passes every test about the column and a route that handles a parameter
 * passes every test about the parameter. What neither kind of test asks is
 * whether anybody can get there.
 */

const COMPANY_SERVICE = stripComments(readFileSync("lib/services/company.service.ts", "utf8"))
const COMPANY_ROUTE = stripComments(readFileSync("app/api/companies/route.ts", "utf8"))
const SYSTEM_ROUTE = stripComments(readFileSync("app/api/system-settings/route.ts", "utf8"))
const CARD = readFileSync("components/CompanyPayrollCard.tsx", "utf8")
const SETTINGS_PAGE = readFileSync("app/(dashboard)/dashboard/companies/[id]/settings/page.tsx", "utf8")
const REGISTER = readFileSync("app/(dashboard)/dashboard/payroll/page.tsx", "utf8")

describe("G2: the payroll settings can actually be set", () => {
    const base = { id: "c1" }

    it("accepts a payday inside the month and refuses one that is not", () => {
        expect(updateCompanySchema.safeParse({ ...base, payrollDay: 25 }).success).toBe(true)
        expect(updateCompanySchema.safeParse({ ...base, payrollDay: 1 }).success).toBe(true)
        expect(updateCompanySchema.safeParse({ ...base, payrollDay: MAX_PAYROLL_DAY }).success).toBe(true)
        // 29, 30 and 31 do not occur in every month, so they are days that move.
        for (const day of [0, 29, 31, 1.5, -3]) {
            expect(updateCompanySchema.safeParse({ ...base, payrollDay: day }).success, String(day)).toBe(false)
        }
    })

    it("accepts a zone the crons can serve", () => {
        for (const zone of ["Africa/Cairo", "Europe/London", "Asia/Tokyo", "UTC"]) {
            expect(updateCompanySchema.safeParse({ ...base, timezone: zone }).success, zone).toBe(true)
        }
    })

    it("refuses one they cannot, and says why rather than saying invalid", () => {
        // The whole reason the validation lives in the schema: the refusal has
        // to reach the person who typed it, and "Validation Error" would throw
        // away the only useful part.
        const result = updateCompanySchema.safeParse({ ...base, timezone: "America/New_York" })
        expect(result.success).toBe(false)
        const message = result.success ? "" : result.error.issues[0].message
        expect(message).toContain("America/New_York")
        expect(message).toContain("behind UTC")
        // It names the actual cause, so nobody goes looking for a typo.
        expect(message).toMatch(/cron|scheduled jobs/i)
    })

    it("refuses a zone that is not a zone", () => {
        const result = updateCompanySchema.safeParse({ ...base, timezone: "Middle/Earth" })
        expect(result.success).toBe(false)
    })

    it("carries all three all the way to the database", () => {
        // A field validated and then dropped before the write is the same
        // outcome as never accepting it.
        expect(COMPANY_SERVICE).toContain("payrollDay !== undefined && { payrollDay }")
        expect(COMPANY_SERVICE).toContain("payslipsVisible !== undefined && { payslipsVisible }")
        expect(COMPANY_SERVICE).toContain("timezone !== undefined && { timezone }")
    })

    it("audits each of them", () => {
        // Each decides what a payslip says or who may read one.
        for (const field of ["payrollDay", "payslipsVisible", "timezone"]) {
            expect(COMPANY_SERVICE, field).toContain(`changes.${field} = {`)
        }
    })

    it("reads them back, or the form opens on stale values", () => {
        expect(COMPANY_ROUTE).toContain("payrollDay: true")
        expect(COMPANY_ROUTE).toContain("payslipsVisible: true")
        expect(COMPANY_ROUTE).toContain("timezone: true")
    })

    it("the platform default zone is validated the same way", () => {
        // Anchored on the key as it appears in the schema — a bare
        // toContain("defaultTimezone") is satisfied by "defaultTimezoneX", and
        // by the change-tracking block further down that mentions the name
        // without validating anything.
        expect(SYSTEM_ROUTE).toMatch(/defaultTimezone:\s*z$/m)
        expect(SYSTEM_ROUTE).toContain("checkTimeZone")
        // And it is actually persisted, not merely accepted.
        expect(stripComments(readFileSync("lib/services/system-settings.service.ts", "utf8")))
            .toContain("defaultTimezone?: string")
    })

    it("and there is a control that sends them", () => {
        // The gap was never the column; it was that nothing wrote to it.
        //
        // Pinned against the request body specifically. All three names also
        // appear in the onSaved callback, so a file-wide toContain passed even
        // with a field stripped out of the PUT — caught by break-testing it.
        expect(CARD).toContain("method: 'PUT'")
        const body = CARD.slice(CARD.indexOf("body: JSON.stringify("), CARD.indexOf("const body = await res.json()"))
        for (const field of ["payrollDay: day", "payslipsVisible: visible", "timezone: zone"]) {
            expect(body, field).toContain(field)
        }
        // Anchored on the whole tag: toContain("<CompanyPayrollCard") also
        // matches "<CompanyPayrollCardX", so it could not fail on a renamed
        // component.
        expect(SETTINGS_PAGE).toMatch(/<CompanyPayrollCard[\s/>]/)
        expect(SETTINGS_PAGE).toContain("import CompanyPayrollCard from '@/components/CompanyPayrollCard'")
    })

    it("shows the zone's own refusal instead of a generic one", () => {
        expect(CARD).toContain("details?.timezone?._errors?.[0]")
    })

    it("keeps a stored zone selectable even when it is not on the list", () => {
        // Otherwise opening the page silently reassigns a company set through
        // the API to whatever the first option happens to be.
        expect(CARD).toContain("!ZONES.includes(zone) && <option value={zone}>")
    })
})

describe("G3: a Super Admin can reach a register", () => {
    it("offers a company picker to them and to nobody else", () => {
        expect(REGISTER).toContain("isSuper && (")
        expect(REGISTER).toContain("payroll_pick_company")
    })

    it("asks for nothing until a company is chosen", () => {
        // Firing anyway is exactly what produced the 400 this fixes.
        expect(REGISTER).toContain("if (isSuper && !companyId)")
    })

    it("chooses no company on their behalf", () => {
        // Defaulting to the first would show a Super Admin somebody's payroll
        // they did not ask for.
        expect(REGISTER).toContain("useState<string>('')")
    })

    it("carries the company on every call, not just the read", () => {
        // The register, the draft save, the approve, the issue, the mark-paid
        // and the export. One of them left out is one that acts on the wrong
        // company while the screen shows the right one.
        const calls = REGISTER.match(/companyId: companyId \|\| undefined/g) ?? []
        expect(calls.length).toBe(4)
        const urls = REGISTER.match(/companyId=\$\{encodeURIComponent\(companyId\)\}/g) ?? []
        expect(urls.length).toBe(2)
    })

    it("reloads when the company changes", () => {
        expect(REGISTER).toContain("[year, month, companyId, isSuper, showToast, t]")
    })

    it("reads the company list at the level the envelope actually puts it", () => {
        // { data: { data: [...] } } — reaching one level short yields an empty
        // picker and no error, which is how this would have shipped looking fine.
        expect(REGISTER).toContain("Array.isArray(body?.data?.data)")
    })
})

describe("the copy exists in both languages", () => {
    it("every English key has an Arabic value", () => {
        const missing = Object.keys(en as any).filter(k => !(k in (ar as any)))
        expect(missing, `no Arabic translation:\n${missing.join("\n")}`).toEqual([])
    })
})
