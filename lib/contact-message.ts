/**
 * The message Contact the accountant opens with (CLIENT_PORTAL_PLAN.md §7,
 * §12 step 9c; PR 344): Nizmo's own until the messages' templates (step 10),
 * in the page's language, from the client account's name and the client's,
 * with the day the figures are from where there are any. The person can
 * change it before it's sent, here or in WhatsApp.
 */

import type { TranslationKey } from '@/lib/translations'

type Words = (key: TranslationKey) => string

/** The day the figures are from, written out as a person would: "16 November 2026", "١٦ نوفمبر ٢٠٢٦". */
function longDay(day: string, locale: string): string {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function contactMessage(t: Words, locale: string, { person, client, asOf }: { person: string; client: string; asOf: string | null }): string {
    return [
        t('contact_message_greeting'),
        t('contact_message_from').replace('{person}', person).replace('{client}', client),
        asOf ? t('contact_message_position').replace('{date}', longDay(asOf, locale)) : t('contact_message_position_undated'),
    ].join('\n')
}

/**
 * The conversation's own address on WhatsApp, with the message ready to
 * send: the app on a phone, WhatsApp Web on a computer. The number is kept
 * with its country code (lib/whatsapp-number.ts); wa.me takes its digits.
 */
export function whatsAppLink(number: string, message: string): string {
    return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
}
