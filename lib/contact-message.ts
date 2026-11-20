/**
 * The messages Contact on WhatsApp opens with (CLIENT_PORTAL_PLAN.md §7,
 * §12 steps 9c and 9d; PRs 344 and 345): Nizmo's own until the messages'
 * templates (step 10), in the page's language, from the client account's
 * name and the client's. Contact the accountant's names the day the figures
 * are from where there are any; Ask about this claim's names the claim. The
 * person can change either before it's sent, here or in WhatsApp.
 */

import type { TaxClaimRow } from '@/lib/tax-claims'
import type { TranslationKey } from '@/lib/translations'

export type Words = (key: TranslationKey) => string

/** A claim asked about, with its item as the page names it (lib/portal-tax.ts). */
export type ClaimAsked = {
    claim: Pick<TaxClaimRow, 'claimNumber' | 'remainingAmount' | 'originalAmount' | 'dueDate'>
    item: string
}

const intlOf = (locale: string) => locale === 'ar' ? 'ar-EG' : 'en-GB'

/** A day written out as a person would: "16 November 2026", "١٦ نوفمبر ٢٠٢٦". */
function longDay(day: string, locale: string): string {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString(intlOf(locale), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** An amount with its two decimals, in the page's digits: "13,723.26", "١٣٬٧٢٣٫٢٦". */
function amount(n: number, locale: string): string {
    return n.toLocaleString(intlOf(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function greetingFrom(t: Words, person: string, client: string): string[] {
    return [t('contact_message_greeting'), t('contact_message_from').replace('{person}', person).replace('{client}', client)]
}

export function contactMessage(t: Words, locale: string, { person, client, asOf }: { person: string; client: string; asOf: string | null }): string {
    return [
        ...greetingFrom(t, person, client),
        asOf ? t('contact_message_position').replace('{date}', longDay(asOf, locale)) : t('contact_message_position_undated'),
    ].join('\n')
}

/**
 * Ask about this claim's: its number as it's typed into the portal (Latin
 * digits), its item, what remains of what was owed and its last day to pay.
 */
export function claimMessage(t: Words, locale: string, { person, client, item, claim }: { person: string; client: string } & ClaimAsked): string {
    return [
        ...greetingFrom(t, person, client),
        t('contact_message_claim').replace('{number}', claim.claimNumber),
        t('contact_message_item').replace('{item}', item),
        t('contact_message_remaining').replace('{remaining}', amount(claim.remainingAmount, locale)).replace('{original}', amount(claim.originalAmount, locale)),
        t('contact_message_due').replace('{date}', longDay(claim.dueDate, locale)),
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
