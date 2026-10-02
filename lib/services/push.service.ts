import { prisma } from "@/lib/prisma"
import { renderNotice, type NoticeParam } from "@/lib/notice"
import type { TranslationKey } from "@/lib/translations"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"
import { fcmAccount, sendFcm, type PushMessage, type PushOutcome } from "@/lib/push/fcm"
import { apnsAccount, sendApns } from "@/lib/push/apns"

/**
 * Notices pushed to the check-in app (ATTENDANCE_PLAN.md §13.4): what is
 * about the person's own attendance, sent to their phone as well as the bell.
 *
 * An outbox, not a send at the moment of writing: notices are written inside
 * transactions that may yet roll back, and a push can't be taken back. So a
 * notice is written as usual, and flush() later sends what is new and not
 * yet pushed — the reminder job calls it every few minutes. A notice older
 * than half an hour isn't pushed at all: a late push about a check-in is
 * noise.
 */

/** The notice types pushed: each is addressed to the person about their own attendance. */
export const PUSHED_TYPES = ["ATTENDANCE_CHECK_IN", "ATTENDANCE_DAY", "ATTENDANCE_PHONE", "ATTENDANCE_REQUEST", "ATTENDANCE_REMINDER"] as const

/**
 * Notices of those types that are about someone else: "a new phone is waiting
 * for your approval" goes to whoever decides phones, and is no news about
 * their own attendance (review on #25).
 */
export const NOT_PUSHED_KEYS = ["notice_att_phone_requested"] as const

const FRESH_FOR_MS = 30 * 60_000
const BATCH = 200
const LIVE = { status: { in: ["ACTIVE", "PENDING"] as ("ACTIVE" | "PENDING")[] } }
const PHONES = { ...LIVE, pushToken: { not: null } }

/**
 * The phone a person's pushes go to: the one waiting for approval when there
 * is one — from the moment it was asked for, the old one can't check in and
 * may be lost (§9.3) — else the one in use. Neither, if that phone has no
 * token yet (review on #25).
 */
export function pushTarget<P extends { status: string; pushToken: string | null }>(phones: readonly P[]): P | null {
    const phone = phones.find(p => p.status === "PENDING") ?? phones.find(p => p.status === "ACTIVE") ?? null
    return phone?.pushToken ? phone : null
}

export type Sender = (platform: "ANDROID" | "IOS", token: string, message: PushMessage) => Promise<PushOutcome | "NOT_CONFIGURED">

/** The senders the server is set up for (FCM_SERVICE_ACCOUNT, APNS_*); a platform without one is skipped. */
export function configuredSender(env: Record<string, string | undefined> = process.env): Sender | null {
    const fcm = fcmAccount(env), apns = apnsAccount(env)
    if (!fcm && !apns) return null
    return async (platform, token, message) => {
        if (platform === "ANDROID") return fcm ? sendFcm(fcm, token, message) : "NOT_CONFIGURED"
        return apns ? sendApns(apns, token, message) : "NOT_CONFIGURED"
    }
}

const DICTS = { en, ar } as Record<string, Record<TranslationKey, string>>

/** The notice as its reader reads it in the bell, in their language. */
function textOf(n: { message: string; messageKey: string | null; messageParams: unknown }, language: string): string {
    if (!n.messageKey) return n.message
    const dict = DICTS[language] ?? en
    const locale = language === "ar" ? "ar-EG" : "en-GB"
    return renderNotice(
        { key: n.messageKey as TranslationKey, params: (n.messageParams ?? {}) as Record<string, NoticeParam> },
        key => dict[key] ?? (en as Record<TranslationKey, string>)[key] ?? key,
        iso => new Date(iso).toLocaleDateString(locale, { timeZone: "UTC" }),
    )
}

export class PushService {
    /**
     * Sends the new notices not yet pushed to the phones they belong on.
     * Each is claimed before it is sent, so two runs at once never send one
     * twice. A token the push service no longer knows is forgotten; a send
     * that failed for another reason is released, to try again next run
     * while the notice is still fresh.
     */
    static async flush(now = new Date(), sender: Sender | null = configuredSender()) {
        if (!sender) return { sent: 0, skipped: "NOT_CONFIGURED" as const }
        const due = await prisma.notification.findMany({
            where: {
                pushedAt: null, createdAt: { gte: new Date(now.getTime() - FRESH_FOR_MS) }, type: { in: [...PUSHED_TYPES] },
                OR: [{ messageKey: null }, { messageKey: { notIn: [...NOT_PUSHED_KEYS] } }],
                user: { checkInPhones: { some: PHONES } },
            },
            select: {
                id: true, message: true, messageKey: true, messageParams: true, relatedId: true,
                user: { select: { language: true, checkInPhones: { where: LIVE, select: { id: true, status: true, platform: true, pushToken: true } } } },
            },
            orderBy: { createdAt: "asc" },
            take: BATCH,
        })
        let sent = 0, forgotten = 0, failed = 0
        for (const n of due) {
            const { count } = await prisma.notification.updateMany({ where: { id: n.id, pushedAt: null }, data: { pushedAt: now } })
            if (count === 0) continue
            const language = n.user?.language ?? "en"
            const message: PushMessage = { title: (DICTS[language] ?? en).app_name, body: textOf(n, language), link: n.relatedId?.startsWith("/") ? n.relatedId : null }
            let delivered = false, retry = false
            const target = pushTarget(n.user?.checkInPhones ?? [])
            for (const phone of target ? [target] : []) {
                const outcome = await sender(phone.platform, phone.pushToken!, message)
                if (outcome === "SENT") delivered = true
                else if (outcome === "INVALID_TOKEN") {
                    await prisma.checkInPhone.updateMany({ where: { id: phone.id, pushToken: phone.pushToken }, data: { pushToken: null, pushTokenAt: null } })
                    forgotten++
                } else if (outcome === "FAILED") retry = true
            }
            if (delivered) sent++
            else if (retry) {
                failed++
                await prisma.notification.updateMany({ where: { id: n.id, pushedAt: now }, data: { pushedAt: null } })
            }
        }
        return { sent, forgotten, failed }
    }
}
