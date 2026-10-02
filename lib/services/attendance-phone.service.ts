import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { AuditLogService } from "./audit-log.service"
import { NotificationService } from "./notification.service"
import { AttendanceChallengeService } from "./attendance-challenge.service"
import { recomputeAfter } from "./attendance-recompute"
import { lockMonths, lockedMonths, punchMonths } from "./attendance-lock"
import type { Visibility } from "./attendance-punch.service"
import { parsePhoneKey, signatureValid, signedText } from "@/lib/attendance/phone-keys"
import { attestationMode, verifyAttestation } from "@/lib/attendance/attestation"
import { holdersOf } from "@/lib/permissions/holders"
import { optional } from "@/lib/notice"
import { addDays, toDateString } from "@/lib/attendance/calendar"

/**
 * The one phone each person checks in from (ATTENDANCE_PLAN.md §9.2, §9.3).
 *
 * - Registering: the app makes a key pair in the phone's secure hardware,
 *   signs a one-time number with it, and sends the public half. It waits,
 *   PENDING, for someone with attendance.approve_devices.
 * - The cutover is the moment of asking: from then on only the new phone's
 *   check-ins are recorded, held (PENDING_DEVICE) until it is decided. The
 *   old phone, if any, cannot check in meanwhile (the check-in decides that).
 * - Approval revokes the old phone and activates the new one in one
 *   transaction, and the held check-ins count. Rejection discards them, and
 *   the old phone checks in again. So two phones never cover the same time.
 * - Asking again while one is pending replaces the pending one, and its held
 *   check-ins go with the new request: an app reinstalled makes a new key.
 * - A lost phone is revoked; its owner registers a new one.
 */

function fail(code: string): never {
    throw new Error(code)
}

async function actorOf(tx: Prisma.TransactionClient, actorId: string) {
    const superAdmin = await tx.superAdmin.findUnique({ where: { id: actorId }, select: { id: true } })
    return superAdmin ? { superAdminId: actorId } : { userId: actorId }
}

/** Where a notice about phones opens: the requests to decide. */
export const PHONE_REQUESTS_PAGE = "/dashboard/attendance?tab=requests"

const reasonParam = (reason: string | null) => optional("notice_reason_suffix", { reason: reason ?? "" }, reason)

export type RegisterInput = {
    nonce: string
    publicKey: string
    signature: string
    platform: "ANDROID" | "IOS"
    model?: string | null
    appVersion?: string | null
    attestation?: string | null
}

const SHOWN = {
    id: true, userId: true, platform: true, model: true, appVersion: true, attested: true,
    status: true, requestedAt: true, decidedAt: true, reason: true,
} as const

/** One person at a time: their phones change together, or not at all. */
async function lockPerson(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
}

function visibleWhere(v: Visibility): Prisma.CheckInPhoneWhereInput {
    if (v.kind === "COMPANY") return {}
    if (v.kind === "TEAM") return { user: { teamLeaderId: v.leaderId } }
    return { userId: v.userId }
}

export class AttendancePhoneService {
    /**
     * A phone asks to be the one this person checks in from. The text it
     * signed names the key itself, so a signature can't be lifted onto
     * another key.
     */
    static async register(companyId: string, userId: string, input: RegisterInput) {
        const key = parsePhoneKey(input.publicKey) ?? fail("PHONE_KEY_INVALID")
        const text = signedText("REGISTER", input.nonce, [key.fingerprint, input.platform])
        if (!signatureValid(key.key, text, input.signature)) fail("PHONE_SIGNATURE_INVALID")
        const attestation = await verifyAttestation({ platform: input.platform, token: input.attestation, challenge: input.nonce })
        if (!attestation.verified && attestationMode() === "required") fail("PHONE_ATTESTATION_FAILED")

        const out = await prisma.$transaction(async tx => {
            if (!(await AttendanceChallengeService.consume(tx, userId, "REGISTER", input.nonce))) fail("PHONE_CHALLENGE_INVALID")
            await lockPerson(tx, userId)
            const known = await tx.checkInPhone.findUnique({ where: { keyFingerprint: key.fingerprint }, select: { ...SHOWN, userId: true } })
            if (known) {
                // The same phone asking twice (a retry): the same answer.
                if (known.userId === userId && (known.status === "PENDING" || known.status === "ACTIVE")) return { phone: known, fresh: false }
                fail("PHONE_KEY_IN_USE")
            }
            const replaced = await tx.checkInPhone.findFirst({ where: { userId, status: "PENDING" }, select: { id: true } })
            if (replaced) await tx.checkInPhone.update({ where: { id: replaced.id }, data: { status: "WITHDRAWN", decidedAt: new Date() } })
            const phone = await tx.checkInPhone.create({
                data: {
                    companyId, userId, publicKey: key.der.toString("base64"), keyFingerprint: key.fingerprint, platform: input.platform,
                    model: input.model?.trim().slice(0, 80) || null, appVersion: input.appVersion?.trim().slice(0, 40) || null,
                    attested: attestation.verified,
                },
                select: SHOWN,
            })
            // What the replaced request was holding waits for this one instead.
            if (replaced) await tx.attendancePunch.updateMany({ where: { phoneId: replaced.id, status: "PENDING_DEVICE" }, data: { phoneId: phone.id } })
            await AuditLogService.log("REGISTER_CHECK_IN_PHONE", "CHECK_IN_PHONE", phone.id, {
                tx, userId, details: { companyId, userId, platform: phone.platform, model: phone.model, attested: phone.attested, replaced: replaced?.id ?? null },
            })
            // In the same transaction: a request nobody hears about would wait forever.
            await AttendancePhoneService.tellDeciders(tx, companyId, userId, phone.model)
            return { phone, fresh: true }
        })
        return out.phone
    }

