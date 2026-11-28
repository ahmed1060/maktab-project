import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { withGrants } from "@/lib/permissions/test-actors"
import { can as canFor } from "@/lib/permissions/can"
import { profileAccess } from "@/lib/profile-access"
import { KNOWN_REFUSALS } from "@/lib/api-errors"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * What an owner isn't asked for (LATER_CHANGES_PLAN.md §7.3, step 3b1,
 * PR 427): no day off, permission, mission or missing punch on the Requests
 * page, nor the balances that go with them, and none taken from the server
 * for a month they're an owner, refused in their language. On their
 * details, no day-off balance.
 */

vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: "en", t: (key: string) => en[key as keyof typeof en] ?? key }),
}))

const source = (path: string) => stripComments(readFileSync(path, "utf8"))

describe("the Requests page", () => {
    const page = source("app/(dashboard)/dashboard/requests/page.tsx")

    it("asks whether whoever opens it is an owner now, in a company", () => {
        expect(page).toContain("const owner = !superAdmin && viewer.companyId ? await OwnerService.of(viewer.id) : null")
    })

    it("offers an owner no day off, with no balance, and no attendance request, with no allowance or mission", () => {
        expect(page).toContain("const mayAskDayOff = !owner && sessionHasModule({ user: viewer }, 'DAY_OFF') && can(viewer, 'dayoff.request')")
        expect(page).toContain("const mayAskAttendance = !owner && sessionHasModule({ user: viewer }, 'ATTENDANCE') && !superAdmin && !!viewer.companyId")
        // The balance, the allowance and missions each hang on those.
        expect(page).toContain("if (mayAskDayOff && tab === \"mine\") {")
        expect(page).toContain("const mayAskMission = mayAskAttendance && await MissionRequestService.missionsOnToday(viewer.companyId!)")
    })
})

describe("asked for anyway", () => {
    it("is refused under each request's own lock, for the days it's for", () => {
        const dayOff = source("lib/services/day-off.service.ts")
        expect(dayOff).toContain("await lockPersonDates(tx, userId)\n            await refuseOwnerMonths(tx, userId, requestDateStr, finalEndDateStr)")
        const attendance = source("lib/services/attendance-request.service.ts")
        expect(attendance).toContain("await lockMonths(tx, companyId, [monthOf(input.date), monthOf(next)])\n            await refuseOwnerMonths(tx, userId, input.date)")
        // A missing punch's months locked, then, after the first day it may be reported for (§7.20), checked as open.
        expect(attendance).toContain("const months = await lockPunchMonths(tx, companyId, userId, local)")
        expect(attendance).toContain("await openMonths(tx, companyId, months)\n            await refuseOwnerMonths(tx, userId, date)")
        const missions = source("lib/services/mission-request.service.ts")
        // The payroll months its dates fall in since PR 430.
        expect(missions).toContain("if ((await lockDateMonths(tx, companyId, dates, userId)).includes(SETTLED)) fail(\"PAYROLL_MONTH_LOCKED\")\n            await refuseOwnerMonths(tx, userId, span.startDate, span.endDate)")
    })

    it("says why, as an answer and in each request's dialog, in either language", () => {
        expect(KNOWN_REFUSALS.OWNER_NO_ATTENDANCE?.status).toBe(409)
        expect(source("app/(dashboard)/dashboard/requests/DayOffDialogs.tsx")).toContain("OWNER_NO_ATTENDANCE: 'requests_owner_no_attendance',")
        expect(source("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx")).toContain("OWNER_NO_ATTENDANCE: 'requests_owner_no_attendance',")
        expect(en.requests_owner_no_attendance).toBeTruthy()
        expect(ar.requests_owner_no_attendance).toBeTruthy()
    })
})

describe("an owner's details", () => {
    const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
    const facts = {
        email: "mona@example.com", username: "mona", gender: "FEMALE", company: null, role: "Employee", acting: null, teamLeader: null,
        status: "ACTIVE", salary: "", dayOffCredit: "21", contractStart: null, accountMade: null,
    }
    const view = async (ownerSince: string | null) => {
        const { ProfileView } = await import("@/components/profile/ProfileView")
        const access = profileAccess({ can: (p: string) => canFor(admin, p as never), has: () => true, viewer: admin, person: { id: "e2", role: "EMPLOYEE" } })
        return renderToStaticMarkup(h(ProfileView, {
            name: "Mona Adel", photo: null, access, facts: { ...facts, ownerSince },
            onResetPassword: () => {}, onEndContract: () => {}, onSetOwner: () => {},
        }))
    }

    it("show no day-off balance while they're an owner, and show it otherwise", async () => {
        expect(await view(null)).toContain(en.day_off_credit_assigned)
        expect(await view("2026-11")).not.toContain(en.day_off_credit_assigned)
    })
})
