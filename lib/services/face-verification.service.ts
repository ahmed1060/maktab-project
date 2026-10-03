import { prisma } from "@/lib/prisma"
import type { FaceSystemState } from "@prisma/client"
import { policyOn } from "@/lib/attendance/policy"
import { assertRecentStepUp } from "@/lib/step-up"
import { AttendancePolicyService } from "./attendance-policy.service"
import { AttendanceCalendarService } from "./attendance-calendar.service"
import { AuditLogService } from "./audit-log.service"

/**
 * Face verification's switches and consent (ATTENDANCE_PLAN.md §9.5, §10.4).
 * It is in use for a person only when every level says so:
 *
 * - the system: on, which only the protected Super Admin can turn it, with a
 *   fresh authenticator code. Paused stops it everywhere and keeps
 *   enrolments.
 * - the company: has confirmed it holds whatever licence biometric
 *   processing needs, and its policy in force makes the feature available;
 * - the person: someone with attendance.approve_face asked it of them, and
 *   they accepted the current consent text.
 *
 * Nothing here is biometric data. The templates stay on the phone, and the
 * verification photo is the next part (§9.5, Face 2).
 */

/**
 * The consent text's version (§10.4). The text itself is in the translations
 * (face_consent_*). Changing what it says means a new version here, and then
 * everyone accepts again.
 */
export const FACE_CONSENT_VERSION = "2026-10-03"

function fail(code: string): never {
    throw new Error(code)
}

type Actor = { id: string; role: string; isProtected?: boolean; mfaEnabled?: boolean | null; stepUpAt?: number | null }

/** Which way the system switch may move. Off again is pause and purge, the next part (§10.4). */
const MOVES: Record<FaceSystemState, FaceSystemState[]> = { OFF: ["ON"], ON: ["PAUSED"], PAUSED: ["ON"] }

export class FaceVerificationService {
    static async systemState(): Promise<FaceSystemState> {
        const row = await prisma.systemSettings.findUnique({ where: { id: "default" }, select: { faceVerification: true } })
        return row?.faceVerification ?? "OFF"
    }

    /** The protected Super Admin turns it on, pauses it, or resumes it. */
    static async setSystemState(session: { user: Actor }, state: FaceSystemState) {
        if (session.user.role !== "SUPER_ADMIN" || !session.user.isProtected) fail("FACE_PROTECTED_ONLY")
        await assertRecentStepUp(session)
        const current = await this.systemState()
        if (current === state) return { state }
        if (!MOVES[current].includes(state)) fail("FACE_STATE_MOVE")
        await prisma.$transaction(async tx => {
            await tx.systemSettings.upsert({
                where: { id: "default" },
                update: { faceVerification: state, faceVerificationChangedAt: new Date() },
                create: { id: "default", faceVerification: state, faceVerificationChangedAt: new Date() },
            })
            await AuditLogService.log("SET_FACE_VERIFICATION", "SYSTEM", "default", {
                tx, superAdminId: session.user.id, details: { faceVerification: { old: current, new: state } },
            })
        })
        return { state }
    }

    /**
     * The company confirms, or withdraws, that it holds whatever licence
     * biometric processing needs (§10.4). Withdrawing it stops the feature
     * for the company at once, whatever its policy says.
     */
    static async setLegalConfirmed(companyId: string, confirmed: boolean, actorId: string, actorIsSuperAdmin: boolean) {
        await prisma.$transaction(async tx => {
            const company = await tx.company.findUnique({ where: { id: companyId }, select: { faceLegalConfirmedAt: true } })
            if (!company) fail("COMPANY_NOT_FOUND")
            if (!!company.faceLegalConfirmedAt === confirmed) return
            await tx.company.update({
                where: { id: companyId },
                data: confirmed ? { faceLegalConfirmedAt: new Date(), faceLegalConfirmedById: actorId } : { faceLegalConfirmedAt: null, faceLegalConfirmedById: null },
            })
            await AuditLogService.log(confirmed ? "CONFIRM_FACE_LEGAL" : "WITHDRAW_FACE_LEGAL", "COMPANY", companyId, {
                tx, ...(actorIsSuperAdmin ? { superAdminId: actorId } : { userId: actorId }), details: { companyId },
            })
        })
    }

