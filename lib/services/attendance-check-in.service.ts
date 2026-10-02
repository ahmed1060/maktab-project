import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { AttendanceChallengeService } from "./attendance-challenge.service"
import { AttendanceLocationService } from "./attendance-location.service"
import { recomputeAfter } from "./attendance-recompute"
import { lockMonths, lockedMonths, punchMonths } from "./attendance-lock"
import { parsePhoneKey, signatureValid, signedText } from "@/lib/attendance/phone-keys"
import { attestationMode, verifyAttestation } from "@/lib/attendance/attestation"
import { judgeCheckIn, type FlagReason } from "@/lib/attendance/check-in-rules"
import { addDays } from "@/lib/attendance/calendar"
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
    | { outcome: "ACCEPTED" | "FLAGGED" | "HELD"; reasons: FlagReason[]; place: { id: string; name: string }; distanceMeters: number; at: string }

function fail(code: string): never {
    throw new Error(code)
}

/**
 * The exact text a phone signs for a check-in: the number, which key, the fix
 * and whether it was simulated, the direction if the person chose one.
 * Numbers as JavaScript writes them (String(n)); the app must write the same.
 */
export function checkInText(input: Pick<CheckInInput, "nonce" | "keyFingerprint" | "latitude" | "longitude" | "accuracyMeters" | "mocked" | "direction">) {
    return signedText("CHECK_IN", input.nonce, [input.keyFingerprint, input.latitude, input.longitude, input.accuracyMeters, input.mocked ? 1 : 0, input.direction ?? ""])
}

const STATUS = { ACCEPTED: "ACCEPTED", FLAGGED: "FLAGGED", HELD: "PENDING_DEVICE" } as const

export class AttendanceCheckInService {
    static async checkIn(companyId: string, userId: string, input: CheckInInput, ip: string | null, now = new Date()): Promise<CheckInResult> {
        const phone = await prisma.checkInPhone.findFirst({
            where: { userId, keyFingerprint: input.keyFingerprint },
            select: { id: true, status: true, publicKey: true, platform: true },
        })
        // A key we don't know can't be checked: there is nothing to check it with.
        const key = phone ? parsePhoneKey(phone.publicKey) : null
        const badSignature = !!phone && !(key && signatureValid(key.key, checkInText(input), input.signature))
        const attestation = await verifyAttestation({ platform: phone?.platform ?? "ANDROID", token: input.attestation, challenge: input.nonce })
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
            const waiting = await tx.checkInPhone.count({ where: { userId, status: "PENDING" } })
            const places = await AttendanceLocationService.forPerson(companyId, userId)
            const verdict = judgeCheckIn({
                phone: phone ? { status: phone.status } : null,
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

            await tx.attendancePunch.create({
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
                        distanceMeters: verdict.distanceMeters, ip, attested: attestation.verified,
                    },
                },
            })
            return {
                result: { outcome: verdict.outcome, reasons: verdict.reasons, place: { id: verdict.place.id, name: verdict.place.name }, distanceMeters: verdict.distanceMeters, at: local },
                counts: verdict.outcome === "ACCEPTED",
            }
        })
        if (!out.result) fail("PHONE_SIGNATURE_INVALID")
        // From the day before: a check-in after midnight can end the night shift that began then.
        if (out.counts) await recomputeAfter(companyId, addDays(local.slice(0, 10), -1), [userId])
        return out.result
    }

    private static async refuse(db: Prisma.TransactionClient, companyId: string, userId: string, phoneId: string | null, reason: string, ip: string | null, at: Date, details?: Prisma.InputJsonValue) {
        await db.checkInRefusal.create({ data: { companyId, userId, phoneId, reason, ip, at, ...(details && { details }) } })
    }
}
