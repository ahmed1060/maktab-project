import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { parsePhoneKey, signatureValid } from "@/lib/attendance/phone-keys"
import { faceText } from "@/lib/attendance/signed-text"
import { attestationMode, verifyAttestation, type AttestationResult } from "@/lib/attendance/attestation"
import { encryptFacePhoto, decryptFacePhoto, isJpeg } from "@/lib/face-photo-crypto"
import { holdersOf } from "@/lib/permissions/holders"
import { noticeRow } from "@/lib/notice-row"
import { optional } from "@/lib/notice"
import { AuditLogService } from "./audit-log.service"
import { NotificationService } from "./notification.service"
import { AttendanceChallengeService } from "./attendance-challenge.service"
import { FaceVerificationService } from "./face-verification.service"

/**
 * The verification photo and its review (ATTENDANCE_PLAN.md §9.5).
 *
 * The face templates stay on the phone, so the server can't tell whose face
 * was enrolled. One live photo, matched against them on the phone, is sent
 * so that a person who knows the employee confirms it is them: at enrolment,
 * and on each re-verification. Until approved, face verification stays
 * inactive for the person.
 *
 * The photo is the most sensitive thing stored:
 * - encrypted with its own key (lib/face-photo-crypto.ts);
 * - deleted when rejected, replaced or withdrawn (the database refuses one
 *   kept in any other state);
 * - shown only while a review is open, through the review: nothing returns
 *   it by employee;
 * - every view is audited.
 */

export const FACE_REVIEW = "ATTENDANCE_FACE_REVIEW"
export const FACE_DECIDED = "ATTENDANCE_FACE"
/** Large enough for a well-compressed portrait, small enough to keep in the database. */
export const MAX_PHOTO_BYTES = 400 * 1024

/** Where a notice about a review opens. */
export const faceReviewLink = (reviewId: string) => `/dashboard/attendance?tab=face&review=${reviewId}`

function fail(code: string): never {
    throw new Error(code)
}

export type SubmitInput = {
    nonce: string
    keyFingerprint: string
    signature: string
    /** The photo, JPEG, base64. */
    photo: string
    /** The face model on the phone, so the server knows what was enrolled with what. */
    modelVersion: string
    attestation?: string | null
}

type Reviewer = { id: string; isSuperAdmin: boolean }