    /** Whoever may approve this person's phone: the company's deciders, and their team leader if theirs is the team scope. */
    private static async tellDeciders(tx: Prisma.TransactionClient, companyId: string, userId: string, model: string | null) {
        const person = await tx.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, teamLeaderId: true } })
        if (!person) return
        const deciders = await tx.user.findMany({
            where: {
                id: { not: userId }, status: { in: ["ACTIVE", "OFFLINE"] },
                OR: [
                    { companyId, ...holdersOf("attendance.approve_devices", "COMPANY") },
                    ...(person.teamLeaderId ? [{ id: person.teamLeaderId, companyId, ...holdersOf("attendance.approve_devices", "TEAM") }] : []),
                ],
            },
            select: { id: true },
        })
        await NotificationService.notifyMany(deciders.map(d => d.id), "ATTENDANCE_PHONE", {
            key: "notice_att_phone_requested",
            params: { name: `${person.firstName} ${person.lastName}`.trim(), model: model ?? "" },
        }, PHONE_REQUESTS_PAGE, tx)
    }

    /** This person's phone in use, and the one they asked for, if any. */
    static async mine(userId: string) {
        const phones = await prisma.checkInPhone.findMany({ where: { userId, status: { in: ["ACTIVE", "PENDING"] } }, select: SHOWN })
        return { active: phones.find(p => p.status === "ACTIVE") ?? null, pending: phones.find(p => p.status === "PENDING") ?? null }
    }

    /** Asked for a new phone and changed their mind: the old one checks in again, and what the new one held is discarded. */
    static async withdraw(userId: string) {
        const out = await prisma.$transaction(async tx => {
            await lockPerson(tx, userId)
            const pending = await tx.checkInPhone.findFirst({ where: { userId, status: "PENDING" }, select: { id: true, companyId: true } }) ?? fail("PHONE_NOTHING_PENDING")
            await tx.checkInPhone.update({ where: { id: pending.id }, data: { status: "WITHDRAWN", decidedAt: new Date() } })
            const discarded = await tx.attendancePunch.updateMany({ where: { phoneId: pending.id, status: "PENDING_DEVICE" }, data: { status: "REJECTED" } })
            await AuditLogService.log("WITHDRAW_CHECK_IN_PHONE", "CHECK_IN_PHONE", pending.id, { tx, userId, details: { companyId: pending.companyId, userId, discarded: discarded.count } })
            return pending
        })
        return { withdrawn: out.id }
    }

    static async phoneOf(id: string) {
        return prisma.checkInPhone.findUnique({ where: { id }, select: { id: true, companyId: true, userId: true, status: true, user: { select: { teamLeaderId: true } } } })
    }

    /** For the people deciding: those waiting, and those in use, with who they belong to and what each holds. */
    static async list(companyId: string, visible: Visibility) {
        const phones = await prisma.checkInPhone.findMany({
            where: { companyId, status: { in: ["PENDING", "ACTIVE"] }, ...visibleWhere(visible) },
            select: { ...SHOWN, user: { select: { firstName: true, lastName: true, teamLeaderId: true } }, _count: { select: { punches: { where: { status: "PENDING_DEVICE" } } } } },
            orderBy: [{ status: "desc" }, { requestedAt: "asc" }],
        })
        return phones.map(({ user, _count, ...p }) => ({ ...p, name: `${user.firstName} ${user.lastName}`.trim(), teamLeaderId: user.teamLeaderId, held: _count.punches }))
    }

    /**
     * Approved: the old phone is revoked and this one is the one, together,
     * and what it held counts. Rejected: what it held is discarded, and the
     * old phone checks in again. Never one's own (the route asks can()).
     */
    static async decide(id: string, decision: { approve: boolean; reason?: string | null }, deciderId: string) {
        const reason = decision.approve ? null : decision.reason?.trim().slice(0, 500) || null
        const out = await prisma.$transaction(async tx => {
            const phone = await tx.checkInPhone.findUnique({ where: { id }, select: { userId: true, companyId: true, model: true } }) ?? fail("PHONE_NOT_FOUND")
            if (phone.userId === deciderId) fail("CANNOT_DECIDE_OWN")
            await lockPerson(tx, phone.userId)
            const now = new Date()
            // Read again under the lock: a withdrawal or another decision may have come first.
            const still = await tx.checkInPhone.findFirst({ where: { id, status: "PENDING" }, select: { id: true } })
            if (!still) fail("PHONE_NOT_PENDING")
            // The old phone goes first: a person has one phone in use at a time.
            let replaced: string | null = null
            if (decision.approve) {
                const old = await tx.checkInPhone.findFirst({ where: { userId: phone.userId, status: "ACTIVE" }, select: { id: true } })
                if (old) {
                    replaced = old.id
                    await tx.checkInPhone.update({ where: { id: old.id }, data: { status: "REVOKED", decidedAt: now, decidedById: deciderId, reason: "REPLACED" } })
                }
            }
            await tx.checkInPhone.update({ where: { id }, data: { status: decision.approve ? "ACTIVE" : "REJECTED", decidedAt: now, decidedById: deciderId, reason } })
            const held = await tx.attendancePunch.findMany({ where: { phoneId: id, status: "PENDING_DEVICE" }, select: { punchAtLocal: true }, orderBy: { punchAtLocal: "asc" }, take: 1 })
            // A check-in held in a month whose payroll was approved meanwhile
            // can't count now: that month is closed to every punch (§12.1,
            // review on #22). Locked as any punch write is, then discarded.
            if (decision.approve) {
                const waiting = await tx.attendancePunch.findMany({ where: { phoneId: id, status: "PENDING_DEVICE" }, select: { id: true, punchAtLocal: true } })
                const monthsOf = new Map<string, string[]>()
                for (const w of waiting) monthsOf.set(w.id, await punchMonths(tx, phone.companyId, phone.userId, w.punchAtLocal.toISOString().slice(0, 19)))
                const months = [...new Set([...monthsOf.values()].flat())]
                await lockMonths(tx, phone.companyId, months)
                const closed = await lockedMonths(tx, phone.companyId, months)
                const late = waiting.filter(w => monthsOf.get(w.id)!.some(m => closed.has(m))).map(w => w.id)
                if (late.length > 0) await tx.attendancePunch.updateMany({ where: { id: { in: late } }, data: { status: "REJECTED" } })
            }
            // Approved, what it held counts, or is flagged with the reasons it
            // was held with (§9.6); rejected, it is discarded.
            const flagged = decision.approve
                ? await tx.attendancePunch.updateMany({ where: { phoneId: id, status: "PENDING_DEVICE", NOT: { flagReasons: { isEmpty: true } } }, data: { status: "FLAGGED" } })
                : { count: 0 }
            const released = await tx.attendancePunch.updateMany({ where: { phoneId: id, status: "PENDING_DEVICE" }, data: { status: decision.approve ? "ACCEPTED" : "REJECTED" } })
            await AuditLogService.log(decision.approve ? "APPROVE_CHECK_IN_PHONE" : "REJECT_CHECK_IN_PHONE", "CHECK_IN_PHONE", id, {
                tx, ...(await actorOf(tx, deciderId)),
                details: { companyId: phone.companyId, userId: phone.userId, model: phone.model, reason, replaced, punches: released.count + flagged.count },
            })
            await NotificationService.notify(phone.userId, "ATTENDANCE_PHONE", {
                key: decision.approve ? "notice_att_phone_approved" : "notice_att_phone_rejected",
                params: { model: phone.model ?? "", reason: reasonParam(reason) },
            }, undefined, tx)
            return { ...phone, from: held[0] ? toDateString(held[0].punchAtLocal) : null, counted: decision.approve && released.count > 0 }
        })
        // The check-ins it held now count: the days they fall on are worked out again.
        // From the day before: an early check-in may end the night shift that began then.
        if (out.counted && out.from) await recomputeAfter(out.companyId, addDays(out.from, -1), [out.userId])
    }

    /** Lost, stolen, or left: it checks in no more. Its owner registers a new one. */
    static async revoke(id: string, actorId: string, reasonText?: string | null) {
        const reason = reasonText?.trim().slice(0, 500) || null
        await prisma.$transaction(async tx => {
            const phone = await tx.checkInPhone.findUnique({ where: { id }, select: { userId: true, companyId: true, model: true } }) ?? fail("PHONE_NOT_FOUND")
            if (phone.userId === actorId) fail("CANNOT_DECIDE_OWN")
            const { count } = await tx.checkInPhone.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "REVOKED", decidedAt: new Date(), decidedById: actorId, reason } })
            if (count === 0) fail("PHONE_NOT_ACTIVE")
            await AuditLogService.log("REVOKE_CHECK_IN_PHONE", "CHECK_IN_PHONE", id, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId: phone.companyId, userId: phone.userId, model: phone.model, reason },
            })
            await NotificationService.notify(phone.userId, "ATTENDANCE_PHONE", { key: "notice_att_phone_revoked", params: { model: phone.model ?? "", reason: reasonParam(reason) } }, undefined, tx)
        })
    }
}
