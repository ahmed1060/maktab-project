import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { resolveTimeZone } from "@/lib/timezone"
import { dayRange } from "@/lib/day-range"

/**
 * The zone a list's date filter counts days in: the company's own, or the
 * platform's default (System Settings) for a Super Admin looking at every
 * company.
 */
export async function filterTimeZone(companyId: string | null | undefined, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<string> {
    const [company, settings] = await Promise.all([
        companyId ? db.company.findUnique({ where: { id: companyId }, select: { timezone: true } }) : null,
        db.systemSettings.findUnique({ where: { id: "default" }, select: { defaultTimezone: true } }),
    ])
    return resolveTimeZone(company?.timezone, settings?.defaultTimezone)
}

/** A date filter's days where the company is (lib/day-range.ts); null with no days, without asking for the zone. */
export async function dayRangeIn(from: string | null | undefined, to: string | null | undefined, companyId: string | null | undefined) {
    if (!from && !to) return null
    return dayRange(from, to, await filterTimeZone(companyId))
}
