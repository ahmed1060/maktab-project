import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { noticeRow } from "@/lib/notice-row"
import { supabase } from "@/lib/storage"
import { calendarDateStr } from "@/lib/time"
import { can } from "@/lib/permissions/can"
import type { Permission } from "@/lib/permissions/catalogue"
import { addDays, daysBetween, expiryDay, expiryRange, expiryState, parseExpiryDay, type ExpiryState } from "@/lib/record-expiry"
import { ownFilePath, parseRecordFiles, storeRecordFiles, type RecordFile } from "@/lib/record-files"
import type { CreateRecordInput, CreateSectionInput, RenameSectionInput, UpdateRecordInput } from "@/lib/validations/record.schema"

/**
 * A client's records (CLIENTS_PLAN.md §0.2): sections of records, each with
 * text, files, and an optional expiry date with a reminder before it.
 *
 * A client is a Vendor until PR 0b renames it. Records are the company's,
 * not any one person's, so every check is company-wide: see them with
 * records.view; add a section or a record, and edit any record, with
 * records.contribute; rename a section with records.edit; delete with
 * records.delete, which the route confirms with a code first.
 *
 * Another company's record is "not found", never "not allowed", so its
 * existence isn't confirmed to anyone outside it.
 */

type Session = { user: { id: string; role: string; companyId?: string | null; [key: string]: unknown } }

/** The page's "today", where the company is: what a record's expiry is measured against. */
export const recordsToday = () => calendarDateStr(new Date())

const PERSON = { select: { firstName: true, lastName: true } } as const

const ROW = (withCompany: boolean) => ({
    id: true, content: true, attachment: true, expiryDate: true, reminderDays: true,
    createdAt: true, lastEditedAt: true,
    createdBy: PERSON, lastEditedBy: PERSON,
    section: {
        select: {
            id: true, title: true,
            vendor: { select: { id: true, name: true, ...(withCompany ? { company: { select: { name: true } } } : {}) } },
        },
    },
}) satisfies Prisma.ClientRecordSelect

type Row = Prisma.ClientRecordGetPayload<{ select: ReturnType<typeof ROW> }>

export type RecordRow = {
    id: string
    content: string
    files: RecordFile[]
    expiryDate: string | null
    expiry: ExpiryState | null
    reminderDays: number | null
    createdAt: Date
    lastEditedAt: Date | null
    createdBy: { firstName: string; lastName: string } | null
    lastEditedBy: { firstName: string; lastName: string } | null
    section: { id: string; title: string }
    client: { id: string; name: string; company?: string }
}

function shape(r: Row, today: string): RecordRow {
    const vendor = r.section.vendor!
    return {
        id: r.id,
        content: r.content,
        files: parseRecordFiles(r.attachment),
        expiryDate: r.expiryDate ? expiryDay(r.expiryDate) : null,
        expiry: expiryState(r.expiryDate, today),
        reminderDays: r.reminderDays,
        createdAt: r.createdAt,
        lastEditedAt: r.lastEditedAt,
        createdBy: r.createdBy,
        lastEditedBy: r.lastEditedBy,
        section: { id: r.section.id, title: r.section.title },
        client: { id: vendor.id, name: vendor.name, ...("company" in vendor && vendor.company ? { company: (vendor.company as { name: string }).name } : {}) },
    }
}

const isSuperAdmin = (session: Session) => session.user.role === "SUPER_ADMIN"

/** Who wrote it, for the row's own columns and for the audit log. */
function actor(session: Session) {
    const sa = isSuperAdmin(session)
    return {
        // The columns' foreign keys point at User; a Super Admin isn't one.
        byUser: sa ? null : session.user.id,
        audit: { userId: sa ? null : session.user.id, superAdminId: sa ? session.user.id : null },
    }
}

/**
 * The company a record, section or client belongs to, checked against the
 * person: another company's is not found, and one in their own company
 * without the permission is refused.
 */
function allow(session: Session, permission: Permission, companyId: string, notFound: string) {
    if (!isSuperAdmin(session) && session.user.companyId !== companyId) throw new Error(notFound)
    if (!can(session.user as any, permission, { companyId })) throw new Error("RECORD_FORBIDDEN")
}

/** Each file must be one uploaded here for this company (lib/record-files.ts). */
function checkFiles(files: readonly RecordFile[], companyId: string) {
    for (const f of files) if (!ownFilePath(f.url, companyId)) throw new Error("RECORD_FILE_INVALID")
}

/** Removes files from storage once nothing refers to them. Best effort: the orphan sweep catches a miss. */
async function removeFiles(files: readonly RecordFile[], companyId: string) {
    const paths = files.map(f => ownFilePath(f.url, companyId)).filter((p): p is string => !!p)
    if (!paths.length || !supabase) return
    try {
        await supabase.storage.from("app-assets").remove(paths)
    } catch (error) {
        console.error("Failed to delete record files from storage:", error)
    }
}

