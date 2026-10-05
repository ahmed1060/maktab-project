import { prisma } from "@/lib/prisma"
import type { FaceSystemState } from "@prisma/client"
import { policyOn } from "@/lib/attendance/policy"
import { assertRecentStepUp } from "@/lib/step-up"
import { AttendancePolicyService } from "./attendance-policy.service"
import { AttendanceCalendarService } from "./attendance-calendar.service"
import { AuditLogService } from "./audit-log.service"
import { CompanyService } from "./company.service"
import { hasBundle, resolveBundles } from "@/lib/features/bundles"
import { reverifyOverdue } from "@/lib/attendance/face-overdue"
import { toDateString } from "@/lib/attendance/calendar"

/**
 * Face verification's switches and consent (ATTENDANCE_PLAN.md §9.5, §10.4).
 * It is in use for a person only when every level says so:
 *
 * - the system: on, which only the protected Super Admin can turn it, with a
 *   fresh authenticator code. Paused stops it everywhere and keeps
 *   enrolments.
 * - the company: holds the Mobile App add-on, has confirmed it holds
 *   whatever licence biometric processing needs, and its policy in force
 *   makes the feature available;
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
    static async companyStatus(companyId: string): Promise<{ allowed: boolean; reason: "SYSTEM_OFF" | "SYSTEM_PAUSED" | "NO_MOBILE_APP" | "LEGAL_NOT_CONFIRMED" | "POLICY_OFF" | null; reverifyMonths: number | null }> {
        const system = await this.systemState()
        if (system !== "ON") return { allowed: false, reason: system === "PAUSED" ? "SYSTEM_PAUSED" : "SYSTEM_OFF", reverifyMonths: null }
        // The face check happens in the app: a company without it has nowhere to use it (review on #27).
        if (!(await this.hasMobileApp(companyId))) return { allowed: false, reason: "NO_MOBILE_APP", reverifyMonths: null }
        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { faceLegalConfirmedAt: true } })
        if (!company?.faceLegalConfirmedAt) return { allowed: false, reason: "LEGAL_NOT_CONFIRMED", reverifyMonths: null }
        const today = await AttendanceCalendarService.today(companyId)
        const policy = policyOn(await AttendancePolicyService.versions(companyId), today)
        if (!policy?.body.faceVerificationAvailable) return { allowed: false, reason: "POLICY_OFF", reverifyMonths: null }
        return { allowed: true, reason: null, reverifyMonths: policy.body.faceReverifyMonths }
    }

    /**
     * Re-verifications asked for, or due by the policy's interval, and still
     * not done more than three working days on (§9.5): for the exceptions
     * screen, so they can't quietly be ignored. Not once a new photo waits.
     */
    static async overdueReverifications(companyId: string): Promise<{ userId: string; name: string; since: string }[]> {
        const status = await this.companyStatus(companyId)
        if (!status.allowed) return []
        const today = await AttendanceCalendarService.today(companyId)
        const policy = policyOn(await AttendancePolicyService.versions(companyId), today)
        const workWeek = policy?.body.workWeek ?? [0, 1, 2, 3, 4]
        const people = await prisma.user.findMany({
            where: {
                companyId, faceVerificationRequired: true, status: { notIn: ["DELETED", "ARCHIVED"] },
                checkInPhones: { some: { status: "ACTIVE", faceStatus: "APPROVED" } },
                faceReviews: { none: { status: "PENDING" } },
            },
            select: {
                id: true, firstName: true, lastName: true, faceReverifyRequestedAt: true,
                faceReviews: { where: { companyId, status: "APPROVED", photo: { not: null } }, select: { decidedAt: true }, take: 1 },
            },
            orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        })
        const out: { userId: string; name: string; since: string }[] = []
        for (const p of people) {
            const decided = p.faceReviews[0]?.decidedAt
            const due = status.reverifyMonths && decided ? addMonths(decided, status.reverifyMonths) : null
            const since = [p.faceReverifyRequestedAt, due && due <= new Date() ? due : null]
                .filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0]
            if (since && reverifyOverdue(toDateString(since), today, workWeek)) {
                out.push({ userId: p.id, name: `${p.firstName} ${p.lastName}`.trim(), since: toDateString(since) })
            }
        }
        return out
    }

    /** Whether the company holds the Mobile App add-on, which face verification is part of (§16). */
    static async hasMobileApp(companyId: string): Promise<boolean> {
        const company = await CompanyService.settingsExposure(companyId)
        return !!company && hasBundle(resolveBundles(company.package), "ATTENDANCE_MOBILE")
    }

    /**
     * Asks face verification of a person, or stops asking it. The caller has
     * checked attendance.approve_face over them. Asking needs the company to
     * have it available today; stopping never does.
     */
    static async setRequired(companyId: string, userId: string, required: boolean, actorId: string, actorIsSuperAdmin: boolean) {
        if (required && !(await this.companyStatus(companyId)).allowed) fail("FACE_NOT_AVAILABLE")
        await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
            const person = await tx.user.findFirst({ where: { id: userId, companyId }, select: { faceVerificationRequired: true } })
            if (!person) fail("USER_NOT_FOUND")
            if (person.faceVerificationRequired === required) return
            await tx.user.update({ where: { id: userId }, data: { faceVerificationRequired: required } })
            // No longer asked: what was enrolled goes, photos and phone templates alike (§10.4).
            if (!required) {
                const { FaceReviewService } = await import("./face-review.service")
                await FaceReviewService.forget(tx, userId)
            }
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
            // The lock a key fetch takes: none can make a key again past this (face-key.service.ts).
            await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
            const { count } = await tx.biometricConsent.updateMany({ where: { userId, withdrawnAt: null }, data: { withdrawnAt: new Date() } })
            if (count === 0) return
            // Every photo of them goes, and their phone's face state with it (§10.4).
            const { FaceReviewService } = await import("./face-review.service")
            await FaceReviewService.forget(tx, userId)
            await AuditLogService.log("WITHDRAW_FACE_CONSENT", "USER", userId, { tx, userId, details: { userId } })
        })
    }

    /**
     * Everything the app needs to know about face verification for this
     * person. In use only on their phone in use, once its verification photo
     * is approved (§9.5).
     */
    static async statusFor(userId: string) {
        const person = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true, faceVerificationRequired: true, faceReverifyRequestedAt: true } })
        if (!person?.companyId) {
            return { active: false, required: false, company: { allowed: false, reason: "SYSTEM_OFF" as const }, consent: null, consentVersion: FACE_CONSENT_VERSION, phone: null, pendingReview: false, reverifyDue: false, lastReview: null }
        }
        const [company, consent, phone, pending, reference, lastReview] = await Promise.all([
            this.companyStatus(person.companyId),
            this.currentConsent(userId),
            prisma.checkInPhone.findFirst({ where: { userId, status: "ACTIVE" }, select: { faceStatus: true, faceEnrolledAt: true, faceModelVersion: true } }),
            prisma.faceReview.count({ where: { userId, status: "PENDING" } }),
            prisma.faceReview.findFirst({ where: { companyId: person.companyId, userId, status: "APPROVED", photo: { not: null } }, select: { decidedAt: true } }),
            // The app promotes the templates it sent with this review only once it is approved (lib/mobile/face.ts).
            prisma.faceReview.findFirst({ where: { companyId: person.companyId, userId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } }),
        ])
        const required = company.allowed && person.faceVerificationRequired
        const enrolled = phone?.faceStatus === "APPROVED"
        // Asked for, or due by the policy's interval since the last approval (§9.5).
        const dueBySchedule = !!company.reverifyMonths && !!reference?.decidedAt && addMonths(reference.decidedAt, company.reverifyMonths) <= new Date()
        return {
            active: required && !!consent && enrolled,
            required,
            company: { allowed: company.allowed, reason: company.reason },
            consent,
            consentVersion: FACE_CONSENT_VERSION,
            // Which face model made the approved templates: a phone with another model sets the face up again.
            phone: phone ? { faceStatus: phone.faceStatus, enrolledAt: phone.faceEnrolledAt, modelVersion: phone.faceModelVersion } : null,
            pendingReview: pending > 0,
            reverifyDue: required && enrolled && (!!person.faceReverifyRequestedAt || dueBySchedule),
            lastReview,
        }
    }
}

function addMonths(date: Date, months: number): Date {
    const d = new Date(date)
    d.setUTCMonth(d.getUTCMonth() + months)
    return d
}
