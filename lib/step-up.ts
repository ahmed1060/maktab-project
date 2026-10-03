import { PERMISSIONS, type Permission } from "@/lib/permissions/catalogue"

/**
 * Step-up confirmation for high-risk actions (ROLES_PLAN.md §6.15).
 *
 * The permissions the catalogue marks high-risk — they move money, give it
 * away, or cannot be undone — ask for an authenticator code when used, unless
 * one was entered in this session within the last `stepUpMinutes` (a system
 * setting, 60 by default). What makes that hour safe:
 *
 * - Fixed, not sliding: it counts from when the code was entered, and using
 *   high-risk actions does not extend it.
 * - Per session: the time is in the signed session token (lib/auth.ts sets it
 *   after checking the code itself), so it cannot be edited in the browser, a
 *   confirmation on one device does not unlock another, and signing out ends it.
 * - A trusted device does not skip it: that is about signing in.
 *
 * Somebody without two-factor authentication is not locked out of anything
 * else; a high-risk action tells them to set it up first (the owner's
 * decision, rather than forcing enrolment at sign-in).
 */

export const DEFAULT_STEP_UP_MINUTES = 60

export function isHighRisk(permission: Permission): boolean {
    return !!(PERMISSIONS[permission] as { highRisk?: string }).highRisk
}

type Viewer = { mfaEnabled?: boolean | null; stepUpAt?: number | null; preview?: unknown }

/** Why a high-risk action cannot go ahead yet, or null if it can. */
export function stepUpRefusal(user: Viewer, permission: Permission, minutes: number, now: number = Date.now()): "MFA_ENROL_REQUIRED" | "STEP_UP_REQUIRED" | null {
    if (!isHighRisk(permission)) return null
    if (!user.mfaEnabled) return "MFA_ENROL_REQUIRED"
    if (!user.stepUpAt || now - user.stepUpAt > minutes * 60_000) return "STEP_UP_REQUIRED"
    return null
}

/** A high-risk action refused until the person confirms it is them. */
export class StepUpError extends Error {
    constructor(public readonly code: "MFA_ENROL_REQUIRED" | "STEP_UP_REQUIRED", public readonly minutes: number) {
        super(code)
    }
}

/**
 * Refuses a high-risk action the session has not confirmed recently. Called
 * where the action happens, after the permission check. withStandardHandler
 * turns the refusal into a 403 the screens know how to answer.
 */
export async function assertStepUp(session: { user: Viewer }, permission: Permission): Promise<void> {
    if (!isHighRisk(permission)) return
    const { SystemSettingsService } = await import("@/lib/services/system-settings.service")
    const minutes = (await SystemSettingsService.get()).stepUpMinutes ?? DEFAULT_STEP_UP_MINUTES
    const refusal = stepUpRefusal(session.user, permission, minutes)
    if (refusal) throw new StepUpError(refusal, minutes)
}

/**
 * The same confirmation for an action that isn't a permission: the Super
 * Admin's own, such as turning face verification on or off (ATTENDANCE_PLAN.md
 * §10.4). A code entered within the last `stepUpMinutes`, or a refusal.
 */
export async function assertRecentStepUp(session: { user: Viewer }, now: number = Date.now()): Promise<void> {
    const { SystemSettingsService } = await import("@/lib/services/system-settings.service")
    const minutes = (await SystemSettingsService.get()).stepUpMinutes ?? DEFAULT_STEP_UP_MINUTES
    if (!session.user.mfaEnabled) throw new StepUpError("MFA_ENROL_REQUIRED", minutes)
    if (!session.user.stepUpAt || now - session.user.stepUpAt > minutes * 60_000) throw new StepUpError("STEP_UP_REQUIRED", minutes)
}
