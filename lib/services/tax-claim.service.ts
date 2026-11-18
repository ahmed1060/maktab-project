import { prisma } from "@/lib/prisma"
import { can, type Actor } from "@/lib/permissions/can"
import { filterTimeZone } from "@/lib/services/filter-zone"
import { calendarDateStr } from "@/lib/time"
import { cents } from "@/lib/task-costs"
import type { Paging } from "@/lib/pagination"
import { daysLate, type TaxPosition } from "@/lib/tax-claims"
import { compareClaims, fileNamesClient, namedCompany, sentUpload, type ClaimDraft, type TaxClaimsNow, type TaxUploadSaved } from "@/lib/tax-file"

/** A date column's day, as it was written. */
const dayOf = (date: Date) => date.toISOString().slice(0, 10)
/** A day as a date column keeps it. */
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`)

/** What's kept of a claim (CLIENT_PORTAL_PLAN.md §3.1). */
const KEPT = {
    claimNumber: true, item: true, taxType: true, registrationType: true, originalAmount: true, paidAmount: true, remainingAmount: true,
    currency: true, status: true, periodStart: true, periodEnd: true, dueDate: true,
} as const
type KeptRow = {
    claimNumber: string; item: string; taxType: string | null; registrationType: string | null
    originalAmount: unknown; paidAmount: unknown; remainingAmount: unknown
    currency: string | null; status: string | null; periodStart: Date | null; periodEnd: Date | null; dueDate: Date
}

/** A claim's row as a file would give the claim: its amounts numbers, its days days. */
const draftOf = (row: KeptRow): ClaimDraft => ({
    claimNumber: row.claimNumber,
    item: row.item,
    taxType: row.taxType,
    registrationType: row.registrationType,
    originalAmount: Number(row.originalAmount),
    paidAmount: Number(row.paidAmount),
    remainingAmount: Number(row.remainingAmount),
    currency: row.currency,
    status: row.status,
    periodStart: row.periodStart && dayOf(row.periodStart),
    periodEnd: row.periodEnd && dayOf(row.periodEnd),
    dueDate: dayOf(row.dueDate),
})

/**
 * A client's tax position, for the company's people (CLIENT_PORTAL_PLAN.md
 * §3.5): the day its figures are from and who uploaded the portal's file,
 * what all its open claims come to, and a page of them, the longest overdue
 * first.
 *
 * Late is counted here, in the days of the client's own company (§3.4), so
 * every screen agrees, wherever its reader is. Read from the client's own
 * company, so a Super Admin gets any client's; another company's reads as
 * not there, whatever the address says.
 */
export async function taxPositionOf(user: Actor, clientId: string | null | undefined, paging: Paging, now: Date = new Date()): Promise<TaxPosition> {
    if (!clientId) throw new Error("TAX_CLIENT_REQUIRED")
    if (!can(user, "tax.view")) throw new Error("TAX_VIEW_REQUIRED")
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, companyId: true, archivedAt: true } })
    if (!client || (user.role !== "SUPER_ADMIN" && client.companyId !== user.companyId)) throw new Error("CLIENT_NOT_FOUND")

    const timeZone = await filterTimeZone(client.companyId)
    const today = calendarDateStr(now, timeZone)
    const its = { clientId: client.id }
    // Its last day to pay has passed. Every claim kept has something left to pay (§3.2).
    const late = { ...its, dueDate: { lt: new Date(`${today}T00:00:00Z`) } }

    const [position, rows, sums, lateCount] = await Promise.all([
        prisma.clientTaxPosition.findUnique({ where: { clientId: client.id }, select: { asOf: true, uploadedAt: true, uploadedByName: true } }),
        prisma.taxClaim.findMany({
            where: its,
            select: { id: true, ...KEPT },
            orderBy: [{ dueDate: "asc" }, { claimNumber: "asc" }, { id: "asc" }],
            skip: paging.skip,
            take: paging.limit,
        }),
        prisma.taxClaim.aggregate({ where: its, _sum: { originalAmount: true, paidAmount: true, remainingAmount: true }, _count: true }),
        prisma.taxClaim.count({ where: late }),
    ])
    const total = sums._count
    const sum = (amount: unknown) => cents(Number(amount ?? 0))

    return {
        client: { id: client.id, name: client.name, archived: !!client.archivedAt },
        today,
        position: position && { asOf: dayOf(position.asOf), uploadedOn: calendarDateStr(position.uploadedAt, timeZone), uploadedBy: position.uploadedByName },
        totals: { original: sum(sums._sum.originalAmount), paid: sum(sums._sum.paidAmount), remaining: sum(sums._sum.remainingAmount), open: total, late: lateCount },
        claims: rows.map(row => {
            const claim = draftOf(row)
            return { id: row.id, ...claim, daysLate: daysLate(claim.dueDate, today) }
        }),
        total,
        totalPages: Math.ceil(total / paging.limit),
    }
}

/** Who's asking, with the name an upload keeps. */
type Uploader = Actor & { name?: string | null }

/** An id as Nizmo makes them. Anything else is nobody's, and isn't asked of the database. */
const ID = /^[\w-]{1,64}$/

/**
 * The client a file is uploaded for (§4.1): by whoever may upload, in the
 * client's own company, so another company's reads as not there whatever
 * the address says; and one in use, as an archived client's figures stay as
 * they were. The Super Admin uploads for any company's.
 */
async function clientToUpload(user: Actor, clientId: string | null | undefined) {
    if (!clientId) throw new Error("TAX_CLIENT_REQUIRED")
    if (!can(user, "tax.manage")) throw new Error("TAX_MANAGE_REQUIRED")
    const client = ID.test(clientId) ? await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, companyId: true, archivedAt: true } }) : null
    if (!client || (user.role !== "SUPER_ADMIN" && client.companyId !== user.companyId)) throw new Error("CLIENT_NOT_FOUND")
    if (client.archivedAt) throw new Error("CLIENT_ARCHIVED")
    return client
}

/**
 * What a file is checked against before it's saved (§4.1): every claim the
 * client has now, as a file would give them, the company its last file
 * named, today where the company is, and how many files have been uploaded
 * for it, which the save sends back.
 */
export async function taxClaimsNow(user: Actor, clientId: string | null | undefined, now: Date = new Date()): Promise<TaxClaimsNow> {
    const client = await clientToUpload(user, clientId)
    const today = calendarDateStr(now, await filterTimeZone(client.companyId))
    // The count first: the claims read after it are that file's or a later
    // one's, and a later one's has the save refused, never let through.
    const position = await prisma.clientTaxPosition.findUnique({ where: { clientId: client.id }, select: { uploads: true, fileCompany: true } })
    const rows = await prisma.taxClaim.findMany({ where: { clientId: client.id }, select: KEPT, orderBy: [{ dueDate: "asc" }, { claimNumber: "asc" }, { id: "asc" }] })
    return { client: { id: client.id, name: client.name }, today, uploads: position?.uploads ?? 0, fileCompany: position?.fileCompany ?? null, claims: rows.map(draftOf) }
}

/** How many claims are written at a time. */
const WRITTEN_AT_ONCE = 500

/**
 * Saves the claims read from the portal's file as the client's (§4.1): each
 * upload replaces the last, in one go, so the client's page never shows part
 * of one file and part of another.
 *
 * Nothing sent is trusted. Every claim is checked again by the rules the
 * check screen used (lib/tax-file.ts), and one thing wrong refuses the whole
 * save, as saving the rest would delete that claim. The save is refused too
 * where another file was saved since its check screen read the claims, and,
 * until it's sent as confirmed, where the file's company isn't the client's.
 */
export async function saveTaxFile(user: Uploader, body: unknown, now: Date = new Date()): Promise<TaxUploadSaved> {
    if (!can(user, "tax.manage")) throw new Error("TAX_MANAGE_REQUIRED")
    const sent = sentUpload(body)
    if ("problem" in sent) throw new Error(sent.problem === "too_many" ? "TAX_TOO_MANY_CLAIMS" : "TAX_UPLOAD_INVALID")
    const { upload } = sent
    const client = await clientToUpload(user, upload.clientId)
    if (upload.asOf > calendarDateStr(now, await filterTimeZone(client.companyId))) throw new Error("TAX_DAY_AFTER_TODAY")

    const superAdmin = user.role === "SUPER_ADMIN"
    const { AuditLogService } = await import("./audit-log.service")
    return prisma.$transaction(async tx => {
        // The client's row is held first, as archiving and deleting it hold
        // it: two saves go one after the other, and a client archived
        // meanwhile is refused. One query after another from here: a
        // transaction has one connection.
        const held = await tx.$queryRaw<{ name: string; archivedAt: Date | null }[]>`SELECT name, "archivedAt" FROM "Client" WHERE id = ${client.id} FOR UPDATE`
        if (!held.length) throw new Error("CLIENT_NOT_FOUND")
        if (held[0].archivedAt) throw new Error("CLIENT_ARCHIVED")

        const position = await tx.clientTaxPosition.findUnique({ where: { clientId: client.id }, select: { uploads: true, fileCompany: true } })
        // Still as the check screen read them: no file saved since.
        if ((position?.uploads ?? 0) !== upload.uploads) throw new Error("TAX_CLAIMS_CHANGED")
        // One client's file isn't saved for another without being asked.
        if (!upload.confirmed && !fileNamesClient(upload.fileCompany, held[0].name, position?.fileCompany ?? null)) throw new Error("TAX_FILE_OTHER_COMPANY")

        const rows = await tx.taxClaim.findMany({ where: { clientId: client.id }, select: { id: true, ...KEPT } })
        const idOf = new Map(rows.map(row => [row.claimNumber, row.id] as const))
        const { added, changed, gone } = compareClaims(rows.map(draftOf), upload.claims)
        // What the file hasn't goes, and what changed is written again. A
        // claim that didn't change keeps its row.
        const going = [...gone, ...changed.map(change => change.before)].map(claim => idOf.get(claim.claimNumber)!)
        if (going.length) await tx.taxClaim.deleteMany({ where: { id: { in: going } } })
        const coming = [...added, ...changed.map(change => change.after)]
        for (let from = 0; from < coming.length; from += WRITTEN_AT_ONCE) {
            await tx.taxClaim.createMany({
                data: coming.slice(from, from + WRITTEN_AT_ONCE).map(claim => ({
                    companyId: client.companyId,
                    clientId: client.id,
                    claimNumber: claim.claimNumber,
                    item: claim.item,
                    taxType: claim.taxType,
                    registrationType: claim.registrationType,
                    // To the piastre, as they were checked.
                    originalAmount: claim.originalAmount.toFixed(2),
                    paidAmount: claim.paidAmount.toFixed(2),
                    remainingAmount: claim.remainingAmount.toFixed(2),
                    currency: claim.currency,
                    status: claim.status,
                    periodStart: claim.periodStart ? dateOf(claim.periodStart) : null,
                    periodEnd: claim.periodEnd ? dateOf(claim.periodEnd) : null,
                    dueDate: dateOf(claim.dueDate),
                })),
            })
        }

        const kept = {
            asOf: dateOf(upload.asOf),
            // A Super Admin isn't one of the company's people: their name is kept, as anyone's is.
            uploadedById: superAdmin ? null : user.id ?? null,
            uploadedByName: user.name ?? null,
            uploadedAt: now,
            // The name the last file that named a company gave: one that names none leaves it.
            fileCompany: namedCompany(upload.fileCompany) ?? position?.fileCompany ?? null,
        }
        const saved = await tx.clientTaxPosition.upsert({
            where: { clientId: client.id },
            create: { clientId: client.id, companyId: client.companyId, ...kept },
            update: { ...kept, uploads: { increment: 1 } },
            select: { uploads: true },
        })

        await AuditLogService.log("UPDATE_TAX_POSITION", "VENDOR", client.id, {
            tx,
            userId: superAdmin ? null : user.id,
            superAdminId: superAdmin ? user.id : null,
            details: { name: held[0].name, fileName: upload.fileName, asOf: upload.asOf, added: added.length, changed: changed.length, removed: gone.length, claims: upload.claims.length },
        })
        return { added: added.length, changed: changed.length, gone: gone.length, claims: upload.claims.length, uploads: saved.uploads }
    }, { maxWait: 10_000, timeout: 30_000 })
}
