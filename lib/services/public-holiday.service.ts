import { prisma } from "@/lib/prisma"
import { isDateString, toDateString } from "@/lib/attendance/calendar"
import { AuditLogService } from "./audit-log.service"
import { recomputeEveryCompanyAfter } from "./attendance-recompute"

/**
 * The central calendar of public holidays (ATTENDANCE_PLAN.md §7.2), kept by
 * the Super Admin. Every company observes it unless it opted a day out.
 *
 * Moving a holiday — Egyptian holidays are sometimes moved by decree — is an
 * edit to its date, not a delete and a re-add: a company that opted out of it
 * is opted out of the holiday, wherever it lands.
 */

const DATE_ONLY = (date: string) => new Date(`${date}T00:00:00Z`)

function fail(code: string): never {
    throw new Error(code)
}

export type PublicHolidayInput = { date: string; name: string; nameAr?: string | null }

function serialize(h: { id: string; date: Date; name: string; nameAr: string | null; _count?: { exclusions: number } }) {
    return { id: h.id, date: toDateString(h.date), name: h.name, nameAr: h.nameAr, companiesSkipping: h._count?.exclusions ?? 0 }
}

export class PublicHolidayService {
    static async list(year: number) {
        const rows = await prisma.publicHoliday.findMany({
            where: { country: "EG", date: { gte: DATE_ONLY(`${year}-01-01`), lte: DATE_ONLY(`${year}-12-31`) } },
            include: { _count: { select: { exclusions: true } } },
            orderBy: { date: "asc" },
        })
        return rows.map(serialize)
    }

    private static check(input: PublicHolidayInput) {
        if (!isDateString(input.date)) fail("INVALID_DATE")
        if (!input.name?.trim()) fail("HOLIDAY_NAME_REQUIRED")
    }

    static async create(input: PublicHolidayInput, superAdminId: string) {
        this.check(input)
        // Each change and its audit entry commit together, or neither does
        // (review on #10): a holiday saved without its record looked lost.
        const out = await prisma.$transaction(async tx => {
            if (await tx.publicHoliday.findUnique({ where: { country_date: { country: "EG", date: DATE_ONLY(input.date) } } })) fail("HOLIDAY_DATE_TAKEN")
            const created = await tx.publicHoliday.create({
                data: { country: "EG", date: DATE_ONLY(input.date), name: input.name.trim(), nameAr: input.nameAr?.trim() || null },
            })
            await AuditLogService.log("CREATE_PUBLIC_HOLIDAY", "PUBLIC_HOLIDAY", created.id, {
                tx, superAdminId, details: { name: created.name, date: input.date },
            })
            return serialize(created)
        })
        await recomputeEveryCompanyAfter(input.date)
        return out
    }

    /**
     * A date or name change. A move reaches every company that observes the
     * holiday; days already locked by a company's payroll stay as they were
     * paid (§12) — the engine does not rewrite a locked day.
     */
    static async update(id: string, input: PublicHolidayInput, superAdminId: string) {
        this.check(input)
        let movedFrom = input.date
        const out = await prisma.$transaction(async tx => {
            const existing = await tx.publicHoliday.findUnique({ where: { id } }) ?? fail("HOLIDAY_NOT_FOUND")
            const clash = await tx.publicHoliday.findUnique({ where: { country_date: { country: existing.country, date: DATE_ONLY(input.date) } } })
            if (clash && clash.id !== id) fail("HOLIDAY_DATE_TAKEN")
            const updated = await tx.publicHoliday.update({
                where: { id },
                data: { date: DATE_ONLY(input.date), name: input.name.trim(), nameAr: input.nameAr?.trim() || null },
                include: { _count: { select: { exclusions: true } } },
            })
            const from = toDateString(existing.date)
            movedFrom = [from, input.date].sort()[0]
            await AuditLogService.log("UPDATE_PUBLIC_HOLIDAY", "PUBLIC_HOLIDAY", id, {
                tx, superAdminId,
                details: {
                    name: updated.name,
                    ...(from !== input.date ? { date: { from, to: input.date } } : { date: input.date }),
                },
            })
            return serialize(updated)
        })
        await recomputeEveryCompanyAfter(movedFrom)
        return out
    }

    static async remove(id: string, superAdminId: string) {
        const removedDate = await prisma.$transaction(async tx => {
            const existing = await tx.publicHoliday.findUnique({ where: { id } }) ?? fail("HOLIDAY_NOT_FOUND")
            await tx.publicHoliday.delete({ where: { id } })
            await AuditLogService.log("DELETE_PUBLIC_HOLIDAY", "PUBLIC_HOLIDAY", id, {
                tx, superAdminId, details: { name: existing.name, date: toDateString(existing.date) },
            })
            return toDateString(existing.date)
        })
        await recomputeEveryCompanyAfter(removedDate)
    }
}
