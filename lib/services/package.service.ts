import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { CreatePackageInput, UpdatePackageInput } from "../validations/package.schema"

// Decimal.toJSON() returns a string, so prices are converted at the boundary —
// the same treatment CompanyPayment.cost already gets. priceLifetime stays null
// when it is null: "not sold as a lifetime purchase" must not become 0.
function serializePackage<T extends {
    priceMonthly: Prisma.Decimal
    priceAnnual: Prisma.Decimal
    priceLifetime: Prisma.Decimal | null
}>(pkg: T) {
    return {
        ...pkg,
        priceMonthly: Number(pkg.priceMonthly),
        priceAnnual: Number(pkg.priceAnnual),
        priceLifetime: pkg.priceLifetime === null ? null : Number(pkg.priceLifetime),
    }
}

export class PackageService {
    /**
     * @param includeInactive a retired package must still be visible on the
     *        management screen — it is only hidden from the assignment dropdown.
     */
    static async list({ includeInactive = false }: { includeInactive?: boolean } = {}) {
        const packages = await prisma.package.findMany({
            where: includeInactive ? {} : { isActive: true },
            orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
            include: { _count: { select: { companies: true } } },
        })
        return packages.map(serializePackage)
    }

    static async getById(id: string) {
        const pkg = await prisma.package.findUnique({
            where: { id },
            include: { _count: { select: { companies: true } } },
        })
        if (!pkg) throw new Error("PACKAGE_NOT_FOUND")
        return serializePackage(pkg)
    }

    static async create(input: CreatePackageInput, session: any) {
        const existing = await prisma.package.findUnique({ where: { name: input.name } })
        if (existing) throw new Error("PACKAGE_NAME_TAKEN")

        const pkg = await prisma.package.create({
            data: {
                name: input.name,
                description: input.description || null,
                isActive: input.isActive ?? true,
                isPublic: input.isPublic ?? true,
                priceMonthly: input.priceMonthly,
                priceAnnual: input.priceAnnual,
                priceLifetime: input.priceLifetime ?? null,
                hasCompanyManagement: input.hasCompanyManagement,
                hasHR: input.hasHR,
                hasAttendanceTerminals: input.hasAttendanceTerminals ?? false,
                hasAttendanceMobile: input.hasAttendanceMobile ?? false,
            },
        })

        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('CREATE_PACKAGE', 'PACKAGE', pkg.id, {
            superAdminId: session.user.id,
            details: {
                name: pkg.name,
                hasCompanyManagement: pkg.hasCompanyManagement,
                hasHR: pkg.hasHR,
                hasAttendanceTerminals: pkg.hasAttendanceTerminals,
                hasAttendanceMobile: pkg.hasAttendanceMobile,
            },
        })

        return serializePackage(pkg)
    }

