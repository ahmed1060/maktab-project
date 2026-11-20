import { MESSAGE_KINDS, MESSAGE_LANGUAGES, type CompanyMessage, type MessageKind, type MessageLanguage } from "@/lib/client-message-template"
import type { TranslationKey } from "@/lib/translations"

/**
 * Where a company's client messages on WhatsApp are read, saved and shown
 * (CLIENT_PORTAL_PLAN.md §7.1, step 10c-2; PR 349): the routes, for the
 * company's own people (no company named: the server reads their own) or
 * for the Super Admin (the company named), and the pages, the Client portal
 * tab and each message's editor, on the company's own settings or the
 * Super Admin's.
 */

/** Whether an address names one of the messages. */
export const isMessageKind = (kind: string): kind is MessageKind => (MESSAGE_KINDS as readonly string[]).includes(kind)

/** Each message by the name the client's page gives its button. */
export const MESSAGE_NAME: Record<MessageKind, TranslationKey> = { contact: "portal_contact_accountant", claim: "contact_about_claim" }

const named = (companyId: string | null) => (companyId ? `?companyId=${encodeURIComponent(companyId)}` : "")

export const companyMessagesApi = (companyId: string | null) => `/api/company-messages${named(companyId)}`
export const companyMessageApi = (companyId: string | null, kind: MessageKind, language: MessageLanguage) => `/api/company-messages/${kind}/${language}${named(companyId)}`
/** Use Nizmo's message for every language at once. */
export const nizmoAgainApi = (companyId: string | null, kind: MessageKind) => `/api/company-messages/${kind}${named(companyId)}`

/** A message's editor: on the company's own settings, or the Super Admin's for the company. */
export const companyMessageHref = (companyId: string, superAdmin: boolean, kind: MessageKind) =>
    superAdmin ? `/dashboard/companies/${encodeURIComponent(companyId)}/settings/client-messages/${kind}` : `/dashboard/settings/client-messages/${kind}`
/** The Client portal tab, which the editor goes back to. */
export const clientPortalTabHref = (companyId: string, superAdmin: boolean) =>
    superAdmin ? `/dashboard/companies/${encodeURIComponent(companyId)}/settings?tab=client_portal` : "/dashboard/settings?tab=client_portal"

/** The languages of a message that are the company's own copy, Arabic first. */
export function ownLanguages(messages: readonly CompanyMessage[], kind: MessageKind): MessageLanguage[] {
    return MESSAGE_LANGUAGES.filter(language => messages.some(m => m.kind === kind && m.language === language && m.own))
}

/**
 * What Use Nizmo's message says it started from: each language's time as
 * the tab read it, none where the company never changed it, so a language
 * changed since, the one it didn't put back too, refuses it.
 */
export function putBackSince(messages: readonly CompanyMessage[], kind: MessageKind): Record<MessageLanguage, string | null> {
    const at = (language: MessageLanguage) => messages.find(m => m.kind === kind && m.language === language)?.changedAt ?? null
    return { ar: at("ar"), en: at("en") }
}
