import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { AuditLogService } from "./audit-log.service"
import { recomputeAfter } from "./attendance-recompute"
import { serialize } from "./attendance-calendar.service"
import { localToInstant, parseRows, detectColumns, type Cell, type ColumnMap, type DateOrder, type RowError } from "@/lib/attendance/punch-import"
import { MAX_ROWS } from "@/lib/attendance/punch-file"
import { addDays } from "@/lib/attendance/calendar"

/**
 * Punches (ATTENDANCE_PLAN.md §8.6): what arrives from a spreadsheet or is
 * added by hand, and which person a terminal's employee number is. Access is
 * the caller's — the routes check attendance.view_team and attendance.correct.
 *
 * Punches are evidence (§3): stored as they came, never edited or deleted. A
 * wrong one, or a whole wrong file, is withdrawn — kept, marked, and left out
 * of everything that counts.
 *
 * Nothing lands in, or is withdrawn from, a month whose payroll is approved or
 * paid. Every write takes the company-month lock first (§12.1), so it cannot
 * cross the approval that locks the month.
 */

const PREVIEW_PROBLEMS = 50

function fail(code: string): never {
    throw new Error(code)
}

async function actorOf(tx: Prisma.TransactionClient, actorId: string) {
    const superAdmin = await tx.superAdmin.findUnique({ where: { id: actorId }, select: { id: true } })
    return superAdmin ? { superAdminId: actorId } : { userId: actorId }
}

const monthOf = (local: string) => local.slice(0, 7)

/** "2026-10-01T08:05:00" as the Date Prisma stores in a TIMESTAMP column. */
const wallClock = (local: string) => new Date(`${local}Z`)
const wallClockText = (d: Date) => d.toISOString().slice(0, 19)

/**
 * Takes the company-month lock for each month, in order (§12.1). Payroll
 * approval takes the same lock, so a punch and the approval that freezes its
 * month happen one after the other, never across each other.
 */
export async function lockMonths(tx: Prisma.TransactionClient, companyId: string, months: Iterable<string>) {
    for (const month of [...new Set(months)].sort()) await serialize(tx, `attendance-month:${companyId}:${month}`)
}

/** Which of these months have an approved or paid payroll run. Read after the lock. */
export async function lockedMonths(tx: Prisma.TransactionClient, companyId: string, months: Iterable<string>): Promise<Set<string>> {
    const wanted = [...new Set(months)]
    if (wanted.length === 0) return new Set()
    const runs = await tx.payrollRun.findMany({
        where: {
            companyId, status: { in: ["APPROVED", "PAID"] },
            OR: wanted.map(m => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) })),
        },
        select: { year: true, month: true },
    })
    return new Set(runs.map(r => `${r.year}-${String(r.month).padStart(2, "0")}`))
}

/** Whose punches a viewer sees: the company's, their team's, or their own. */
export type Visibility = { kind: "COMPANY" } | { kind: "TEAM"; leaderId: string } | { kind: "OWN"; userId: string }

function visibleWhere(v: Visibility): Prisma.AttendancePunchWhereInput {
    if (v.kind === "COMPANY") return {}
    if (v.kind === "TEAM") return { user: { OR: [{ teamLeaderId: v.leaderId }, { id: v.leaderId }] } }
    return { userId: v.userId }
}

export type ImportOptions = { dateOrder: DateOrder; columns?: ColumnMap | null }

export type ImportReport = {
    fileHash: string
    fileName: string
    headers: string[]
    columns: ColumnMap | null
    rowCount: number
    /** Rows that read, and are in a month still open. */
    ready: number
    /** Of those, rows an earlier import of this file already stored. */
    duplicates: number
    /** Rows in a month whose payroll is approved or paid. */
    locked: number
    problems: { row: number; code: string | null; error: RowError }[]
    problemCount: number
    codes: { code: string; userId: string | null; name: string | null; rows: number }[]
    from: string | null
    to: string | null
    /** Set once committed. */
    importId?: string
    added?: number
}

export class AttendancePunchService {
    // --- import ---------------------------------------------------------------

