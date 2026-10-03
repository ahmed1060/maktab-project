import { en } from "@/lib/translations/en"
import type { TranslationKey } from "@/lib/translations"
import { renderNotice, type NoticeText } from "@/lib/notice"
import type { Prisma } from "@prisma/client"

/**
 * What a notification row stores for a message (lib/notice.ts): the key and
 * details, for the bell to show in the reader's language, and the English
 * text in `message`, for rows read by anything that reads the text itself.
 *
 * A module of its own, not a method of NotificationService, so services that
 * write notifications themselves (inside a transaction, in bulk) use it too,
 * and tests that stand in for NotificationService don't have to.
 */

export function englishNotice(text: NoticeText): string {
    // The server's own date format, as these messages have always used.
    return renderNotice(text, key => (en as Record<TranslationKey, string>)[key] ?? key, iso => new Date(iso).toLocaleDateString())
}

export function noticeRow(text: NoticeText): { message: string; messageKey: string; messageParams: Prisma.InputJsonValue } {
    return { message: englishNotice(text), messageKey: text.key, messageParams: (text.params ?? {}) as Prisma.InputJsonValue }
}
