import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { hasModule, resolveBundles, type Module } from "@/lib/features/bundles"

/** A package's switches, as resolveBundles reads them. */
export const PACKAGE_FACTS = {
    select: { hasCompanyManagement: true, hasHR: true, hasAttendanceTerminals: true, hasAttendanceMobile: true },
} as const

/**
 * Whether a company's package includes a module, read from the company
 * itself rather than from whoever is acting. What a module records is the
 * company's, so it's recorded or not whoever records it: the company's own
 * people, the Super Admin, and the nightly job, which acts for nobody. A
 * company with no package is grandfathered, with everything
 * (lib/features/bundles.ts).
 */
export async function companyHasModule(companyId: string, module: Module, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<boolean> {
    const company = await db.company.findUnique({ where: { id: companyId }, select: { package: PACKAGE_FACTS } })
    return !!company && hasModule(resolveBundles(company.package), module)
}
