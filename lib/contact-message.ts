/**
 * The messages Contact on WhatsApp opens with (CLIENT_PORTAL_PLAN.md §7,
 * §7.1, §12 steps 9c, 9d and 10a; PRs 344, 345 and 346): the company's
 * template for it, else Nizmo's (lib/client-message-template.ts), in the
 * page's language, filled from the client account's name and the client's,
 * the day the figures are from where there are any, and for Ask about this
 * claim the claim's. The person can change either before it's sent, here or
 * in WhatsApp.
 */

import { fillMessage } from '@/lib/client-message-template'
import type { TaxClaimRow } from '@/lib/tax-claims'
import type { TranslationKey } from '@/lib/translations'

export type Words = (key: TranslationKey) => string

/** A claim asked about, with its item as the page names it (lib/portal-tax.ts). */
export type ClaimAsked = {
    claim: Pick<TaxClaimRow, 'claimNumber' | 'remainingAmount' | 'originalAmount' | 'dueDate'>
    item: string
}

/** What both messages are filled from: who it's from, and the figures' day where there are any. */
export type PageAsking = { person: string; client: string; asOf: string | null }

const intlOf = (locale: string) => locale === 'ar' ? 'ar-EG' : 'en-GB'
const languageOf = (locale: string) => locale === 'ar' ? 'ar' : 'en'

/** A day written out as a person would: "16 November 2026", "١٦ نوفمبر ٢٠٢٦". */
function longDay(day: string, locale: string): string {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString(intlOf(locale), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** An amount with its two decimals, in the page's digits: "13,723.26", "١٣٬٧٢٣٫٢٦". */
function amount(n: number, locale: string): string {
    return n.toLocaleString(intlOf(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const pageValues = ({ person, client, asOf }: PageAsking, locale: string) => ({ person, client, asOf: asOf && longDay(asOf, locale) })

export function contactMessage(locale: string, text: string, page: PageAsking): string {
    return fillMessage('contact', languageOf(locale), text, pageValues(page, locale))
}

/**
 * Ask about this claim's: its number as it's typed into the portal (Latin
 * digits), its item, what remains of what was owed and its last day to pay,
 * the amounts and day in the page's digits.
 */
export function claimMessage(locale: string, text: string, { item, claim, ...page }: PageAsking & ClaimAsked): string {
    return fillMessage('claim', languageOf(locale), text, {
        ...pageValues(page, locale),
        number: claim.claimNumber,
        item,
        remaining: amount(claim.remainingAmount, locale),
        original: amount(claim.originalAmount, locale),
        due: longDay(claim.dueDate, locale),
    })
}

/**
 * The conversation's own address on WhatsApp, with the message ready to
 * send: the app on a phone, WhatsApp Web on a computer. The number is kept
 * with its country code (lib/whatsapp-number.ts); wa.me takes its digits.
 */
export function whatsAppLink(number: string, message: string): string {
    return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
}
