import type { NextResponse } from "next/server"
import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"
import { hasModule, resolveBundles } from "@/lib/features/bundles"
import { can, canCompanyWide, grantFor } from "@/lib/permissions/can"
import type { Visibility } from "@/lib/services/attendance-punch.service"
import { attendanceCompanyFor } from "./settings-access"

/**
 * Who may see and correct punches (ATTENDANCE_PLAN.md §4, §14). Seeing other
 * people's is attendance.view_team; bringing punches in, adding, withdrawing
 * and mapping employee numbers is attendance.correct. Everyone sees their own,
 * and nobody corrects their own (can() refuses the permission on oneself).
 */

/**
 * The company asked about, if this person may reach its attendance at all:
 * their own company, or for the Super Admin any company holding attendance.
 * Otherwise the response to send.
 */
export async function punchCompany(session: any, asked: unknown): Promise<{ companyId: string } | { denied: NextResponse }> {
    const companyId = attendanceCompanyFor(session, asked)
    if (!companyId) return { denied: ApiResponse.badRequest("companyId is required") }
    if (session.user.role === "SUPER_ADMIN") {
        // The route gate reads the session's package, which the Super Admin
        // does not have; the company's own decides here.
        const company = await CompanyService.settingsExposure(companyId)
        if (!company || !hasModule(resolveBundles(company.package), "ATTENDANCE")) return { denied: ApiResponse.notFound("Company not found") }
    }
    return { companyId }
}

/** Whose punches this person sees in their company. */
export function visibilityFor(session: any): Visibility {
    const scope = grantFor(session.user, "attendance.view_team")
    if (scope === "ALL" || scope === "COMPANY") return { kind: "COMPANY" }
    if (scope === "TEAM") return { kind: "TEAM", leaderId: session.user.id }
    return { kind: "OWN", userId: session.user.id }
}

/** Company-wide correction: importing a file, withdrawing one, mapping numbers. */
export function correctsCompany(session: any, companyId: string): boolean {
    return canCompanyWide(session.user, "attendance.correct") && can(session.user, "attendance.correct", { companyId })
}

/** Correcting one person's attendance. Nobody may correct their own. */
export function correctsPerson(session: any, target: { companyId: string; userId: string; teamLeaderId: string | null }): boolean {
    return can(session.user, "attendance.correct", target)
}

/** The two permissions that decide requests (P0.6). Missing punches are decided by attendance.correct. */
export type DecidingPermission = "attendance.approve_permissions" | "attendance.approve_overtime" | "attendance.correct" | "attendance.approve_devices"

/** Whose requests this person may decide: the company's, their team's, or nobody's. */
export function decidesFor(session: any, permission: DecidingPermission): Visibility | null {
    const scope = grantFor(session.user, permission)
    if (scope === "ALL" || scope === "COMPANY") return { kind: "COMPANY" }
    if (scope === "TEAM") return { kind: "TEAM", leaderId: session.user.id }
    return null
}

/** Deciding one person's request. Nobody may decide their own (can() refuses it). */
export function decidesPerson(session: any, permission: DecidingPermission, target: { companyId: string; userId: string; teamLeaderId: string | null }): boolean {
    return can(session.user, permission, target)
}

/** Asking for oneself: a person of this company, never the Super Admin, who has no attendance. */
export function asksForSelf(session: any): { companyId: string; userId: string } | null {
    if (session.user.role === "SUPER_ADMIN" || !session.user.companyId) return null
    return { companyId: session.user.companyId, userId: session.user.id }
}