export class FaceReviewService {
    /**
     * A verification photo from the person's phone in use. Enrolment the
     * first time, re-verification once the phone is approved. A photo still
     * waiting is replaced, its photo deleted.
     */
    static async submit(companyId: string, userId: string, input: SubmitInput) {
        const status = await FaceVerificationService.statusFor(userId)
        if (!status.required) fail("FACE_NOT_REQUIRED")
        if (!status.consent) fail("FACE_CONSENT_REQUIRED")
        const photo = Buffer.from(input.photo, "base64")
        if (photo.length === 0 || photo.length > MAX_PHOTO_BYTES || !isJpeg(photo)) fail("FACE_PHOTO_INVALID")
        const phone = await prisma.checkInPhone.findFirst({
            where: { userId, companyId, keyFingerprint: input.keyFingerprint, status: "ACTIVE" },
            select: { id: true, publicKey: true, platform: true, faceStatus: true, appAttestKey: true, appAttestCounter: true },
        })
        if (!phone) fail("FACE_PHONE_NOT_ACTIVE")
        const key = parsePhoneKey(phone.publicKey)
        const photoSha256 = createHash("sha256").update(photo).digest("hex")
        if (!key || !signatureValid(key.key, faceText({ ...input, photoSha256 }), input.signature)) fail("PHONE_SIGNATURE_INVALID")
        // Google and Apple only for a request that could count (review on #26).
        if (!(await AttendanceChallengeService.isLive(userId, "FACE", input.nonce))) fail("PHONE_CHALLENGE_INVALID")
        let attestation: AttestationResult = await verifyAttestation({ platform: phone.platform, token: input.attestation, challenge: input.nonce, purpose: "FACE", phone })
        if (!attestation.verified && attestationMode() === "required") fail("PHONE_ATTESTATION_FAILED")
        const purpose = phone.faceStatus === "APPROVED" ? "REVERIFY" as const : "ENROLMENT" as const
        const stored = encryptFacePhoto(photo)

        const review = await prisma.$transaction(async tx => {
            if (!(await AttendanceChallengeService.consume(tx, userId, "FACE", input.nonce))) fail("PHONE_CHALLENGE_INVALID")
            // Asked and consented, checked again under the locks withdrawal, "no
            // longer asked" and purge take: none of them can finish deleting the
            // person's photos and then have this one stored after (review on #27).
            await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
            await tx.$queryRaw`SELECT id FROM "SystemSettings" WHERE id = 'default' FOR SHARE`
            const [current] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "CheckInPhone" WHERE id = ${phone.id} FOR SHARE`
            if (current?.status !== "ACTIVE") fail("FACE_PHONE_NOT_ACTIVE")
            const now = await FaceVerificationService.statusFor(userId)
            if (!now.required) fail("FACE_NOT_REQUIRED")
            if (!now.consent) fail("FACE_CONSENT_REQUIRED")
            if (attestation.appAttest) {
                const { count } = await tx.checkInPhone.updateMany({
                    where: { id: phone.id, appAttestCounter: { lt: attestation.appAttest.counter } },
                    data: { appAttestCounter: attestation.appAttest.counter },
                })
                if (count === 0) {
                    attestation = { verified: false, reason: "BAD_COUNTER" }
                    // A replayed or raced assertion: refused when attestation is required, as at check-in (review on #27).
                    if (attestationMode() === "required") fail("PHONE_ATTESTATION_FAILED")
                }
            }
            const waiting = await tx.faceReview.findFirst({ where: { userId, status: "PENDING" }, select: { id: true } })
            if (waiting) {
                await tx.faceReview.update({ where: { id: waiting.id }, data: { status: "WITHDRAWN", photo: null, decidedAt: new Date() } })
                await resolveNotices(tx, waiting.id)
            }
            const created = await tx.faceReview.create({
                data: { companyId, userId, phoneId: phone.id, purpose, photo: new Uint8Array(stored), modelVersion: input.modelVersion.slice(0, 60), attested: attestation.verified },
                select: { id: true, purpose: true, status: true, createdAt: true },
            })
            if (purpose === "ENROLMENT") {
                await tx.checkInPhone.update({ where: { id: phone.id }, data: { faceStatus: "PENDING", faceModelVersion: input.modelVersion.slice(0, 60) } })
            }
            await AuditLogService.log("SUBMIT_FACE_PHOTO", "FACE_REVIEW", created.id, {
                tx, userId, details: { companyId, userId, purpose, attested: attestation.verified, attestationReason: attestation.reason },
            })
            await tellReviewers(tx, companyId, userId, created.id)
            return created
        })
        return review
    }

    /** Open reviews for a company, newest last. No photos: those come one at a time, audited. */
    static async open(companyId: string, exceptUserId: string | null) {
        const rows = await prisma.faceReview.findMany({
            where: { companyId, status: "PENDING", ...(exceptUserId ? { userId: { not: exceptUserId } } : {}) },
            orderBy: { createdAt: "asc" },
            select: {
                id: true, userId: true, purpose: true, createdAt: true, attested: true,
                user: { select: { firstName: true, lastName: true } },
            },
        })
        const withReference = await prisma.faceReview.findMany({
            where: { companyId, userId: { in: rows.map(r => r.userId) }, status: "APPROVED", photo: { not: null } },
            select: { userId: true },
        })
        const has = new Set(withReference.map(r => r.userId))
        return rows.map(r => ({
            id: r.id, userId: r.userId, name: `${r.user.firstName} ${r.user.lastName}`.trim(), purpose: r.purpose,
            createdAt: r.createdAt, attested: r.attested, hasReference: has.has(r.userId),
        }))
    }

    static async reviewOf(id: string) {
        return prisma.faceReview.findUnique({ where: { id }, select: { id: true, companyId: true, userId: true, status: true, user: { select: { teamLeaderId: true } } } })
    }

    /**
     * One photo of an open review: the new one, or the person's current
     * reference beside it. Refused once the review is decided, so nothing
     * reaches a photo but an open review. Every view is audited.
     */
    static async photo(reviewId: string, which: "new" | "reference", viewer: Reviewer): Promise<Buffer> {
        const review = await prisma.faceReview.findUnique({ where: { id: reviewId }, select: { id: true, companyId: true, userId: true, status: true, photo: true } })
        if (!review || review.status !== "PENDING") fail("FACE_REVIEW_CLOSED")
        const stored = which === "new"
            ? review.photo
            : await referenceOf(review.companyId, review.userId)
        if (!stored) fail("FACE_PHOTO_NONE")
        await AuditLogService.log("VIEW_FACE_PHOTO", "FACE_REVIEW", review.id, {
            ...(viewer.isSuperAdmin ? { superAdminId: viewer.id } : { userId: viewer.id }),
            details: { companyId: review.companyId, userId: review.userId, which },
        })
        return decryptFacePhoto(Buffer.from(stored))
    }

    /**
     * A flagged check-in's failed frame, or the person's reference photo
     * beside it (§13.8): only while the flag is open, every view audited.
     */
    static async flaggedPhoto(punchId: string, which: "frame" | "reference", viewer: Reviewer): Promise<Buffer> {
        const punch = await prisma.attendancePunch.findUnique({ where: { id: punchId }, select: { id: true, companyId: true, userId: true, status: true, voidedAt: true, flagReasons: true, faceFrame: { select: { photo: true } } } })
        if (!punch || !punch.userId || punch.status !== "FLAGGED" || punch.voidedAt) fail("FACE_REVIEW_CLOSED")
        // Only a check-in flagged for its face check: one flagged for its place alone is no reason to see a face (review on #27).
        if (!punch.flagReasons.includes("FACE_UNVERIFIED")) fail("FACE_PHOTO_NONE")
        const stored = which === "frame"
            ? punch.faceFrame?.photo ?? null
            : await referenceOf(punch.companyId, punch.userId)
        if (!stored) fail("FACE_PHOTO_NONE")
        await AuditLogService.log("VIEW_FACE_PHOTO", "ATTENDANCE_PUNCH", punch.id, {
            ...(viewer.isSuperAdmin ? { superAdminId: viewer.id } : { userId: viewer.id }),
            details: { companyId: punch.companyId, userId: punch.userId, which },
        })
        return decryptFacePhoto(Buffer.from(stored))
    }

    /**
     * Approves or rejects an open review. Approval makes the new photo the
     * reference, deleting the one before, and activates face verification on
     * the phone. Rejection deletes the new photo; an earlier reference stays,
     * but face verification is off for the person until they set it up
     * again.
     */
    static async decide(reviewId: string, approve: boolean, reason: string | null, reviewer: Reviewer) {
        return prisma.$transaction(async tx => {
            const review = await tx.faceReview.findUnique({ where: { id: reviewId }, select: { id: true, companyId: true, userId: true, phoneId: true, purpose: true, status: true } })
            if (!review) fail("FACE_REVIEW_NOT_FOUND")
            // One decision: the conditional write is the lock.
            const decided = { decidedAt: new Date(), reason: reason?.trim().slice(0, 500) || null, ...(reviewer.isSuperAdmin ? { decidedBySuperAdminId: reviewer.id } : { decidedById: reviewer.id }) }
            if (approve) {
                await tx.faceReview.updateMany({ where: { userId: review.userId, status: "APPROVED", photo: { not: null } }, data: { photo: null } })
            }
            const { count } = await tx.faceReview.updateMany({
                where: { id: reviewId, status: "PENDING" },
                data: approve ? { status: "APPROVED", ...decided } : { status: "REJECTED", photo: null, ...decided },
            })
            if (count === 0) fail("FACE_REVIEW_CLOSED")
            await tx.checkInPhone.update({
                where: { id: review.phoneId },
                data: approve ? { faceStatus: "APPROVED", ...(review.purpose === "ENROLMENT" ? { faceEnrolledAt: new Date() } : {}) } : { faceStatus: "REJECTED" },
            })
            if (approve) await tx.user.update({ where: { id: review.userId }, data: { faceReverifyRequestedAt: null, faceReverifyRequestedById: null } })
            await resolveNotices(tx, reviewId)
            await AuditLogService.log(approve ? "APPROVE_FACE_PHOTO" : "REJECT_FACE_PHOTO", "FACE_REVIEW", reviewId, {
                tx, ...(reviewer.isSuperAdmin ? { superAdminId: reviewer.id } : { userId: reviewer.id }),
                details: { companyId: review.companyId, userId: review.userId, purpose: review.purpose, ...(decided.reason ? { reason: decided.reason } : {}) },
            })
            await NotificationService.notify(review.userId, FACE_DECIDED, {
                key: approve ? "notice_face_approved" : "notice_face_rejected", params: { reason: optional("notice_reason_suffix", { reason: decided.reason ?? "" }, decided.reason) },
            }, "/dashboard/check-in", tx)
            return { id: reviewId, status: approve ? "APPROVED" : "REJECTED" }
        })
    }

    /** Asks the person to verify their face again (§9.5): their next check-in opens the capture first. */
    static async requestReverify(companyId: string, userId: string, reviewer: Reviewer) {
        await prisma.$transaction(async tx => {
            const person = await tx.user.findFirst({ where: { id: userId, companyId }, select: { id: true } })
            if (!person) fail("USER_NOT_FOUND")
            const phone = await tx.checkInPhone.findFirst({ where: { userId, status: "ACTIVE", faceStatus: "APPROVED" }, select: { id: true } })
            if (!phone) fail("FACE_NOT_ENROLLED")
            await tx.user.update({ where: { id: userId }, data: { faceReverifyRequestedAt: new Date(), faceReverifyRequestedById: reviewer.isSuperAdmin ? null : reviewer.id } })
            await AuditLogService.log("REQUEST_FACE_REVERIFY", "USER", userId, {
                tx, ...(reviewer.isSuperAdmin ? { superAdminId: reviewer.id } : { userId: reviewer.id }), details: { companyId, userId },
            })
            await NotificationService.notify(userId, FACE_DECIDED, { key: "notice_face_reverify" }, "/dashboard/check-in", tx)
        })
    }

    /**
     * Deletes every face photo of a person, and every frame of a failed check, resets their phones' face state and
     * destroys their phones' wrapping keys: on consent withdrawal, or when it
     * is no longer asked of them (§10.4). Records stay, without photos.
     */
    static async forget(tx: Prisma.TransactionClient, userId: string) {
        const waiting = await tx.faceReview.findMany({ where: { userId, status: "PENDING" }, select: { id: true } })
        for (const w of waiting) await resolveNotices(tx, w.id)
        await tx.faceReview.updateMany({ where: { userId, status: "PENDING" }, data: { status: "WITHDRAWN", photo: null, decidedAt: new Date() } })
        await tx.faceReview.updateMany({ where: { userId, photo: { not: null } }, data: { photo: null } })
        // The frames of failed checks still waiting for review are photos of them too (review on #27).
        await tx.faceFrame.deleteMany({ where: { userId } })
        await tx.checkInPhone.updateMany({ where: { userId }, data: { faceStatus: "NONE", faceEnrolledAt: null, faceModelVersion: null } })
        // And the templates on their phones become unreadable at once (§10.4, lib/services/face-key.service.ts).
        await tx.faceWrappingKey.updateMany({ where: { userId, key: { not: null } }, data: { key: null, destroyedAt: new Date() } })
        await tx.user.update({ where: { id: userId }, data: { faceReverifyRequestedAt: null, faceReverifyRequestedById: null } })
    }
}

/**
 * The person's approved photo in this company. A person moved from another
 * company leaves that company's photo behind: no reviewer here sees it
 * (review on #27).
 */
async function referenceOf(companyId: string, userId: string) {
    const row = await prisma.faceReview.findFirst({ where: { companyId, userId, status: "APPROVED", photo: { not: null } }, select: { photo: true } })
    return row?.photo ?? null
}

/**
 * Whoever decides: the company's holders of attendance.approve_face and every
 * Super Admin. A critical notice, red and pinned until someone decides (§13.4).
 */
async function tellReviewers(tx: Prisma.TransactionClient, companyId: string, userId: string, reviewId: string) {
    const person = await tx.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } })
    const name = `${person?.firstName ?? ""} ${person?.lastName ?? ""}`.trim()
    const [reviewers, superAdmins] = await Promise.all([
        tx.user.findMany({
            where: { id: { not: userId }, companyId, status: { in: ["ACTIVE", "OFFLINE"] }, ...holdersOf("attendance.approve_face", "COMPANY") },
            select: { id: true },
        }),
        tx.superAdmin.findMany({ select: { id: true } }),
    ])
    const row = { type: FACE_REVIEW, priority: "CRITICAL" as const, ...noticeRow({ key: "notice_face_review", params: { name } }) }
    if (reviewers.length > 0) {
        await tx.notification.createMany({ data: reviewers.map(r => ({ userId: r.id, ...row, relatedId: faceReviewLink(reviewId) })) })
    }
    if (superAdmins.length > 0) {
        // The Super Admin has no company of their own: the link says which.
        await tx.notification.createMany({ data: superAdmins.map(s => ({ superAdminId: s.id, ...row, relatedId: `/dashboard/attendance?tab=face&companyId=${companyId}&review=${reviewId}` })) })
    }
}

/** A decided review's notices stop being critical: they are read for everyone. */
async function resolveNotices(tx: Prisma.TransactionClient, reviewId: string) {
    await tx.notification.updateMany({ where: { type: FACE_REVIEW, read: false, relatedId: { endsWith: `review=${reviewId}` } }, data: { read: true } })
}