    /**
     * An edit takes effect immediately for every company on this package — that
     * is the point of packages — so the caller is told how many companies it
     * touched, and the audit log records which switches moved. Turning a bundle
     * off here removes a module from live customers mid-day; that has to be
     * deliberate, and it has to be reconstructable afterwards.
     */
    static async update(input: UpdatePackageInput, session: any) {
        const { id, ...rest } = input

        const existing = await prisma.package.findUnique({
            where: { id },
            include: { _count: { select: { companies: true } } },
        })
        if (!existing) throw new Error("PACKAGE_NOT_FOUND")

        if (rest.name && rest.name !== existing.name) {
            const clash = await prisma.package.findUnique({ where: { name: rest.name } })
            if (clash) throw new Error("PACKAGE_NAME_TAKEN")
        }

        const data: Prisma.PackageUpdateInput = {}
        if (rest.name !== undefined) data.name = rest.name
        if (rest.description !== undefined) data.description = rest.description || null
        if (rest.isActive !== undefined) data.isActive = rest.isActive
        if (rest.isPublic !== undefined) data.isPublic = rest.isPublic
        if (rest.priceMonthly !== undefined) data.priceMonthly = rest.priceMonthly
        if (rest.priceAnnual !== undefined) data.priceAnnual = rest.priceAnnual
        if (rest.priceLifetime !== undefined) data.priceLifetime = rest.priceLifetime
        if (rest.hasCompanyManagement !== undefined) data.hasCompanyManagement = rest.hasCompanyManagement
        if (rest.hasHR !== undefined) data.hasHR = rest.hasHR
        if (rest.hasAttendanceTerminals !== undefined) data.hasAttendanceTerminals = rest.hasAttendanceTerminals
        if (rest.hasAttendanceMobile !== undefined) data.hasAttendanceMobile = rest.hasAttendanceMobile

        // Attendance only on top of HR (ATTENDANCE_PLAN.md §16). Turning HR
        // off turns both add-ons off with it, which the form says before
        // saving; asking for an add-on on a package that will not have HR is
        // refused, since there would be no payroll for attendance to feed.
        const willHaveHR = rest.hasHR ?? existing.hasHR
        if (!willHaveHR) {
            if (rest.hasAttendanceTerminals || rest.hasAttendanceMobile) throw new Error("ATTENDANCE_REQUIRES_HR")
            data.hasAttendanceTerminals = false
            data.hasAttendanceMobile = false
        }

        const updated = await prisma.package.update({
            where: { id },
            include: { _count: { select: { companies: true } } },
            data,
        })

        // Only the switches that actually moved, so the log reads as a change
        // rather than as a snapshot.
        const bundleChanges: Record<string, { from: boolean; to: boolean }> = {}
        if (rest.hasCompanyManagement !== undefined && rest.hasCompanyManagement !== existing.hasCompanyManagement) {
            bundleChanges.hasCompanyManagement = { from: existing.hasCompanyManagement, to: rest.hasCompanyManagement }
        }
        if (rest.hasHR !== undefined && rest.hasHR !== existing.hasHR) {
            bundleChanges.hasHR = { from: existing.hasHR, to: rest.hasHR }
        }
        // From what was written, not what was asked: an add-on that went off
        // because HR did is a change the log has to show.
        for (const key of ["hasAttendanceTerminals", "hasAttendanceMobile"] as const) {
            if (updated[key] !== existing[key]) bundleChanges[key] = { from: existing[key], to: updated[key] }
        }

        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('UPDATE_PACKAGE', 'PACKAGE', id, {
            superAdminId: session.user.id,
            details: {
                name: updated.name,
                companiesAffected: existing._count.companies,
                ...(Object.keys(bundleChanges).length > 0 ? { bundleChanges } : {}),
                ...(rest.isActive !== undefined && rest.isActive !== existing.isActive
                    ? { isActive: { from: existing.isActive, to: rest.isActive } }
                    : {}),
            },
        })

        return serializePackage(updated)
    }

    /**
     * Deletion is only ever allowed for a package nobody is on.
     *
     * The database already refuses the dangerous case — the packageId foreign
     * key is ON DELETE RESTRICT — but a foreign-key error surfaces to the user
     * as an opaque failure. This checks first so the answer is a sentence
     * rather than a stack trace, and the FK remains the thing that actually
     * guarantees it.
     */
    static async remove(id: string, session: any) {
        const existing = await prisma.package.findUnique({
            where: { id },
            include: { _count: { select: { companies: true } } },
        })
        if (!existing) throw new Error("PACKAGE_NOT_FOUND")
        if (existing._count.companies > 0) throw new Error("PACKAGE_IN_USE")

        await prisma.package.delete({ where: { id } })

        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('DELETE_PACKAGE', 'PACKAGE', id, {
            superAdminId: session.user.id,
            details: { name: existing.name },
        })

        return { id }
    }

    /**
     * Assign a package to a company, or null to return it to grandfathered.
     * Recorded from-and-to, because this is the action that changes what a
     * customer can see.
     */
    static async assignToCompany(companyId: string, packageId: string | null, session: any) {
        const company = await prisma.company.findUnique({
            where: { id: companyId },
            include: { package: { select: { id: true, name: true } } },
        })
        if (!company) throw new Error("COMPANY_NOT_FOUND")

        if (packageId) {
            const pkg = await prisma.package.findUnique({ where: { id: packageId } })
            if (!pkg) throw new Error("PACKAGE_NOT_FOUND")
            // A retired package stays on the companies already holding it, but
            // must not be newly assignable — that is what retiring it means.
            if (!pkg.isActive && company.packageId !== packageId) throw new Error("PACKAGE_INACTIVE")
        }

        const updated = await prisma.company.update({
            where: { id: companyId },
            data: { packageId },
            include: { package: { select: { id: true, name: true } } },
        })

        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('ASSIGN_COMPANY_PACKAGE', 'COMPANY', companyId, {
            superAdminId: session.user.id,
            details: {
                companyName: company.name,
                from: company.package?.name ?? null,
                to: updated.package?.name ?? null,
            },
        })

        return { companyId, package: updated.package }
    }
}
