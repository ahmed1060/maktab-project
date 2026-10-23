import { prisma } from "@/lib/prisma"
import { CreateVendorInput, UpdateVendorInput } from "../validations/vendor.schema"
import { can } from "@/lib/permissions/can"

export class VendorService {
    static async create(input: CreateVendorInput, session: any) {
        const userRole = session.user.role
        const userId = session.user.id
        const userCompanyId = (session.user as any).companyId

        const { name, ownerName, mobileNumber, locationName, locationLink, companyId } = input

        let targetCompanyId = userCompanyId
        if (userRole === 'SUPER_ADMIN') {
            if (companyId) targetCompanyId = companyId
            else if (!targetCompanyId) throw new Error("COMPANY_SELECTION_REQUIRED")
        } else {
            if (!targetCompanyId) throw new Error("USER_NO_COMPANY")
        }

        const vendor = await prisma.vendor.create({
            data: {
                name,
                ownerName,
                mobileNumber,
                locationName,
                locationLink: locationLink || null,
                companyId: targetCompanyId!,
                // Vendor.createdById's FK targets User only — a Super Admin's
                // id lives in a separate table and would violate it. Same
                // guard Task.create() already uses for the identical reason.
                createdById: userRole === 'SUPER_ADMIN' ? null : userId
            }
        })

        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('CREATE_VENDOR', 'VENDOR', vendor.id, {
            userId: userRole !== 'SUPER_ADMIN' ? userId : null,
            superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
            details: { name, companyId: targetCompanyId }
        })

        return vendor
    }

    static async update(input: UpdateVendorInput, session: any) {
        const userRole = session.user.role
        const userId = session.user.id

        const { id, ...rest } = input

        const vendor = await prisma.vendor.findUnique({ where: { id } })
        if (!vendor) throw new Error("VENDOR_NOT_FOUND")

        if (!can(session.user, "vendors.manage", { companyId: vendor.companyId })) {
            throw new Error("FORBIDDEN")
        }

        const updateData: any = { ...rest }
        if ('locationLink' in rest) updateData.locationLink = rest.locationLink || null

        const updated = await prisma.vendor.update({
            where: { id },
            data: updateData
        })

        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('UPDATE_VENDOR', 'VENDOR', id, {
            userId: userRole !== 'SUPER_ADMIN' ? userId : null,
            superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
            details: rest
        })

        return updated
    }

    static async delete(id: string, session: any) {
        const userRole = session.user.role
        const userId = session.user.id

        const vendor = await prisma.vendor.findUnique({ where: { id } })
        if (!vendor) throw new Error("VENDOR_NOT_FOUND")

        if (!can(session.user, "vendors.manage", { companyId: vendor.companyId })) {
            throw new Error("FORBIDDEN")
        }

        const { AuditLogService } = await import("./audit-log.service")
        return prisma.$transaction(async tx => {
            // Its records would go with it (CLIENTS_PLAN.md §0.2): licences,
            // contracts and their files. Nobody loses those by deleting the
            // business; they're deleted on its page first, one by one. Its
            // row is held first, so a record being added meanwhile
            // (RecordService.create) is counted, or finds the client gone.
            const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Vendor" WHERE id = ${id} FOR UPDATE`
            if (!locked.length) throw new Error("VENDOR_NOT_FOUND")
            const records = await tx.clientRecord.count({ where: { section: { vendorId: id } } })
            if (records > 0) throw new Error("VENDOR_HAS_RECORDS")

            // Tasks that used this vendor keep their copied location text —
            // Task.vendorId just SetNulls (see the migration comment), no
            // historical data loss.
            const result = await tx.vendor.delete({ where: { id } })

            await AuditLogService.log('DELETE_VENDOR', 'VENDOR', id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                details: { name: vendor.name }
            })

            return result
        })
    }
}
