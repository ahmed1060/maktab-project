import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { AttendanceChallengeService } from "./attendance-challenge.service"
import { AttendanceLocationService } from "./attendance-location.service"
import { recomputeAfter } from "./attendance-recompute"
import { lockMonths, lockedMonths, punchMonths } from "./attendance-lock"
import { parsePhoneKey, signatureValid } from "@/lib/attendance/phone-keys"
import { checkInText } from "@/lib/attendance/signed-text"
import { attestationMode, verifyAttestation, type AttestationResult } from "@/lib/attendance/attestation"
import { judgeCheckIn, type FlagReason } from "@/lib/attendance/check-in-rules"
import { addDays, formatMinutes, toDateString } from "@/lib/attendance/calendar"
import { localToInstant } from "@/lib/attendance/punch-import"
import { employmentSpans, suspensionSpans } from "@/lib/employment"
import { assignPunches } from "@/lib/attendance/engine"
import { AttendanceEngineService } from "./attendance-engine.service"
import { DEFAULT_TIME_ZONE, offsetMsIn } from "@/lib/time"

/**
 * Checking in with the app (ATTENDANCE_PLAN.md §9.2, §9.4, §9.6).
 *
 * The app asks for a one-time number, takes a location fix, and signs the
 * number and the fix with the phone's key. Here the signature is checked
 * against the phone this person registered, the number is used up, and the
 * rules (lib/attendance/check-in-rules.ts) decide: refused, flagged, held
 * for the phone's approval, or accepted. The time is the server's, never the
 * phone's: a phone's clock is the phone owner's to set.
 *
 * A refusal is recorded for the integrity view and counts for nothing. Any
 * other outcome is a punch, the evidence stored with it; only an accepted
 * one counts until a person decides (P3.4).
 */

export type CheckInInput = {
    nonce: string
    /** The fingerprint of the key that signed: which of the person's phones this is. */
    keyFingerprint: string
    signature: string
    latitude: number
    longitude: number
    accuracyMeters: number
    mocked: boolean
    direction?: "IN" | "OUT" | null
    attestation?: string | null
}

export type CheckInResult =
    | { outcome: "REFUSED"; reason: string }
    | {
        outcome: "ACCEPTED" | "FLAGGED" | "HELD"; reasons: FlagReason[]; place: { id: string; name: string }; distanceMeters: number; at: string
        /** The day's first check-in, past its start and its grace: the app offers to ask for permission hours (§13.6). */
        late: { minutes: number; startsAt: string } | null
    }

function fail(code: string): never {
    throw new Error(code)
}

/** Signed by the phone; shared with the check-in screen so the two always agree. */
export { checkInText }

const STATUS = { ACCEPTED: "ACCEPTED", FLAGGED: "FLAGGED", HELD: "PENDING_DEVICE" } as const

