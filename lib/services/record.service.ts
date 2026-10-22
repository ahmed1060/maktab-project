import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { noticeRow } from "@/lib/notice-row"
import { supabase } from "@/lib/storage"
import { calendarDateStr } from "@/lib/time"
import { resolveTimeZone } from "@/lib/timezone"
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

/** "Today" in a company's own time zone: what its records' expiry is measured against. */
export const recordsToday = (timeZone?: string | null) => calendarDateStr(new Date(), resolveTimeZone(timeZone))

/** Each time zone companies are in, as stored, with its "today". */
async function companyDays() {
    const zones = await prisma.company.findMany({ distinct: ["timezone"], select: { timezone: true } })
    return zones.map(z => ({ timezone: z.timezone, today: recordsToday(z.timezone) }))
}

async function companyToday(companyId: string) {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } })
    return recordsToday(company?.timezone)
}

/** How many clients the Add record picker lists at once; a search by name finds the rest. */
export const CLIENTS_SHOWN = 50

const PERSON = { select: { firstName: true, lastName: true } } as const

const ROW = (withCompany: boolean) => ({
    id: true, content: true, attachment: true, expiryDate: true, reminderDays: true,
    createdAt: true, lastEditedAt: true,
    createdBy: PERSON, lastEditedBy: PERSON, createdBySuperAdmin: true, lastEditedBySuperAdmin: true,
    section: {
        select: {
            id: true, title: true,
            vendor: { select: { id: true, name: true, ...(withCompany ? { company: { select: { name: true, timezone: true } } } : {}) } },
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
    /** Whoever's missing above was a Super Admin; otherwise a user since deleted. */
    createdBySuperAdmin: boolean
    lastEditedBySuperAdmin: boolean
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
        createdBySuperAdmin: r.createdBySuperAdmin,
        lastEditedBySuperAdmin: r.lastEditedBySuperAdmin,
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

/**
 * Each file must be one uploaded here for this company (lib/record-files.ts).
 * A Super Admin's own uploads, under "platform", are given to a record only
 * by a Super Admin: anyone else who had one's address could put it on their
 * own company's records. One a record already has stays, whoever edits it.
 */
function checkFiles(session: Session, files: readonly RecordFile[], companyId: string, had: ReadonlySet<string> = new Set()) {
    for (const f of files) {
        const path = ownFilePath(f.url, companyId)
        if (!path) throw new Error("RECORD_FILE_INVALID")
        if (path.startsWith("platform/") && !isSuperAdmin(session) && !had.has(f.url)) throw new Error("RECORD_FILE_INVALID")
    }
}

/**
 * Each file a record is newly given is in storage. An address of the right
 * shape needn't be one that was uploaded: one made up, or for a file since
 * removed, would be kept as a file nobody can open. One removed after this
 * is refused when it's claimed (claimFiles), as its removal is noted first.
 */
async function checkStored(files: readonly RecordFile[], companyId: string) {
    const paths = [...new Set(files.map(f => ownFilePath(f.url, companyId)).filter((p): p is string => !!p))]
    if (!paths.length || !supabase) return
    const storage = supabase.storage.from("app-assets")
    const stored = await Promise.all(paths.map(async path => (await storage.exists(path)).data))
    if (stored.some(found => !found)) throw new Error("RECORD_FILE_INVALID")
}

/** The lock on one file, between its removal and a record being given it. */
const fileLock = (path: string) => `record-file:${path}`

/**
 * Files a record is being given, inside the transaction that writes it:
 * held against their removal (removeFiles) until it's saved, and refused if
 * one has been removed, as its object is gone.
 */
async function claimFiles(tx: Prisma.TransactionClient, files: readonly RecordFile[], companyId: string) {
    const paths = [...new Set(files.map(f => ownFilePath(f.url, companyId)).filter((p): p is string => !!p))].sort()
    if (!paths.length) return
    for (const path of paths) await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${fileLock(path)}, 0))::text`
    if (await tx.removedRecordFile.count({ where: { path: { in: paths } } })) throw new Error("RECORD_FILE_INVALID")
}

/** How many files one call to storage removes: it caps the keys per call (as MaintenanceService's sweep does). */
const REMOVE_CHUNK = 100

/**
 * Removes files from storage once no record refers to them: a file can be
 * on two records, when someone attached one record's file to another. Called
 * once the record no longer refers to them itself. Each file is held while
 * it's checked and noted as removed, and that note is committed before
 * storage is asked, so no record is given it meanwhile or afterwards
 * (claimFiles), even should the database fail once storage has it gone. In
 * as many calls as storage takes them, each on its own, so one refused
 * leaves the rest removed. Best effort: a file storage refuses stays noted as
 * removed, and the orphan sweep removes it.
 */
async function removeFiles(files: readonly RecordFile[], companyId: string) {
    const unique = [...new Set(files.map(f => ownFilePath(f.url, companyId)).filter((p): p is string => !!p))].sort()
    if (!unique.length || !supabase) return
    const storage = supabase
    for (let i = 0; i < unique.length; i += REMOVE_CHUNK) {
        const chunk = unique.slice(i, i + REMOVE_CHUNK)
        try {
            const paths = await prisma.$transaction(async tx => {
                for (const path of chunk) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fileLock(path)}, 0))::text`
                const names = chunk.map(p => p.slice(p.lastIndexOf("/") + 1))
                const others = await tx.clientRecord.findMany({ where: { OR: names.map(name => ({ attachment: { contains: name } })) }, select: { attachment: true } })
                const stillUsed = new Set(others.flatMap(r => parseRecordFiles(r.attachment).map(f => ownFilePath(f.url, companyId))))
                const paths = chunk.filter(p => !stillUsed.has(p))
                if (paths.length) await tx.removedRecordFile.createMany({ data: paths.map(path => ({ path })), skipDuplicates: true })
                return paths
            })
            if (!paths.length) continue
            // A refused removal comes back as an error, not thrown.
            const { error } = await storage.storage.from("app-assets").remove(paths)
            if (error) throw error
        } catch (error) {
            console.error("Failed to delete record files from storage:", error)
        }
    }
}

