import type { Prisma } from "@prisma/client"
import type { Actor } from "@/lib/permissions/can"
import type { ClientLanguage } from "@/lib/client-accounts"
import type { TaxUpdateEmailed } from "@/lib/tax-file"
import { hasModule, resolveBundles } from "@/lib/features/bundles"
import { taxUpdateEmail } from "@/lib/tax-update-email"
import { sendOfficeEmail } from "@/lib/email"
import { defaultBrandColour } from "@/lib/page-brand-colour"
import { senderOf } from "@/lib/services/client-account.service"

/**
 * The update email (CLIENT_PORTAL_PLAN.md §4.4, step 11b; PR 351): who an
 * upload of the tax portal's file emails, worked out in the upload's own
 * save, and the emails sent once that save is made, as the invitation's are
 * (lib/services/client-account.service.ts): an email slower than the save's
 * time limit would otherwise tell someone of an upload that was never kept.
 */

type Tx = Prisma.TransactionClient

/** Whom an upload emails, and what they're told; or why it emails none. */
export type TaxEmailPlan =
    | { state: "off" | "nobody" | "today" }
    | { state: "send"; office: string; client: string; asOf: string; people: { name: string; email: string; language: ClientLanguage }[] }

/** A language as it's kept: Arabic or English, which the database holds it to. */
const languageOf = (kept: string): ClientLanguage => (kept === "en" ? "en" : "ar")
const dayOf = (date: Date) => date.toISOString().slice(0, 10)

/**
 * Read inside the upload's save, once the client is held, so two uploads
 * at once read one after the other and email the client once. None where
 * the company's switch is off or its package hasn't the client portal;
 * none where no one of the client's people has set a password, those still
 * invited having their invitation; and none where the client was emailed
 * today already, the company's day. Otherwise each of them who has set a
 * password, in the language their account keeps.
 */
export async function taxEmailPlan(
    tx: Tx,
    client: { id: string; companyId: string; name: string },
    emailedOn: Date | null,
    today: string,
    asOf: string,
): Promise<TaxEmailPlan> {
    const company = await tx.company.findUniqueOrThrow({
        where: { id: client.companyId },
        select: { name: true, taxUpdateEmails: true, package: { select: { hasCompanyManagement: true, hasHR: true, hasClientPortal: true } } },
    })
    if (!company.taxUpdateEmails || !hasModule(resolveBundles(company.package), "TAX_POSITION")) return { state: "off" }
    const people = await tx.clientAccount.findMany({
        where: { clientId: client.id, activatedAt: { not: null } },
        select: { name: true, email: true, language: true },
        orderBy: [{ invitedAt: "asc" }, { id: "asc" }],
    })
    if (!people.length) return { state: "nobody" }
    if (emailedOn && dayOf(emailedOn) >= today) return { state: "today" }
    return {
        state: "send",
        office: company.name,
        client: client.name,
        asOf,
        people: people.map(person => ({ name: person.name, email: person.email, language: languageOf(person.language) })),
    }
}

/** How many are sent at once: a client has up to 20 people, and Gmail takes a few connections at a time. */
const AT_ONCE = 5

/**
 * Sends the update email to each of the people the save found, once it's
 * made: a few at a time, each in their own language, from the office, a
 * reply going to whoever uploaded the file and none where a Super Admin did.
 * One that can't be sent leaves the upload saved, and the day marked: a
 * second audit log entry, after the upload's, says how many couldn't be,
 * as the audit log is only ever added to. Never throws: the upload is saved.
 */
export async function sendTaxUpdateEmails(
    plan: Extract<TaxEmailPlan, { state: "send" }>,
    by: Actor,
    clientId: string,
    origin: string,
): Promise<TaxUpdateEmailed> {
    let sent = 0
    let failed = 0
    try {
        // Read once the save is made: who sent it, and the colour it's drawn in.
        const sender = await senderOf(by)
        const brand = await defaultBrandColour()
        const base = origin.replace(/\/+$/, "")
        for (let from = 0; from < plan.people.length; from += AT_ONCE) {
            const sending = plan.people.slice(from, from + AT_ONCE).map(person => {
                const email = taxUpdateEmail({
                    language: person.language,
                    person,
                    office: plan.office,
                    client: plan.client,
                    asOf: plan.asOf,
                    sender,
                    signIn: `${base}/login`,
                    privacy: `${base}/privacy`,
                    brand,
                })
                return sendOfficeEmail({
                    to: { name: person.name, address: person.email },
                    fromName: email.fromName,
                    replyTo: email.replyTo,
                    subject: email.subject,
                    text: email.text,
                    html: email.html,
                })
            })
            for (const outcome of await Promise.allSettled(sending)) {
                if (outcome.status === "fulfilled") sent += 1
                else failed += 1
            }
        }
    } catch (error) {
        // Nothing sent past here: the rest are counted as not sent.
        console.error("[tax update email] couldn't be sent", error)
        failed = plan.people.length - sent
    }
    if (failed) {
        console.error(`[tax update email] ${failed} of ${plan.people.length} couldn't be sent`)
        try {
            const { AuditLogService } = await import("./audit-log.service")
            const superAdmin = by.role === "SUPER_ADMIN"
            await AuditLogService.log("UPDATE_TAX_POSITION_NOT_EMAILED", "VENDOR", clientId, {
                userId: superAdmin ? null : by.id ?? null,
                superAdminId: superAdmin ? by.id ?? null : null,
                details: { name: plan.client, people: failed },
            })
        } catch (error) {
            console.error("[tax update email] that some couldn't be sent couldn't be logged either", error)
        }
    }
    return { state: "sent", sent, failed }
}