export class AttendanceCheckInService {
    static async checkIn(companyId: string, userId: string, input: CheckInInput, ip: string | null, now = new Date()): Promise<CheckInResult> {
        // The phone by its key; its status is read again under the lock below.
        const phone = await prisma.checkInPhone.findFirst({
            where: { userId, keyFingerprint: input.keyFingerprint },
            select: { id: true, publicKey: true, platform: true, appAttestKey: true, appAttestCounter: true },
        })
        // A key we don't know can't be checked: there is nothing to check it with.
        const key = phone ? parsePhoneKey(phone.publicKey) : null
        const badSignature = !!phone && !(key && signatureValid(key.key, checkInText(input), input.signature))
        // Google and Apple only for a request that could count: our phone, its
        // signature, a number not yet used. Anything else is refused below
        // without a call that spends the app's quota (review on #26).
        const worthAsking = !!phone && !badSignature && (await AttendanceChallengeService.isLive(userId, "CHECK_IN", input.nonce, now))
        let attestation: AttestationResult = worthAsking
            ? await verifyAttestation({ platform: phone.platform, token: input.attestation, challenge: input.nonce, purpose: "CHECK_IN", phone })
            : { verified: false, reason: "NOT_CHECKED" }
        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } })
        const timeZone = company?.timezone ?? DEFAULT_TIME_ZONE
        const local = new Date(now.getTime() + offsetMsIn(now, timeZone)).toISOString().slice(0, 19)

        const out = await prisma.$transaction(async tx => {
            // The number first, even for a bad signature: one recorded failure
            // per number given, never one per request replayed (review on #22).
            if (!(await AttendanceChallengeService.consume(tx, userId, "CHECK_IN", input.nonce, now))) fail("PHONE_CHALLENGE_INVALID")
            if (badSignature) {
                await AttendanceCheckInService.refuse(tx, companyId, userId, phone!.id, "BAD_SIGNATURE", ip, now)
                return { result: null, counts: false }
            }
            // The same lock a phone's approval, rejection or revocation takes:
            // the phone's state can't change between reading it and storing
            // the check-in (review on #22).
            await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
            const current = phone ? await tx.checkInPhone.findUnique({ where: { id: phone.id }, select: { status: true } }) : null
            // App Attest's counter, moved on only if it is still below this one: the
            // verifier read it before the lock, and a stale read must not count twice.
            if (phone && attestation.appAttest) {
                const { count } = await tx.checkInPhone.updateMany({
                    where: { id: phone.id, appAttestCounter: { lt: attestation.appAttest.counter } },
                    data: { appAttestCounter: attestation.appAttest.counter },
                })
                if (count === 0) attestation = { verified: false, reason: "BAD_COUNTER" }
            }
            const waiting = await tx.checkInPhone.count({ where: { userId, status: "PENDING" } })
            const places = await AttendanceLocationService.forPerson(companyId, userId)
            const verdict = judgeCheckIn({
                phone: current,
                newPhoneWaiting: waiting > 0,
                fix: { latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters },
                mocked: input.mocked,
                attestation: { verified: attestation.verified, required: attestationMode() === "required" },
                places, ip,
            })
            if (verdict.outcome === "REFUSED") {
                await AttendanceCheckInService.refuse(tx, companyId, userId, phone?.id ?? null, verdict.reason, ip, now, { latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters })
                return { result: { outcome: "REFUSED" as const, reason: verdict.reason }, counts: false }
            }

            // A month whose payroll is approved takes no more attendance, as for every other punch.
            const months = await punchMonths(tx, companyId, userId, local)
            await lockMonths(tx, companyId, months)
            if ((await lockedMonths(tx, companyId, months)).size > 0) {
                await AttendanceCheckInService.refuse(tx, companyId, userId, phone!.id, "MONTH_LOCKED", ip, now)
                return { result: { outcome: "REFUSED" as const, reason: "MONTH_LOCKED" }, counts: false }
            }

            const punch = await tx.attendancePunch.create({
                select: { id: true },
                data: {
                    companyId, userId, source: "MOBILE",
                    // One punch per number signed: the number is used once, so its hash is the punch's identity.
                    sourceKey: createHash("sha256").update(input.nonce).digest("hex"),
                    phoneId: phone!.id, workLocationId: verdict.place.id,
                    punchAtLocal: new Date(`${local}Z`), punchAt: now, resolvedWithTimeZone: timeZone,
                    direction: input.direction ?? null,
                    status: STATUS[verdict.outcome], flagReasons: verdict.reasons,
                    checkIn: {
                        latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters,
                        distanceMeters: verdict.distanceMeters, ip, attested: attestation.verified, attestationReason: attestation.reason,
                    },
                },
            })
            return {
                result: { outcome: verdict.outcome, reasons: verdict.reasons, place: { id: verdict.place.id, name: verdict.place.name }, distanceMeters: verdict.distanceMeters, at: local, late: null },
                counts: verdict.outcome === "ACCEPTED",
                punchId: punch.id,
            }
        })
        if (!out.result) fail("PHONE_SIGNATURE_INVALID")
        // From the day before: a check-in after midnight can end the night shift that began then.
        if (out.counts) await recomputeAfter(companyId, addDays(local.slice(0, 10), -1), [userId])
        if (out.result.outcome === "REFUSED") return out.result
        return { ...out.result, late: await AttendanceCheckInService.lateness(companyId, userId, out.punchId!, local) }
    }

    /**
     * How late this check-in is, when it is the first of its working day:
     * minutes past the start, if past the policy's grace. The day is the
     * shift it belongs to, as the engine groups punches (assignPunches), so a
     * night shift's arrival after midnight is measured against the night it
     * starts, and the morning's check-out from last night's shift doesn't
     * count as this evening's first (review on #24). Null otherwise — a
     * later check-in, a rest day, no schedule, or lateness not charged at all,
     * when asking for permission would be pointless.
     */
    static async lateness(companyId: string, userId: string, punchId: string, local: string): Promise<{ minutes: number; startsAt: string } | null> {
        const date = local.slice(0, 10)
        const days = [addDays(date, -1), date, addDays(date, 1)]
        const [{ plans, latenessOn }, nearby] = await Promise.all([
            AttendanceEngineService.expectedFor(companyId, userId, days),
            prisma.attendancePunch.findMany({
                where: {
                    userId, voidedAt: null, status: { in: ["ACCEPTED", "FLAGGED", "PENDING_DEVICE"] },
                    punchAtLocal: { gte: new Date(`${days[0]}T00:00:00Z`), lt: new Date(`${addDays(days[2], 1)}T00:00:00Z`) },
                },
                select: { id: true, punchAtLocal: true, direction: true },
            }),
        ])
        const grouped = assignPunches(nearby.map(p => ({ id: p.id, at: p.punchAtLocal.toISOString().slice(0, 19), direction: p.direction })), plans)
        const [day, punches] = [...grouped].find(([, list]) => list.some(p => p.id === punchId)) ?? []
        if (!day || !punches || punches[0].id !== punchId) return null
        const expected = plans.get(day)
        const rule = latenessOn(day)
        if (expected?.kind !== "WORK" || !rule?.enabled) return null
        if (await AttendanceCheckInService.latenessWaived(companyId, userId, day)) return null
        // Minutes from the start of the shift's own day, past midnight included.
        const daysAfter = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000
        const minutes = daysAfter * 1440 + Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16)) - expected.hours.startMinutes
        if (minutes <= rule.graceMinutes) return null
        return { minutes, startsAt: formatMinutes(expected.hours.startMinutes) }
    }

    /**
     * Whether lateness that day costs nothing anyway, as the engine measures
     * it (deriveMonth, measureDay): on approved leave, suspended for the whole
     * day or not employed on it, already excused on the exceptions screen, or
     * with a late-arrival permission already asked for or granted. Offering
     * another would spend allowance on nothing, or be refused as overlapping
     * (review on #24).
     */
    static async latenessWaived(companyId: string, userId: string, day: string): Promise<boolean> {
        return (await this.latenessWaivedFor(companyId, [{ userId, date: day }])).has(`${userId}|${day}`)
    }

    /**
     * latenessWaived for many people and days at once: five queries however
     * many, for the reminder job (review on #25). The keys of the waived ones,
     * as "userId|date".
     */
    static async latenessWaivedFor(companyId: string, pairs: readonly { userId: string; date: string }[]): Promise<Set<string>> {
        const waived = new Set<string>()
        if (pairs.length === 0) return waived
        const userIds = [...new Set(pairs.map(p => p.userId))]
        const days = [...new Set(pairs.map(p => p.date))].sort()
        const asDates = days.map(d => new Date(`${d}T00:00:00Z`))
        const [leave, permissions, excused, people, company] = await Promise.all([
            prisma.dayOffRequest.findMany({
                where: {
                    userId: { in: userIds }, status: "APPROVED", date: { lte: new Date(`${days.at(-1)}T23:59:59Z`) },
                    OR: [{ endDate: { gte: asDates[0] } }, { endDate: null, date: { gte: asDates[0] } }],
                },
                select: { userId: true, date: true, endDate: true },
            }),
            prisma.permissionRequest.findMany({ where: { companyId, userId: { in: userIds }, date: { in: asDates }, type: "LATE_ARRIVAL", status: { in: ["PENDING", "APPROVED"] } }, select: { userId: true, date: true } }),
            prisma.attendanceDayDecision.findMany({ where: { companyId, userId: { in: userIds }, date: { in: asDates }, outcome: "EXCUSED", subject: "LATENESS" }, select: { userId: true, date: true } }),
            prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, EmploymentEvent: { select: { type: true, effectiveFrom: true, deductSuspension: true, createdAt: true } } } }),
            prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } }),
        ])
        const timeZone = company?.timezone ?? DEFAULT_TIME_ZONE
        const asked = new Set([...permissions, ...excused].map(r => `${r.userId}|${toDateString(r.date)}`))
        const spans = new Map(people.map(p => {
            const events = p.EmploymentEvent as Parameters<typeof employmentSpans>[0]
            return [p.id, events.length === 0 ? null : { employed: employmentSpans(events), suspended: suspensionSpans(events) }]
        }))
        for (const { userId, date: day } of pairs) {
            const key = `${userId}|${day}`
            if (asked.has(key)) { waived.add(key); continue }
            if (leave.some(l => l.userId === userId && toDateString(l.date) <= day && day <= toDateString(l.endDate ?? l.date))) { waived.add(key); continue }
            const mine = spans.get(userId)
            if (!mine) continue
            const dayStart = localToInstant(`${day}T00:00:00`, timeZone), nextStart = localToInstant(`${addDays(day, 1)}T00:00:00`, timeZone)
            const touches = (s: { from: Date; to: Date | null }) => s.from < nextStart && (s.to === null || s.to > dayStart)
            const covers = (s: { from: Date; to: Date | null }) => s.from <= dayStart && (s.to === null || s.to >= nextStart)
            if (!mine.employed.some(touches) || mine.suspended.some(covers)) waived.add(key)
        }
        return waived
    }

    private static async refuse(db: Prisma.TransactionClient, companyId: string, userId: string, phoneId: string | null, reason: string, ip: string | null, at: Date, details?: Prisma.InputJsonValue) {
        await db.checkInRefusal.create({ data: { companyId, userId, phoneId, reason, ip, at, ...(details && { details }) } })
    }
}