    /**
     * Reads a file's rows and says what importing it would do: nothing is
     * written unless `commit`. Committing writes every readable row in an open
     * month — rows whose employee number nobody has yet are stored too, without
     * a person, and find one when the number is mapped (§11).
     */
    static async importRows(
        companyId: string,
        file: { name: string; hash: string; rows: Cell[][] },
        options: ImportOptions,
        actorId: string,
        commit: boolean,
    ): Promise<ImportReport> {
        const detected = detectColumns(file.rows)
        const columns = options.columns ?? detected?.columns ?? null
        const headerRow = detected?.headerRow ?? 0
        const headers = detected?.headers ?? (file.rows[0] ?? []).map(c => String(c ?? ""))
        const empty: ImportReport = {
            fileHash: file.hash, fileName: file.name, headers, columns, rowCount: 0, ready: 0, duplicates: 0, locked: 0,
            problems: [], problemCount: 0, codes: [], from: null, to: null,
        }
        if (!columns) return empty
        const parsed = parseRows(file.rows, headerRow, columns, options.dateOrder)
        if (parsed.length > MAX_ROWS) fail("IMPORT_TOO_MANY_ROWS")
        const good = parsed.filter(r => r.ok)
        const problems = parsed.flatMap(r => (r.ok ? [] : [{ row: r.row, code: r.code, error: r.error }]))

        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } }) ?? fail("COMPANY_NOT_FOUND")
        const mappings = await prisma.attendanceCode.findMany({
            where: { companyId, code: { in: [...new Set(good.map(r => r.code))] } },
            select: { code: true, userId: true, user: { select: { firstName: true, lastName: true } } },
        })
        const owner = new Map(mappings.map(m => [m.code, m]))
        const sourceKey = (row: number) => `${file.hash}:${row}`

        const run = async (tx: Prisma.TransactionClient) => {
            const months = new Set(good.map(r => monthOf(r.local)))
            if (commit) await lockMonths(tx, companyId, months)
            const locked = await lockedMonths(tx, companyId, months)
            const open = good.filter(r => !locked.has(monthOf(r.local)))
            const existing = await tx.attendancePunch.findMany({
                where: { companyId, source: "IMPORT", sourceKey: { in: open.map(r => sourceKey(r.row)) } },
                select: { sourceKey: true },
            })
            const seen = new Set(existing.map(e => e.sourceKey))
            const fresh = open.filter(r => !seen.has(sourceKey(r.row)))

            const byCode = new Map<string, number>()
            for (const r of good) byCode.set(r.code, (byCode.get(r.code) ?? 0) + 1)
            const dates = good.map(r => r.local.slice(0, 10)).sort()
            const report: ImportReport = {
                ...empty,
                rowCount: parsed.length,
                ready: open.length,
                duplicates: open.length - fresh.length,
                locked: good.length - open.length,
                problems: problems.slice(0, PREVIEW_PROBLEMS),
                problemCount: problems.length,
                codes: [...byCode].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([code, rows]) => {
                    const m = owner.get(code)
                    return { code, userId: m?.userId ?? null, name: m ? `${m.user.firstName} ${m.user.lastName}`.trim() : null, rows }
                }),
                from: dates[0] ?? null,
                to: dates.at(-1) ?? null,
            }
            if (!commit) return report
            if (fresh.length === 0) fail("IMPORT_NOTHING_NEW")

            const created = await tx.attendanceImport.create({
                data: {
                    companyId, fileName: file.name, fileHash: file.hash, rowCount: parsed.length,
                    addedCount: fresh.length, duplicateCount: report.duplicates, refusedCount: problems.length + report.locked,
                    createdById: actorId,
                },
            })
            await tx.attendancePunch.createMany({
                data: fresh.map(r => ({
                    companyId, source: "IMPORT" as const, sourceKey: sourceKey(r.row), importId: created.id,
                    userId: owner.get(r.code)?.userId ?? null, hardwareUserId: r.code,
                    punchAtLocal: wallClock(r.local), punchAt: localToInstant(r.local, company.timezone),
                    resolvedWithTimeZone: company.timezone, direction: r.direction, createdById: actorId,
                })),
                skipDuplicates: true,
            })
            await AuditLogService.log("IMPORT_ATTENDANCE_PUNCHES", "ATTENDANCE_IMPORT", created.id, {
                tx, ...(await actorOf(tx, actorId)),
                details: { companyId, fileName: file.name, rows: parsed.length, added: fresh.length, duplicates: report.duplicates, refused: created.refusedCount, from: report.from, to: report.to },
            })
            return { ...report, importId: created.id, added: fresh.length }
        }
        if (!commit) return run(prisma as unknown as Prisma.TransactionClient)
        const report = await prisma.$transaction(run, { timeout: 60_000 })
        // The whole company: a file can move the first punch earlier, and with it the first derived day.
        if (report.from) await recomputeAfter(companyId, report.from)
        return report
    }

    static async imports(companyId: string) {
        const rows = await prisma.attendanceImport.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 50 })
        return rows.map(r => ({
            id: r.id, fileName: r.fileName, createdAt: r.createdAt, rowCount: r.rowCount, addedCount: r.addedCount,
            duplicateCount: r.duplicateCount, refusedCount: r.refusedCount, voidedAt: r.voidedAt, voidReason: r.voidReason,
        }))
    }

    static async importOf(id: string) {
        return prisma.attendanceImport.findUnique({ where: { id }, select: { id: true, companyId: true, fileName: true, voidedAt: true } })
    }

    /** Withdraws every punch a file brought in. Refused if any of them is in a locked month. */
    static async voidImport(id: string, reason: string, actorId: string) {
        if (!reason.trim()) fail("REASON_REQUIRED")
        const out = await prisma.$transaction(async tx => {
            const imp = await tx.attendanceImport.findUnique({ where: { id } }) ?? fail("IMPORT_NOT_FOUND")
            if (imp.voidedAt) fail("IMPORT_ALREADY_VOIDED")
            const punches = await tx.attendancePunch.findMany({ where: { importId: id, voidedAt: null }, select: { id: true, punchAtLocal: true } })
            const months = punches.map(p => monthOf(wallClockText(p.punchAtLocal)))
            await lockMonths(tx, imp.companyId, months)
            if ((await lockedMonths(tx, imp.companyId, months)).size > 0) fail("PAYROLL_MONTH_LOCKED")
            const now = new Date()
            const voided = await tx.attendancePunch.updateMany({
                where: { importId: id, voidedAt: null },
                data: { voidedAt: now, voidedById: actorId, voidReason: reason.trim() },
            })
            await tx.attendanceImport.update({ where: { id }, data: { voidedAt: now, voidedById: actorId, voidReason: reason.trim() } })
            await AuditLogService.log("VOID_ATTENDANCE_IMPORT", "ATTENDANCE_IMPORT", id, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId: imp.companyId, fileName: imp.fileName, punches: voided.count, reason: reason.trim() },
            })
            return { voided: voided.count, companyId: imp.companyId, from: months.sort()[0] ?? null }
        })
        if (out.from) await recomputeAfter(out.companyId, `${out.from}-01`)
        return { voided: out.voided }
    }

    // --- one punch ------------------------------------------------------------

    /** Lists punches between two dates (inclusive), newest first, as far as the viewer sees. */
    static async list(companyId: string, query: { from: string; to: string; userId?: string | null; unmatched?: boolean }, visible: Visibility) {
        if (query.unmatched && visible.kind !== "COMPANY") return []
        const rows = await prisma.attendancePunch.findMany({
            where: {
                companyId,
                punchAtLocal: { gte: wallClock(`${query.from}T00:00:00`), lt: new Date(wallClock(`${query.to}T00:00:00`).getTime() + 86400_000) },
                ...(query.unmatched ? { userId: null } : query.userId ? { userId: query.userId } : { userId: { not: null } }),
                ...visibleWhere(visible),
            },
            orderBy: [{ punchAtLocal: "desc" }],
            take: 2000,
            select: {
                id: true, userId: true, hardwareUserId: true, source: true, punchAtLocal: true, direction: true, status: true, note: true,
                importId: true, receivedAt: true, voidedAt: true, voidReason: true,
                user: { select: { firstName: true, lastName: true } },
            },
        })
        return rows.map(({ user, punchAtLocal, ...r }) => ({
            ...r, at: wallClockText(punchAtLocal), name: user ? `${user.firstName} ${user.lastName}`.trim() : null,
        }))
    }

    /** The people whose punches the viewer sees, for choosing one: everyone not deleted, or their team and themselves. */
    static async people(companyId: string, visible: Visibility) {
        const users = await prisma.user.findMany({
            where: {
                companyId, status: { not: "DELETED" },
                ...(visible.kind === "TEAM" ? { OR: [{ teamLeaderId: visible.leaderId }, { id: visible.leaderId }] } : visible.kind === "OWN" ? { id: visible.userId } : {}),
            },
            select: { id: true, firstName: true, lastName: true, teamLeaderId: true },
            orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        })
        return users.map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), teamLeaderId: u.teamLeaderId }))
    }

    static async punchOf(id: string) {
        return prisma.attendancePunch.findUnique({
            where: { id },
            select: { id: true, companyId: true, userId: true, voidedAt: true, user: { select: { teamLeaderId: true } } },
        })
    }

    /** A punch added by hand: for somebody else, with a reason (§14). */
    static async addManual(companyId: string, input: { userId: string; at: string; direction: "IN" | "OUT" | null; note: string }, actorId: string) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(input.at)) fail("INVALID_DATE")
        const local = input.at.length === 16 ? `${input.at}:00` : input.at
        if (isNaN(wallClock(local).getTime()) || wallClockText(wallClock(local)) !== local) fail("INVALID_DATE")
        if (!input.note.trim()) fail("REASON_REQUIRED")
        if (input.userId === actorId) fail("CANNOT_CORRECT_OWN")
        const out = await prisma.$transaction(async tx => {
            const person = await tx.user.findFirst({ where: { id: input.userId, companyId }, select: { id: true, status: true } }) ?? fail("USER_NOT_FOUND")
            if (person.status === "DELETED") fail("USER_NOT_FOUND")
            const company = await tx.company.findUnique({ where: { id: companyId }, select: { timezone: true } }) ?? fail("COMPANY_NOT_FOUND")
            await lockMonths(tx, companyId, [monthOf(local)])
            if ((await lockedMonths(tx, companyId, [monthOf(local)])).size > 0) fail("PAYROLL_MONTH_LOCKED")
            const id = randomUUID()
            await tx.attendancePunch.create({
                data: {
                    id, companyId, userId: person.id, source: "MANUAL", sourceKey: id,
                    punchAtLocal: wallClock(local), punchAt: localToInstant(local, company.timezone), resolvedWithTimeZone: company.timezone,
                    direction: input.direction, note: input.note.trim(), createdById: actorId,
                },
            })
            await AuditLogService.log("ADD_ATTENDANCE_PUNCH", "ATTENDANCE_PUNCH", id, {
                tx, ...(await actorOf(tx, actorId)),
                details: { companyId, userId: person.id, at: local, direction: input.direction, reason: input.note.trim() },
            })
            return { id }
        })
        // From the day before: a punch after midnight may close the night before's shift.
        await recomputeAfter(companyId, addDays(local.slice(0, 10), -1), [input.userId])
        return out
    }

    /** Withdraws one punch, keeping it on record. */
    static async voidPunch(id: string, reason: string, actorId: string) {
        if (!reason.trim()) fail("REASON_REQUIRED")
        const punch = await prisma.$transaction(async tx => {
            const punch = await tx.attendancePunch.findUnique({ where: { id } }) ?? fail("PUNCH_NOT_FOUND")
            if (punch.voidedAt) fail("PUNCH_ALREADY_VOIDED")
            if (punch.userId && punch.userId === actorId) fail("CANNOT_CORRECT_OWN")
            const month = monthOf(wallClockText(punch.punchAtLocal))
            await lockMonths(tx, punch.companyId, [month])
            if ((await lockedMonths(tx, punch.companyId, [month])).size > 0) fail("PAYROLL_MONTH_LOCKED")
            await tx.attendancePunch.update({ where: { id }, data: { voidedAt: new Date(), voidedById: actorId, voidReason: reason.trim() } })
            await AuditLogService.log("VOID_ATTENDANCE_PUNCH", "ATTENDANCE_PUNCH", id, {
                tx, ...(await actorOf(tx, actorId)),
                details: { companyId: punch.companyId, userId: punch.userId, at: wallClockText(punch.punchAtLocal), reason: reason.trim() },
            })
            return punch
        })
        if (punch.userId) await recomputeAfter(punch.companyId, addDays(wallClockText(punch.punchAtLocal).slice(0, 10), -1), [punch.userId])
    }

    // --- employee numbers -----------------------------------------------------

    /** The numbers mapped to people, and the numbers seen with nobody yet. */
    static async codes(companyId: string) {
        const [mapped, unmatched] = await Promise.all([
            prisma.attendanceCode.findMany({
                where: { companyId }, orderBy: { code: "asc" },
                select: { id: true, code: true, userId: true, user: { select: { firstName: true, lastName: true } } },
            }),
            prisma.attendancePunch.groupBy({
                by: ["hardwareUserId"],
                where: { companyId, userId: null, voidedAt: null, hardwareUserId: { not: null } },
                _count: { _all: true }, _min: { punchAtLocal: true }, _max: { punchAtLocal: true },
            }),
        ])
        return {
            mapped: mapped.map(m => ({ id: m.id, code: m.code, userId: m.userId, name: `${m.user.firstName} ${m.user.lastName}`.trim() })),
            unmatched: unmatched
                .map(u => ({ code: u.hardwareUserId!, punches: u._count._all, from: wallClockText(u._min.punchAtLocal!).slice(0, 10), to: wallClockText(u._max.punchAtLocal!).slice(0, 10) }))
                .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
        }
    }

    static async codeOf(id: string) {
        return prisma.attendanceCode.findUnique({ where: { id }, select: { id: true, companyId: true, code: true, userId: true, user: { select: { teamLeaderId: true } } } })
    }

    /**
     * Says who an employee number is, and gives that person the punches already
     * stored under it with nobody — in open months. Punches in a locked month
     * stay unmatched: that month was paid without them.
     */
    static async mapCode(companyId: string, input: { code: string; userId: string }, actorId: string) {
        const code = input.code.trim()
        if (!code) fail("CODE_REQUIRED")
        if (input.userId === actorId) fail("CANNOT_CORRECT_OWN")
        const out = await prisma.$transaction(async tx => {
            const person = await tx.user.findFirst({ where: { id: input.userId, companyId, status: { not: "DELETED" } }, select: { id: true, firstName: true, lastName: true } }) ?? fail("USER_NOT_FOUND")
            await serialize(tx, `attendance-codes:${companyId}`)
            if (await tx.attendanceCode.findUnique({ where: { companyId_code: { companyId, code } } })) fail("CODE_TAKEN")
            const mapping = await tx.attendanceCode.create({ data: { companyId, code, userId: person.id, createdById: actorId } })
            const waiting = await tx.attendancePunch.findMany({ where: { companyId, userId: null, hardwareUserId: code }, select: { id: true, punchAtLocal: true } })
            const months = waiting.map(p => monthOf(wallClockText(p.punchAtLocal)))
            await lockMonths(tx, companyId, months)
            const locked = await lockedMonths(tx, companyId, months)
            const fill = waiting.filter(p => !locked.has(monthOf(wallClockText(p.punchAtLocal)))).map(p => p.id)
            if (fill.length > 0) await tx.attendancePunch.updateMany({ where: { id: { in: fill } }, data: { userId: person.id } })
            await AuditLogService.log("MAP_ATTENDANCE_CODE", "ATTENDANCE_CODE", mapping.id, {
                tx, ...(await actorOf(tx, actorId)),
                details: { companyId, code, userId: person.id, name: `${person.firstName} ${person.lastName}`.trim(), filled: fill.length, leftInLockedMonths: waiting.length - fill.length },
            })
            const firstFilled = waiting.filter(p => fill.includes(p.id)).map(p => wallClockText(p.punchAtLocal).slice(0, 10)).sort()[0] ?? null
            return { id: mapping.id, filled: fill.length, leftInLockedMonths: waiting.length - fill.length, userId: person.id, firstFilled }
        })
        if (out.firstFilled) await recomputeAfter(companyId, addDays(out.firstFilled, -1), [out.userId])
        return { id: out.id, filled: out.filled, leftInLockedMonths: out.leftInLockedMonths }
    }

    /**
     * Removes a mapping made in error. Imported punches it gave the person in
     * open months go back to nobody; those in locked months stay as paid.
     */
    static async unmapCode(id: string, actorId: string) {
        const out = await prisma.$transaction(async tx => {
            const mapping = await tx.attendanceCode.findUnique({ where: { id } }) ?? fail("CODE_NOT_FOUND")
            if (mapping.userId === actorId) fail("CANNOT_CORRECT_OWN")
            await serialize(tx, `attendance-codes:${mapping.companyId}`)
            const given = await tx.attendancePunch.findMany({
                where: { companyId: mapping.companyId, userId: mapping.userId, hardwareUserId: mapping.code, source: { not: "MANUAL" } },
                select: { id: true, punchAtLocal: true },
            })
            const months = given.map(p => monthOf(wallClockText(p.punchAtLocal)))
            await lockMonths(tx, mapping.companyId, months)
            const locked = await lockedMonths(tx, mapping.companyId, months)
            const back = given.filter(p => !locked.has(monthOf(wallClockText(p.punchAtLocal)))).map(p => p.id)
            if (back.length > 0) await tx.attendancePunch.updateMany({ where: { id: { in: back } }, data: { userId: null } })
            await tx.attendanceCode.delete({ where: { id } })
            await AuditLogService.log("UNMAP_ATTENDANCE_CODE", "ATTENDANCE_CODE", id, {
                tx, ...(await actorOf(tx, actorId)),
                details: { companyId: mapping.companyId, code: mapping.code, userId: mapping.userId, unfilled: back.length },
            })
            const firstBack = given.filter(p => back.includes(p.id)).map(p => wallClockText(p.punchAtLocal).slice(0, 10)).sort()[0] ?? null
            return { unfilled: back.length, companyId: mapping.companyId, userId: mapping.userId, firstBack }
        })
        if (out.firstBack) await recomputeAfter(out.companyId, addDays(out.firstBack, -1), [out.userId])
        return { unfilled: out.unfilled }
    }
}
