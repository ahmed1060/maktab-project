import { ApiResponse } from "@/lib/api-response"
import { can, type Actor } from "@/lib/permissions/can"
import type { Permission } from "@/lib/permissions/catalogue"

/**
 * Who may act on a company's payroll month, and which company that is.
 *
 * Five routes now answer for one month — read it, save a draft, approve it,
 * issue it, mark it paid, export it — and each one had begun to carry its own
 * copy of the same three checks. Five copies is five places for the company
 * rule below to drift, and the one that drifts is the one that shows an Admin
 * somebody else's payroll.
 *
 * The rule, stated once: a Super Admin may name a company, an Admin may not.
 * Reading a caller-supplied company id for both roles would let an Admin type
 * an id they are not in and be shown that company's register — not a
 * hypothetical, just the shape every multi-tenant leak has.
 *
 * *Who* may act is a permission, not a role list (ROLES_PLAN.md, Part A): each
 * route names the one it needs — viewing, preparing, approving, issuing and
 * marking paid are different acts, and in Part B a company can give them to
 * different people. This used to be a single PAYROLL_MANAGERS list, which made
 * all of them the same act. Which built-in roles hold which payroll permission
 * is in lib/permissions/built-in.ts; today that is exactly the Admin and the
 * Super Admin, as the list said.
 */

export type PayrollScope =
    | { ok: true; companyId: string; year: number; month: number }
    | { ok: false; reason: "NOT_A_MANAGER" | "NO_COMPANY" | "BAD_YEAR" | "BAD_MONTH"; message: string }

/**
 * Pure: takes the pieces rather than a request, so the company rule can be
 * tested without standing up a session.
 */
export function resolvePayrollScope(
    actor: Actor,
    permission: Permission,
    requestedCompanyId: string | null | undefined,
    year: unknown,
    month: unknown,
): PayrollScope {
    if (!can(actor, permission)) {
        return { ok: false, reason: "NOT_A_MANAGER", message: "Managers only" }
    }

    // Only the Super Admin may name a company. This is the Super Admin's own
    // rule, not a permission — they are outside the role system.
    const companyId = actor.role === "SUPER_ADMIN"
        ? (requestedCompanyId || actor.companyId)
        : actor.companyId
    if (!companyId) {
        return { ok: false, reason: "NO_COMPANY", message: "No company to run payroll for" }
    }

    const y = Number(year)
    const m = Number(month)
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
        return { ok: false, reason: "BAD_YEAR", message: "Year is out of range" }
    }
    if (!Number.isInteger(m) || m < 1 || m > 12) {
        return { ok: false, reason: "BAD_MONTH", message: "Month must be 1-12" }
    }

    return { ok: true, companyId, year: y, month: m }
}

/**
 * The refusal as a response. Only "not a manager" is a 403; the rest are
 * malformed requests, and answering 403 to a bad month would tell a caller
 * they lack a permission they have.
 */
export function payrollScopeRefusal(scope: PayrollScope & { ok: false }) {
    return scope.reason === "NOT_A_MANAGER"
        ? ApiResponse.forbidden(scope.message)
        : ApiResponse.badRequest(scope.message)
}

/**
 * May this session act on that company's payroll records?
 *
 * The document routes each grew their own copy of this expression, and it has
 * a shape that is easy to get subtly wrong: the Super Admin arm has to
 * short-circuit the company comparison, because a Super Admin's own companyId
 * is either null or whichever company they happen to be attached to — compared
 * straight, it would refuse them everywhere or admit them to exactly one.
 * can() does that short-circuit now, for every permission, in one place.
 *
 * Takes the target company rather than reading it from the session, because
 * the whole point is to compare against the record's company and not the
 * caller's claim about it.
 */
export function managesCompany(
    actor: Actor,
    permission: Permission,
    targetCompanyId: string,
): boolean {
    return can(actor, permission, { companyId: targetCompanyId })
}