const snippet = (text: string) => text.length > 50 ? `${text.slice(0, 50)}...` : text

/** A section, with the client and company it belongs to. A section of the old Clients section has no client and isn't found. */
async function sectionWithCompany(id: string) {
    const section = await prisma.recordSection.findUnique({
        where: { id },
        select: { id: true, title: true, vendorId: true, vendor: { select: { companyId: true } } },
    })
    if (!section || !section.vendorId || !section.vendor) throw new Error("RECORD_SECTION_NOT_FOUND")
    return { ...section, vendorId: section.vendorId, companyId: section.vendor.companyId }
}

async function recordWithCompany(id: string) {
    const record = await prisma.clientRecord.findUnique({
        where: { id },
        select: {
            id: true, content: true, attachment: true, expiryDate: true, reminderDays: true, sectionId: true,
            section: { select: { vendorId: true, vendor: { select: { companyId: true } } } },
        },
    })
    if (!record || !record.section.vendorId || !record.section.vendor) throw new Error("RECORD_NOT_FOUND")
    return { ...record, vendorId: record.section.vendorId, companyId: record.section.vendor.companyId }
}

const taken = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"

export type RecordListQuery = {
    /** A Super Admin's chosen company; ignored for anyone else, who sees their own. Unset for a Super Admin is every company. */
    companyId?: string | null
    vendorId?: string | null
    sectionId?: string | null
    search?: string | null
    expiry?: ExpiryState | null
    page: number
    limit: number
}