/** Postgres's "could not obtain lock" for a NOWAIT, however Prisma wraps it. */
const lockNotAvailable = (error: unknown): boolean => {
    const e = error as { code?: string; meta?: { code?: string }; cause?: unknown; message?: string } | null
    return !!e && (e.code === "55P03" || e.meta?.code === "55P03" || /could not obtain lock/.test(e.message ?? "") || lockNotAvailable(e.cause))
}

/**
 * A record's notice, in its own transaction, with the record held and
 * whoever it goes to held too, so they can't be deleted while it's sent.
 * The record is held first, as an edit and its company's deletion hold it
 * before the people its company deletes. A user's own deletion holds them
 * before their records, so they're asked for without waiting: one being
 * deleted means letting go, and going again once they are, when the record
 * no longer names them (Codex on #82). Null for nobody to send it to.
 */
async function withNotice(recordId: string, send: (tx: Prisma.TransactionClient, to: string | null) => Promise<void>) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await prisma.$transaction(async tx => {
                const [held] = await tx.$queryRaw<{ createdById: string | null }[]>`SELECT "createdById" FROM "ClientNote" WHERE id = ${recordId} FOR NO KEY UPDATE`
                if (!held) return
                const to = held.createdById
                    && (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ${held.createdById} FOR KEY SHARE NOWAIT`).length
                    ? held.createdById : null
                await send(tx, to)
            })
        } catch (error) {
            if (attempt >= 5 || !lockNotAvailable(error)) throw error
            await new Promise(r => setTimeout(r, 100 * attempt))
        }
    }
}

/** Typed text as Prisma's contains matches it: its letters as they are, LIKE's own %, _ and backslash escaped. */
const likeText = (text: string) => text.replace(/[\\%_]/g, c => `\\${c}`)

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

        // Every company's records by its own day, for a Super Admin looking at them all.
        const days = companyId ? null : await companyDays()
        const today = companyId ? await companyToday(companyId) : recordsToday()
        const trimmed = query.search?.trim()
        const search = trimmed ? likeText(trimmed) : ""
        const where: Prisma.ClientRecordWhereInput = {
            section: {
                vendorId: query.vendorId ? query.vendorId : { not: null },
                ...(query.sectionId ? { id: query.sectionId } : {}),
                ...(companyId ? { vendor: { companyId } } : {}),
            },
            ...(query.expiry && !days ? { expiryDate: expiryRange(query.expiry, today) } : {}),
            ...(query.expiry && days ? {
                AND: [{ OR: days.map(d => ({ expiryDate: expiryRange(query.expiry!, d.today), section: { vendor: { company: { timezone: d.timezone } } } })) }],
            } : {}),
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
        const dayOf = (r: Row) => {
            const zone = (r.section.vendor as { company?: { timezone: string } } | null)?.company?.timezone
            return days?.find(d => d.timezone === zone)?.today ?? today
        }
        return { data: rows.map(r => shape(r, dayOf(r))), total, today }
    }

    /** One record, for the link in its reminder. */
    static async get(session: Session, id: string) {
        const found = await recordWithCompany(id)
        allow(session, "records.view", found.companyId, "RECORD_NOT_FOUND")
        const row = await prisma.clientRecord.findUnique({ where: { id }, select: ROW(false) })
        // Deleted since its company was looked up.
        if (!row) throw new Error("RECORD_NOT_FOUND")
        return shape(row, await companyToday(found.companyId))
    }

    /**
     * The clients a record can be added to, by name, for adding one from the
     * Records page: someone who may add records but not see the vendors
     * list, as an ordinary employee, otherwise has no way to reach a client
     * without records yet. A Super Admin's chosen company's, or every
     * company's, each named with its company.
     */
    static async clients(session: Session, companyId?: string | null, search?: string | null) {
        const sa = isSuperAdmin(session)
        const company = sa ? companyId || null : session.user.companyId
        if (!sa && !company) return { clients: [], more: false }
        if (!sa && !can(session.user as any, "records.contribute", { companyId: company! })) throw new Error("RECORD_FORBIDDEN")
        const trimmed = search?.trim()
        const name = trimmed ? likeText(trimmed) : ""
        const vendors = await prisma.vendor.findMany({
            where: { ...(company ? { companyId: company } : {}), ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}) },
            select: { id: true, name: true, ...(company ? {} : { company: { select: { name: true } } }) },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            // One past what's listed, to say there are more to search for.
            take: CLIENTS_SHOWN + 1,
        })
        return {
            clients: vendors.slice(0, CLIENTS_SHOWN).map(v => ({ id: v.id, name: v.name, ...("company" in v && v.company ? { company: (v.company as { name: string }).name } : {}) })),
            more: vendors.length > CLIENTS_SHOWN,
        }
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
                // The client's lock a first record takes to start a section by
                // name (create), so the two don't both start one of a name.
                const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Vendor" WHERE id = ${input.vendorId} FOR NO KEY UPDATE`
                if (!locked.length) throw new Error("VENDOR_NOT_FOUND")
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
                // As createSection: no first record starts a section of the new name meanwhile.
                const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Vendor" WHERE id = ${section.vendorId} FOR NO KEY UPDATE`
                if (!locked.length) throw new Error("RECORD_SECTION_NOT_FOUND")
                // And the section, which may have been deleted since it was
                // found (deleteSection), or renamed: its title now is the one
                // this renames, and audits.
                const [held] = await tx.$queryRaw<{ id: string; title: string }[]>`SELECT id, title FROM "ClientSection" WHERE id = ${input.id} FOR NO KEY UPDATE`
                if (!held) throw new Error("RECORD_SECTION_NOT_FOUND")
                const renamed = await tx.recordSection.update({
                    where: { id: input.id },
                    data: { title: input.title, lastEditedById: who.byUser },
                    select: { id: true, title: true },
                })
                const { AuditLogService } = await import("./audit-log.service")
                await AuditLogService.log("UPDATE_SECTION", "SECTION", input.id, { tx, ...who.audit, details: { before: { title: held.title }, after: { title: input.title } } })
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
        const records = await prisma.$transaction(async tx => {
            // Held first, so a record being added meanwhile (create) is among
            // those deleted here, with its files, or finds the section gone.
            const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ClientSection" WHERE id = ${id} FOR UPDATE`
            if (!locked.length) throw new Error("RECORD_SECTION_NOT_FOUND")
            // Its records too, so an edit of one's files (update) is listed
            // here as it's saved, rather than read from before it.
            await tx.$queryRaw`SELECT id FROM "ClientNote" WHERE "sectionId" = ${id} ORDER BY id FOR UPDATE`
            const records = await tx.clientRecord.findMany({ where: { sectionId: id }, select: { attachment: true } })
            await tx.recordSection.delete({ where: { id } })
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("DELETE_SECTION", "SECTION", id, { tx, ...who.audit, details: { title: section.title, vendorId: section.vendorId, records: records.length } })
            return records
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
        checkFiles(session, input.files, companyId)
        await checkStored(input.files, companyId)

        return prisma.$transaction(async tx => {
            const { AuditLogService } = await import("./audit-log.service")
            let sectionId: string
            if (section) {
                sectionId = section.id
                // Holds the client while the record is written, so it isn't
                // deleted meanwhile with the record in it (VendorService.delete).
                const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Vendor" WHERE id = ${section.vendorId} FOR SHARE`
                if (!locked.length) throw new Error("RECORD_SECTION_NOT_FOUND")
                // And the section, which isn't deleted meanwhile either (deleteSection).
                const held = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ClientSection" WHERE id = ${section.id} FOR SHARE`
                if (!held.length) throw new Error("RECORD_SECTION_NOT_FOUND")
            } else {
                // One at a time per client, so two people naming the same new
                // section at once start it once: the second finds the first's.
                // It holds the client from being deleted meanwhile too.
                const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Vendor" WHERE id = ${input.vendorId!} FOR NO KEY UPDATE`
                if (!locked.length) throw new Error("VENDOR_NOT_FOUND")
                // A section of that name already there is the one meant, held as above.
                const [existing] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ClientSection" WHERE "vendorId" = ${input.vendorId!} AND title = ${input.sectionTitle!} FOR SHARE`
                if (existing) sectionId = existing.id
                else {
                    const made = await tx.recordSection.create({ data: { title: input.sectionTitle!, vendorId: input.vendorId!, createdById: who.byUser }, select: { id: true } })
                    await AuditLogService.log("CREATE_SECTION", "SECTION", made.id, { tx, ...who.audit, details: { title: input.sectionTitle, vendorId: input.vendorId } })
                    sectionId = made.id
                }
            }
            await claimFiles(tx, input.files, companyId)
            const record = await tx.clientRecord.create({
                data: {
                    content: input.content,
                    sectionId,
                    createdById: who.byUser,
                    createdBySuperAdmin: isSuperAdmin(session),
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
        // Those it didn't have as it was read are new; one added since is refused below (RECORD_CHANGED).
        const had = new Set(parseRecordFiles(record.attachment).map(f => f.url))
        checkFiles(session, input.files, record.companyId, had)
        await checkStored(input.files.filter(f => !had.has(f.url)), record.companyId)
        const who = actor(session)
        const expiryDate = input.expiryDate ? parseExpiryDay(input.expiryDate) : null
        const reminderDays = input.expiryDate ? input.reminderDays : null

        const { row: updated, before } = await prisma.$transaction(async tx => {
            // The record as it is now, held until this edit is written: another
            // edit just before may have added files this one replaces, or
            // changed the date it's compared with.
            const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ClientNote" WHERE id = ${input.id} FOR UPDATE`
            if (!locked.length) throw new Error("RECORD_NOT_FOUND")
            const current = await tx.clientRecord.findUniqueOrThrow({ where: { id: input.id }, select: { attachment: true, expiryDate: true, reminderDays: true, sectionId: true } })
            // The section it moves to, held until it's there, so it isn't
            // deleted meanwhile (deleteSection) with nowhere for the record to
            // go. Not the one it's in: that deletion holds its section, then
            // waits for this record.
            if (input.sectionId && input.sectionId !== current.sectionId) {
                const held = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ClientSection" WHERE id = ${input.sectionId} FOR SHARE`
                if (!held.length) throw new Error("RECORD_SECTION_NOT_FOUND")
            }
            // Made from the record as it was before someone else changed its
            // files: refused, or a file they took off, and that's removed from
            // storage, could come back on the record from this older form.
            const now = new Set(parseRecordFiles(current.attachment).map(f => f.url))
            const seen = new Set(input.filesBefore)
            if (now.size !== seen.size || [...now].some(url => !seen.has(url))) throw new Error("RECORD_CHANGED")
            await claimFiles(tx, input.files.filter(f => !now.has(f.url)), record.companyId)
            // A new date or reminder is a new deadline: its reminders are owed again.
            const datesChanged = (current.expiryDate?.getTime() ?? null) !== (expiryDate?.getTime() ?? null) || current.reminderDays !== reminderDays
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
                    lastEditedBySuperAdmin: isSuperAdmin(session),
                    lastEditedAt: new Date(),
                },
                select: { id: true, sectionId: true },
            })
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("UPDATE_NOTE", "NOTE", input.id, {
                tx, ...who.audit,
                details: { files: input.files.length, expiryDate: input.expiryDate, contentPreview: snippet(input.content) },
            })
            return { row, before: parseRecordFiles(current.attachment) }
        })
        const kept = new Set(input.files.map(f => f.url))
        await removeFiles(before.filter(f => !kept.has(f.url)), record.companyId)
        return updated
    }

    static async delete(session: Session, id: string) {
        const record = await recordWithCompany(id)
        allow(session, "records.delete", record.companyId, "RECORD_NOT_FOUND")
        const who = actor(session)
        const files = await prisma.$transaction(async tx => {
            // The record as it's deleted: an edit just before may have added files.
            const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ClientNote" WHERE id = ${id} FOR UPDATE`
            if (!locked.length) throw new Error("RECORD_NOT_FOUND")
            const gone = await tx.clientRecord.findUniqueOrThrow({ where: { id }, select: { content: true, sectionId: true, attachment: true } })
            await tx.clientRecord.delete({ where: { id } })
            const files = parseRecordFiles(gone.attachment)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("DELETE_NOTE", "NOTE", id, {
                tx, ...who.audit,
                details: { sectionId: gone.sectionId, contentPreview: snippet(gone.content), files: files.length },
            })
            return files
        })
        await removeFiles(files, record.companyId)
        return { id }
    }

    /**
     * Every file of a company's records, read inside the transaction that
     * deletes the company with them (CompanyService.delete), to remove once
     * it's done.
     */
    static async filesOfCompany(tx: Prisma.TransactionClient, companyId: string) {
        // Held first, as their own deletions hold them: the company, so no
        // client is added to it meanwhile; its clients, so no record is added
        // meanwhile (create); then their records, so an edit of one's files
        // (update) is listed as it's saved.
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM "Vendor" WHERE "companyId" = ${companyId} ORDER BY id FOR UPDATE`
        await tx.$queryRaw`SELECT n.id FROM "ClientNote" n JOIN "ClientSection" s ON s.id = n."sectionId" JOIN "Vendor" v ON v.id = s."vendorId" WHERE v."companyId" = ${companyId} ORDER BY n.id FOR UPDATE OF n`
        const rows = await tx.clientRecord.findMany({ where: { attachment: { not: null }, section: { vendor: { companyId } } }, select: { attachment: true } })
        return rows.flatMap(r => parseRecordFiles(r.attachment))
    }

    /** Removes files no record has any more, as once their company is deleted. Best effort, like every removal here. */
    static async removeUnused(files: readonly RecordFile[], companyId: string) {
        await removeFiles(files, companyId)
    }

    /**
     * Files the person uploaded for a record that was never saved with them,
     * as when its form is closed or a save fails and they give up: removed
     * again. Only records' files in their own company's folder, or a Super
     * Admin's own, that no record has.
     */
    static async discardUploads(session: Session, urls: readonly string[]) {
        const folder = isSuperAdmin(session) ? "platform" : session.user.companyId
        if (!folder) throw new Error("RECORD_FORBIDDEN")
        if (!isSuperAdmin(session) && !can(session.user as any, "records.contribute", { companyId: folder })) throw new Error("RECORD_FORBIDDEN")
        const files = urls.filter(url => ownFilePath(url, folder)?.startsWith(`${folder}/`)).map(url => ({ url, name: "", size: 0 }))
        await removeFiles(files, folder)
        return { files: files.length }
    }

    /**
     * The daily reminder (vercel.json): whoever added a record hears about
     * it the day it expires, and the chosen number of days before, each day
     * counted where the record's company is. Each is sent once per deadline;
     * changing the date owes them again.
     */
    static async checkExpiries() {
        let expiringToday = 0
        let reminded = 0
        // Each company's records on its own day.
        for (const { timezone, today } of await companyDays()) {
            const done = await RecordService.checkExpiriesOn(today, { vendorId: { not: null }, vendor: { company: { timezone } } })
            expiringToday += done.expiringToday
            reminded += done.reminded
        }
        return { success: true, checkedAt: new Date().toISOString(), expiringToday, reminded }
    }

    /** The reminders owed today for the records in these sections: the companies whose day it is. */
    private static async checkExpiriesOn(today: string, section: Prisma.RecordSectionWhereInput) {
        const start = parseExpiryDay(today)!
        const tomorrow = parseExpiryDay(addDays(today, 1))!
        const include = { section: { select: { vendorId: true, vendor: { select: { name: true } } } } } as const
        const link = (id: string) => `/dashboard/records/${id}`

        const expiringToday = await prisma.clientRecord.findMany({
            where: { expiryDate: { gte: start, lt: tomorrow }, notifiedOnExpiry: false, section },
            include,
        })
        let expiring = 0
        for (const record of expiringToday) {
            await withNotice(record.id, async (tx, to) => {
                // Claimed on the deadline it was found for: an edit since then owes its own notice instead.
                const claimed = await tx.clientRecord.updateMany({ where: { id: record.id, expiryDate: record.expiryDate, notifiedOnExpiry: false }, data: { notifiedOnExpiry: true } })
                if (!claimed.count) return
                expiring++
                if (to) {
                    await tx.notification.create({
                        data: {
                            userId: to,
                            type: "NOTE_EXPIRING",
                            ...noticeRow({ key: "notice_note_expiring_today", params: { snippet: record.content.slice(0, 20), client: record.section.vendor!.name } }),
                            relatedId: link(record.id),
                        },
                    })
                }
            })
        }

        const pending = await prisma.clientRecord.findMany({
            where: { expiryDate: { gte: tomorrow }, reminderDays: { gt: 0 }, notifiedDaysBefore: false, section },
            include,
        })
        let reminded = 0
        for (const record of pending) {
            const expires = expiryDay(record.expiryDate!)
            if (today < addDays(expires, -record.reminderDays!)) continue
            await withNotice(record.id, async (tx, to) => {
                const claimed = await tx.clientRecord.updateMany({
                    where: { id: record.id, expiryDate: record.expiryDate, reminderDays: record.reminderDays, notifiedDaysBefore: false },
                    data: { notifiedDaysBefore: true },
                })
                if (!claimed.count) return
                reminded++
                if (to) {
                    await tx.notification.create({
                        data: {
                            userId: to,
                            type: "NOTE_REMINDER",
                            ...noticeRow({ key: "notice_note_expiring", params: { snippet: record.content.slice(0, 20), client: record.section.vendor!.name, days: daysBetween(today, expires) } }),
                            relatedId: link(record.id),
                        },
                    })
                }
            })
        }

        return { expiringToday: expiring, reminded }
    }
}
