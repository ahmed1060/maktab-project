import { randomBytes } from "node:crypto"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { parsePhoneKey, signatureValid } from "@/lib/attendance/phone-keys"
import { faceKeyText } from "@/lib/attendance/signed-text"
import { assertRecentStepUp } from "@/lib/step-up"
import { AuditLogService } from "./audit-log.service"
import { AttendanceChallengeService } from "./attendance-challenge.service"
import { FaceVerificationService } from "./face-verification.service"

/**
 * Crypto-shredding for the face templates on phones (ATTENDANCE_PLAN.md §10.4).
 *
 * The templates are encrypted on the phone with a key made from two halves:
 * one in the phone's secure hardware, and a per-phone wrapping key held here
 * and fetched at each check-in. Neither half is biometric. A server can't
 * delete data on a phone that is off, lost, or never opens the app again,
 * but destroying the wrapping key makes the templates on it unreadable at
 * once.
 *
 * The key is destroyed on withdrawal, when the person is no longer asked,
 * when the phone leaves use or its owner is archived (a database trigger),
 * and on purge. The phone is then told to delete its unreadable ciphertext,
 * and says when it has.
 */

function fail(code: string): never {
    throw new Error(code)
}

type Actor = { id: string; role: string; isProtected?: boolean; mfaEnabled?: boolean | null; stepUpAt?: number | null }

export class FaceKeyService {
    /**
     * The phone's wrapping key, made the first time, signed for by the phone
     * in use. While face verification is paused, or the company stopped
     * offering it, no key, but the templates stay. When the person withdrew
     * or is no longer asked, the key is destroyed and the phone is told to
     * delete the templates.
     */
    static async fetch(companyId: string, userId: string, input: { nonce: string; keyFingerprint: string; signature: string }) {
        const phone = await prisma.checkInPhone.findFirst({ where: { userId, companyId, keyFingerprint: input.keyFingerprint, status: "ACTIVE" }, select: { id: true, publicKey: true } })
        if (!phone) fail("FACE_PHONE_NOT_ACTIVE")
        const key = parsePhoneKey(phone.publicKey)
        if (!key || !signatureValid(key.key, faceKeyText(input.nonce, input.keyFingerprint), input.signature)) fail("PHONE_SIGNATURE_INVALID")
        const status = await FaceVerificationService.statusFor(userId)
        const person = await prisma.user.findUnique({ where: { id: userId }, select: { faceVerificationRequired: true } })
        return prisma.$transaction(async tx => {
            if (!(await AttendanceChallengeService.consume(tx, userId, "FACE", input.nonce))) fail("PHONE_CHALLENGE_INVALID")
            if (!status.consent || !person?.faceVerificationRequired) {
                await destroy(tx, { phoneId: phone.id })
                return { key: null, deleteTemplates: true }
            }
            // Paused, or the company stopped offering it for now: keep what is enrolled.
            if (!status.company.allowed) return { key: null, deleteTemplates: false }
            const existing = await tx.faceWrappingKey.findUnique({ where: { phoneId: phone.id }, select: { key: true } })
            if (existing?.key) return { key: Buffer.from(existing.key).toString("base64"), deleteTemplates: false }
            // None yet, or one destroyed before (withdrawn, then consented again): a new one.
            // The templates made with the old one stay unreadable.
            const fresh = randomBytes(32)
            await tx.faceWrappingKey.upsert({
                where: { phoneId: phone.id },
                create: { phoneId: phone.id, userId, key: new Uint8Array(fresh) },
                update: { key: new Uint8Array(fresh), destroyedAt: null, deleteAckAt: null },
            })
            return { key: fresh.toString("base64"), deleteTemplates: false }
        })
    }

    /** The phone says it has deleted its templates (§10.4). */
    static async acknowledgeDeletion(companyId: string, userId: string, keyFingerprint: string) {
        const phone = await prisma.checkInPhone.findFirst({ where: { userId, companyId, keyFingerprint }, select: { id: true } })
        if (!phone) return
        await prisma.faceWrappingKey.updateMany({ where: { phoneId: phone.id, key: null, deleteAckAt: null }, data: { deleteAckAt: new Date() } })
    }

    /** Every key of a person, destroyed: consent withdrawn. */
    static async destroyForUser(tx: Prisma.TransactionClient, userId: string) {
        return destroy(tx, { userId })
    }

    /**
     * Pause and purge (§10.4): for when the answer is no. Only the protected
     * Super Admin, with a fresh authenticator code. Destroys every wrapping
     * key, which makes every template on every phone unreadable at that
     * instant; deletes every stored photo and flagged frame; switches the
     * system off. The record says what was destroyed, and phones acknowledge
     * deleting their ciphertext as they check in.
     */
    static async purge(session: { user: Actor }) {
        if (session.user.role !== "SUPER_ADMIN" || !session.user.isProtected) fail("FACE_PROTECTED_ONLY")
        await assertRecentStepUp(session)
        return prisma.$transaction(async tx => {
            const keysDestroyed = await destroy(tx, {})
            const reviewPhotos = await tx.faceReview.count({ where: { photo: { not: null } } })
            await tx.faceReview.updateMany({ where: { status: "PENDING" }, data: { status: "WITHDRAWN", photo: null, decidedAt: new Date() } })
            await tx.faceReview.updateMany({ where: { photo: { not: null } }, data: { photo: null } })
            const { count: frames } = await tx.faceFrame.deleteMany({})
            await tx.checkInPhone.updateMany({ where: { faceStatus: { not: "NONE" } }, data: { faceStatus: "NONE", faceEnrolledAt: null, faceModelVersion: null } })
            await tx.notification.updateMany({ where: { type: "ATTENDANCE_FACE_REVIEW", read: false }, data: { read: true } })
            const previous = (await tx.systemSettings.findUnique({ where: { id: "default" }, select: { faceVerification: true } }))?.faceVerification ?? "OFF"
            await tx.systemSettings.upsert({
                where: { id: "default" },
                update: { faceVerification: "OFF", faceVerificationChangedAt: new Date() },
                create: { id: "default", faceVerification: "OFF", faceVerificationChangedAt: new Date() },
            })
            const record = await tx.facePurge.create({ data: { bySuperAdminId: session.user.id, keysDestroyed, photosDeleted: reviewPhotos + frames } })
            await AuditLogService.log("PURGE_FACE_VERIFICATION", "SYSTEM", "default", {
                tx, superAdminId: session.user.id,
                details: { faceVerification: { old: previous, new: "OFF" }, keysDestroyed, photosDeleted: reviewPhotos + frames },
            })
            return { id: record.id, at: record.at, keysDestroyed, photosDeleted: reviewPhotos + frames }
        })
    }

    /**
     * The last purge, stated as the two separate facts it is (§10.4): the
     * keys destroyed, so every template is unusable, at once and completely;
     * and how many of those phones have since acknowledged deleting theirs.
     */
    static async lastPurge() {
        const last = await prisma.facePurge.findFirst({ orderBy: { at: "desc" } })
        if (!last) return null
        const acknowledged = await prisma.faceWrappingKey.count({ where: { destroyedAt: { lte: last.at }, deleteAckAt: { gte: last.at } } })
        return { at: last.at, keysDestroyed: last.keysDestroyed, photosDeleted: last.photosDeleted, acknowledged }
    }
}

/** Destroys keys still held, matching `where`; how many. */
async function destroy(tx: Prisma.TransactionClient, where: { phoneId?: string; userId?: string }) {
    const { count } = await tx.faceWrappingKey.updateMany({ where: { ...where, key: { not: null } }, data: { key: null, destroyedAt: new Date() } })
    return count
}