export class RecordService {
    /**
     * Records across the company's clients, or one client's: newest first, or
     * soonest to expire when filtered by expiry. The search finds a record by
     * its text, its section's name or its client's name.
     */
    static async list(session: Session, query: RecordListQuery) {
        const sa = isSuperAdmin(session)
        const companyId = sa ? query.companyId || null : session.user.companyId
        if (!sa && !companyId) return { data: [] as RecordRow[], total: 0, today: recordsToday() }
        if (!sa && !can(session.user as any, "records.view", { companyId: companyId! })) throw new Error("RECORD_FORBIDDEN")

        const today = recordsToday()
        const search = query.search?.trim()
        const where: Prisma.ClientRecordWhereInput = {
            section: {
                vendorId: query.vendorId ? query.vendorId : { not: null },
                ...(query.sectionId ? { id: query.sectionId } : {}),
                ...(companyId ? { vendor: { companyId } } : {}),
            },
            ...(query.expiry ? { expiryDate: expiryRange(query.expiry, today) } : {}),
            ...(search ? {
                OR: [
                    { content: { contains: search, mode: "insensitive" } },
                    { section: { title: { contains: search, mode: "insensitive" } } },
                    { section: { vendor: { name: { contains: search, mode: "insensitive" } } } },
                ],
            } : {}),
        }
        const [rows, total] = await Promise.all([
            prisma.clientRecord.findMany({
                where,
                select: ROW(sa && !companyId),
                // The id last, so a page never shows a row the next one does too.
                orderBy: query.expiry ? [{ expiryDate: "asc" }, { createdAt: "desc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "asc" }],
                skip: (query.page - 1) * query.limit,
                take: query.limit,
            }),
            prisma.clientRecord.count({ where }),
        ])
        return { data: rows.map(r => shape(r, today)), total, today }
    }

    /** One record, for the link in its reminder. */
    static async get(session: Session, id: string) {
        const found = await recordWithCompany(id)
        allow(session, "records.view", found.companyId, "RECORD_NOT_FOUND")
        const row = await prisma.clientRecord.findUniqueOrThrow({ where: { id }, select: ROW(false) })
        return shape(row, recordsToday())
    }

    /** A client's sections, with how many records each holds, and the client's name for the page. */
    static async sectionsOf(session: Session, vendorId: string) {
        const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true, companyId: true } })
        if (!vendor) throw new Error("VENDOR_NOT_FOUND")
        allow(session, "records.view", vendor.companyId, "VENDOR_NOT_FOUND")
        const sections = await prisma.recordSection.findMany({
            where: { vendorId },
            select: { id: true, title: true, _count: { select: { records: true } } },
            orderBy: { title: "asc" },
        })
        return {
            client: { id: vendor.id, name: vendor.name },
            sections: sections.map(s => ({ id: s.id, title: s.title, records: s._count.records })),
        }
    }

    static async createSection(session: Session, input: CreateSectionInput) {
        const vendor = await prisma.vendor.findUnique({ where: { id: input.vendorId }, select: { companyId: true } })
        if (!vendor) throw new Error("VENDOR_NOT_FOUND")
        allow(session, "records.contribute", vendor.companyId, "VENDOR_NOT_FOUND")
        const who = actor(session)
        try {
            return await prisma.$transaction(async tx => {
                const section = await tx.recordSection.create({
                    data: { title: input.title, vendorId: input.vendorId, createdById: who.byUser },
                    select: { id: true, title: true },
                })
                const { AuditLogService } = await import("./audit-log.service")
                await AuditLogService.log("CREATE_SECTION", "SECTION", section.id, { tx, ...who.audit, details: { title: input.title, vendorId: input.vendorId } })
                return section
            })
        } catch (error) {
            if (taken(error)) throw new Error("RECORD_SECTION_TAKEN")
            throw error
        }
    }

    static async renameSection(session: Session, input: RenameSectionInput) {
        const section = await sectionWithCompany(input.id)
        allow(session, "records.edit", section.companyId, "RECORD_SECTION_NOT_FOUND")
        const who = actor(session)
        try {
            return await prisma.$transaction(async tx => {
                const renamed = await tx.recordSection.update({
                    where: { id: input.id },
                    data: { title: input.title, lastEditedById: who.byUser },
                    select: { id: true, title: true },
                })
                const { AuditLogService } = await import("./audit-log.service")
                await AuditLogService.log("UPDATE_SECTION", "SECTION", input.id, { tx, ...who.audit, details: { before: { title: section.title }, after: { title: input.title } } })
                return renamed
            })
        } catch (error) {
            if (taken(error)) throw new Error("RECORD_SECTION_TAKEN")
            throw error
        }
    }

    /** A section and every record in it, with their files. */
    static async deleteSection(session: Session, id: string) {
        const section = await sectionWithCompany(id)
        allow(session, "records.delete", section.companyId, "RECORD_SECTION_NOT_FOUND")
        const who = actor(session)
        const records = await prisma.clientRecord.findMany({ where: { sectionId: id }, select: { attachment: true } })
        await prisma.$transaction(async tx => {
            await tx.recordSection.delete({ where: { id } })
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("DELETE_SECTION", "SECTION", id, { tx, ...who.audit, details: { title: section.title, vendorId: section.vendorId, records: records.length } })
        })
        await removeFiles(records.flatMap(r => parseRecordFiles(r.attachment)), section.companyId)
        return { id }
    }

    static async create(session: Session, input: CreateRecordInput) {
        const who = actor(session)
        let companyId: string
        let section: { id: string; vendorId: string } | null = null
        if (input.sectionId) {
            const found = await sectionWithCompany(input.sectionId)
            companyId = found.companyId
            section = found
            allow(session, "records.contribute", companyId, "RECORD_SECTION_NOT_FOUND")
        } else {
            const vendor = await prisma.vendor.findUnique({ where: { id: input.vendorId! }, select: { companyId: true } })
            if (!vendor) throw new Error("VENDOR_NOT_FOUND")
            companyId = vendor.companyId
            allow(session, "records.contribute", companyId, "VENDOR_NOT_FOUND")
        }
        checkFiles(input.files, companyId)

        return prisma.$transaction(async tx => {
            const { AuditLogService } = await import("./audit-log.service")
            let sectionId = section?.id
            if (!sectionId) {
                // A section of that name already there is the one meant.
                const existing = await tx.recordSection.findUnique({ where: { vendorId_title: { vendorId: input.vendorId!, title: input.sectionTitle! } }, select: { id: true } })
                if (existing) sectionId = existing.id
                else {
                    const made = await tx.recordSection.create({ data: { title: input.sectionTitle!, vendorId: input.vendorId!, createdById: who.byUser }, select: { id: true } })
                    await AuditLogService.log("CREATE_SECTION", "SECTION", made.id, { tx, ...who.audit, details: { title: input.sectionTitle, vendorId: input.vendorId } })
                    sectionId = made.id
                }
            }
            const record = await tx.clientRecord.create({
                data: {
                    content: input.content,
                    sectionId,
                    createdById: who.byUser,
                    attachment: storeRecordFiles(input.files),
                    expiryDate: input.expiryDate ? parseExpiryDay(input.expiryDate) : null,
                    reminderDays: input.expiryDate ? input.reminderDays : null,
                },
                select: { id: true, sectionId: true },
            })
            await AuditLogService.log("CREATE_NOTE", "NOTE", record.id, {
                tx, ...who.audit,
                details: { sectionId, files: input.files.length, expiryDate: input.expiryDate, contentPreview: snippet(input.content) },
            })
            return record
        })
    }

    static async update(session: Session, input: UpdateRecordInput) {
        const record = await recordWithCompany(input.id)
        allow(session, "records.contribute", record.companyId, "RECORD_NOT_FOUND")
        if (input.sectionId && input.sectionId !== record.sectionId) {
            // Another of the same client's sections; never another client's.
            const target = await sectionWithCompany(input.sectionId)
            if (target.vendorId !== record.vendorId) throw new Error("RECORD_SECTION_NOT_FOUND")
        }
        checkFiles(input.files, record.companyId)
        const who = actor(session)
        const expiryDate = input.expiryDate ? parseExpiryDay(input.expiryDate) : null
        const reminderDays = input.expiryDate ? input.reminderDays : null
        // A new date or reminder is a new deadline: its reminders are owed again.
        const datesChanged = (record.expiryDate?.getTime() ?? null) !== (expiryDate?.getTime() ?? null) || record.reminderDays !== reminderDays
        const before = parseRecordFiles(record.attachment)

        const updated = await prisma.$transaction(async tx => {
            const row = await tx.clientRecord.update({
                where: { id: input.id },
                data: {
                    content: input.content,
                    ...(input.sectionId ? { sectionId: input.sectionId } : {}),
                    attachment: storeRecordFiles(input.files),
                    expiryDate,
                    reminderDays,
                    ...(datesChanged ? { notifiedOnExpiry: false, notifiedDaysBefore: false } : {}),
                    lastEditedById: who.byUser,
                    lastEditedAt: new Date(),
                },
                select: { id: true, sectionId: true },
            })
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("UPDATE_NOTE", "NOTE", input.id, {
                tx, ...who.audit,
                details: { files: input.files.length, expiryDate: input.expiryDate, contentPreview: snippet(input.content) },
            })
            return row
        })
        const kept = new Set(input.files.map(f => f.url))
        await removeFiles(before.filter(f => !kept.has(f.url)), record.companyId)
        return updated
    }

    static async delete(session: Session, id: string) {
        const record = await recordWithCompany(id)
        allow(session, "records.delete", record.companyId, "RECORD_NOT_FOUND")
        const who = actor(session)
        await prisma.$transaction(async tx => {
            await tx.clientRecord.delete({ where: { id } })
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("DELETE_NOTE", "NOTE", id, {
                tx, ...who.audit,
                details: { sectionId: record.sectionId, contentPreview: snippet(record.content), files: parseRecordFiles(record.attachment).length },
            })
        })
        await removeFiles(parseRecordFiles(record.attachment), record.companyId)
        return { id }
    }

    /**
     * The daily reminder (vercel.json): whoever added a record hears about
     * it the day it expires, and the chosen number of days before. Each is
     * sent once per deadline; changing the date owes them again.
     */
    static async checkExpiries() {
        const today = recordsToday()
        const start = parseExpiryDay(today)!
        const tomorrow = parseExpiryDay(addDays(today, 1))!
        const include = { section: { select: { vendorId: true, vendor: { select: { name: true } } } } } as const
        const link = (id: string) => `/dashboard/records/${id}`

        const expiringToday = await prisma.clientRecord.findMany({
            where: { expiryDate: { gte: start, lt: tomorrow }, notifiedOnExpiry: false, section: { vendorId: { not: null } } },
            include,
        })
        for (const record of expiringToday) {
            await prisma.$transaction(async tx => {
                if (record.createdById) {
                    await tx.notification.create({
                        data: {
                            userId: record.createdById,
                            type: "NOTE_EXPIRING",
                            ...noticeRow({ key: "notice_note_expiring_today", params: { snippet: record.content.slice(0, 20), client: record.section.vendor!.name } }),
                            relatedId: link(record.id),
                        },
                    })
                }
                await tx.clientRecord.update({ where: { id: record.id }, data: { notifiedOnExpiry: true } })
            })
        }

        const pending = await prisma.clientRecord.findMany({
            where: { expiryDate: { gte: tomorrow }, reminderDays: { gt: 0 }, notifiedDaysBefore: false, section: { vendorId: { not: null } } },
            include,
        })
        let reminded = 0
        for (const record of pending) {
            const expires = expiryDay(record.expiryDate!)
            if (today < addDays(expires, -record.reminderDays!)) continue
            await prisma.$transaction(async tx => {
                if (record.createdById) {
                    await tx.notification.create({
                        data: {
                            userId: record.createdById,
                            type: "NOTE_REMINDER",
                            ...noticeRow({ key: "notice_note_expiring", params: { snippet: record.content.slice(0, 20), client: record.section.vendor!.name, days: daysBetween(today, expires) } }),
                            relatedId: link(record.id),
                        },
                    })
                }
                await tx.clientRecord.update({ where: { id: record.id }, data: { notifiedDaysBefore: true } })
            })
            reminded++
        }

        return { success: true, checkedAt: new Date().toISOString(), expiringToday: expiringToday.length, reminded }
    }
}