    /**
     * Whether the company may use face verification today: the system is on,
     * the company confirmed its legal readiness, and the policy in force makes
     * it available. With the reason when it can't.
     */
    static async companyStatus(companyId: string): Promise<{ allowed: boolean; reason: "SYSTEM_OFF" | "SYSTEM_PAUSED" | "LEGAL_NOT_CONFIRMED" | "POLICY_OFF" | null; reverifyMonths: number | null }> {
        const system = await this.systemState()
        if (system !== "ON") return { allowed: false, reason: system === "PAUSED" ? "SYSTEM_PAUSED" : "SYSTEM_OFF", reverifyMonths: null }
        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { faceLegalConfirmedAt: true } })
        if (!company?.faceLegalConfirmedAt) return { allowed: false, reason: "LEGAL_NOT_CONFIRMED", reverifyMonths: null }
        const today = await AttendanceCalendarService.today(companyId)
        const policy = policyOn(await AttendancePolicyService.versions(companyId), today)
        if (!policy?.body.faceVerificationAvailable) return { allowed: false, reason: "POLICY_OFF", reverifyMonths: null }
        return { allowed: true, reason: null, reverifyMonths: policy.body.faceReverifyMonths }
    }

    /**
     * Asks face verification of a person, or stops asking it. The caller has
     * checked attendance.approve_face over them. Asking needs the company to
     * have it available today; stopping never does.
     */
    static async setRequired(companyId: string, userId: string, required: boolean, actorId: string, actorIsSuperAdmin: boolean) {
        if (required && !(await this.companyStatus(companyId)).allowed) fail("FACE_NOT_AVAILABLE")
        await prisma.$transaction(async tx => {
            const person = await tx.user.findFirst({ where: { id: userId, companyId }, select: { faceVerificationRequired: true } })
            if (!person) fail("USER_NOT_FOUND")
            if (person.faceVerificationRequired === required) return
            await tx.user.update({ where: { id: userId }, data: { faceVerificationRequired: required } })
            await AuditLogService.log(required ? "REQUIRE_FACE_VERIFICATION" : "STOP_FACE_VERIFICATION", "USER", userId, {
                tx, ...(actorIsSuperAdmin ? { superAdminId: actorId } : { userId: actorId }), details: { companyId, userId },
            })
        })
    }

    /** The person's current consent: accepted, not withdrawn, and to the current text. */
    static async currentConsent(userId: string) {
        return prisma.biometricConsent.findFirst({
            where: { userId, textVersion: FACE_CONSENT_VERSION, withdrawnAt: null },
            orderBy: { acceptedAt: "desc" },
            select: { id: true, textVersion: true, acceptedAt: true },
        })
    }

    /**
     * The person accepts the consent text they were shown (§9.5). Only the
     * current version, so nobody's acceptance of an older text counts for
     * the new one. Accepting twice is the same acceptance.
     */
    static async acceptConsent(companyId: string, userId: string, version: string) {
        if (version !== FACE_CONSENT_VERSION) fail("FACE_CONSENT_OUTDATED")
        const existing = await this.currentConsent(userId)
        if (existing) return existing
        return prisma.$transaction(async tx => {
            const consent = await tx.biometricConsent.create({
                data: { userId, companyId, textVersion: version },
                select: { id: true, textVersion: true, acceptedAt: true },
            })
            await AuditLogService.log("ACCEPT_FACE_CONSENT", "USER", userId, { tx, userId, details: { companyId, textVersion: version } })
            return consent
        })
    }

    /**
     * Withdraws consent, in one tap (§10.4). Nothing about the person's
     * employment changes: they check in without face verification. Destroying
     * the phone's key, so the templates on it become unreadable, joins this
     * with the next part (Face 3).
     */
    static async withdrawConsent(userId: string) {
        await prisma.$transaction(async tx => {
            const { count } = await tx.biometricConsent.updateMany({ where: { userId, withdrawnAt: null }, data: { withdrawnAt: new Date() } })
            if (count > 0) await AuditLogService.log("WITHDRAW_FACE_CONSENT", "USER", userId, { tx, userId, details: { userId } })
        })
    }

    /** Everything the app needs to know about face verification for this person. */
    static async statusFor(userId: string) {
        const person = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true, faceVerificationRequired: true } })
        if (!person?.companyId) return { active: false, required: false, company: { allowed: false, reason: "SYSTEM_OFF" as const }, consent: null, consentVersion: FACE_CONSENT_VERSION }
        const [company, consent] = await Promise.all([this.companyStatus(person.companyId), this.currentConsent(userId)])
        return {
            // In use for them: every level says so, consent included.
            active: company.allowed && person.faceVerificationRequired && !!consent,
            required: company.allowed && person.faceVerificationRequired,
            company: { allowed: company.allowed, reason: company.reason },
            consent,
            consentVersion: FACE_CONSENT_VERSION,
        }
    }
}
