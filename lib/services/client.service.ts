import { prisma } from "@/lib/prisma"
import { CreateClientInput, UpdateClientInput } from "../validations/client.schema"
import { can } from "@/lib/permissions/can"
import { googleMapsLink } from "@/lib/attendance/geo"
import { LocationService } from "./location.service"

export class ClientService {
    static async create(input: CreateClientInput, session: any) {
        const userRole = session.user.role
        const userId = session.user.id
        const userCompanyId = (session.user as any).companyId

        const { name, ownerName, mobileNumber, hq, companyId } = input

        let targetCompanyId = userCompanyId
        if (userRole === 'SUPER_ADMIN') {
            if (companyId) targetCompanyId = companyId
            else if (!targetCompanyId) throw new Error("COMPANY_SELECTION_REQUIRED")
        } else {
            if (!targetCompanyId) throw new Error("USER_NO_COMPANY")
        }

        // Client.createdById's FK targets User only — a Super Admin's id lives
        // in a separate table and would violate it. Same guard Task.create()
        // already uses for the identical reason.
        const byUser = userRole === 'SUPER_ADMIN' ? null : userId
        const { AuditLogService } = await import("./audit-log.service")
        return prisma.$transaction(async tx => {
            const client = await tx.client.create({
                data: {
                    name,
                    ownerName,
                    mobileNumber,
                    // Its HQ's, which the task form copies into a new task
                    // until step 2 (LocationService.saveHq keeps them so).
                    locationName: hq.name,
                    locationLink: googleMapsLink(hq.latitude, hq.longitude),
                    companyId: targetCompanyId!,
                    createdById: byUser,
                }
            })
            // Its HQ, with it: no client is ever without one it was given.
            await LocationService.saveHq(tx, client, hq, session)

            await AuditLogService.log('CREATE_VENDOR', 'VENDOR', client.id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                details: { name, companyId: targetCompanyId, hq }
            })
            return client
        })
    }

    static async update(input: UpdateClientInput, session: any) {
        const userRole = session.user.role
        const userId = session.user.id

        const { id, ...rest } = input

        const client = await prisma.client.findUnique({ where: { id } })
        if (!client) throw new Error("CLIENT_NOT_FOUND")

        if (!can(session.user, "clients.manage", { companyId: client.companyId })) {
            throw new Error("FORBIDDEN")
        }

        const { hq, ...fields } = rest
        // Restoring is ClientService.restore's, never a side effect of an edit.
        const details = { name: fields.name, ownerName: fields.ownerName, mobileNumber: fields.mobileNumber }
        const { AuditLogService } = await import("./audit-log.service")
        return prisma.$transaction(async tx => {
            await tx.client.update({ where: { id }, data: details })
            // Its HQ's details, and its own location fields with them: a
            // change to the HQ it has needs locations.manage.
            if (hq) await LocationService.saveHq(tx, client, hq, session)

            await AuditLogService.log('UPDATE_VENDOR', 'VENDOR', id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                details: rest
            })
            return tx.client.findUniqueOrThrow({ where: { id } })
        })
    }

    static async delete(id: string, session: any) {
        const userRole = session.user.role
        const userId = session.user.id

        const client = await prisma.client.findUnique({ where: { id } })
        if (!client) throw new Error("CLIENT_NOT_FOUND")

        if (!can(session.user, "clients.manage", { companyId: client.companyId })) {
            throw new Error("FORBIDDEN")
        }

        const { AuditLogService } = await import("./audit-log.service")
        return prisma.$transaction(async tx => {
            // One with tasks or records is archived instead (CLIENTS_PLAN.md
            // §4.3): its records would go with it, licences, contracts and
            // their files, and its tasks would lose it. Its row is held first,
            // so a record or task being added meanwhile is counted, or finds
            // the client gone.
            const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Client" WHERE id = ${id} FOR UPDATE`
            if (!locked.length) throw new Error("CLIENT_NOT_FOUND")
            const [records, tasks] = await Promise.all([
                tx.clientRecord.count({ where: { section: { clientId: id } } }),
                tx.task.count({ where: { clientId: id } }),
            ])
            if (records > 0 || tasks > 0) {
                const archived = await tx.client.update({ where: { id }, data: { archivedAt: client.archivedAt ?? new Date() } })
                await AuditLogService.log('ARCHIVE_VENDOR', 'VENDOR', id, {
                    tx,
                    userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                    superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                    details: { name: client.name, records, tasks }
                })
                return { ...archived, archived: true as const }
            }

            const result = await tx.client.delete({ where: { id } })

            await AuditLogService.log('DELETE_VENDOR', 'VENDOR', id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                details: { name: client.name }
            })

            return { ...result, archived: false as const }
        })
    }

    /** An archived client in use again (CLIENTS_PLAN.md §4.3). */
    static async restore(id: string, session: any) {
        const client = await prisma.client.findUnique({ where: { id } })
        if (!client) throw new Error("CLIENT_NOT_FOUND")
        if (!can(session.user, "clients.manage", { companyId: client.companyId })) throw new Error("FORBIDDEN")
        const { AuditLogService } = await import("./audit-log.service")
        return prisma.$transaction(async tx => {
            const restored = await tx.client.update({ where: { id }, data: { archivedAt: null } })
            await AuditLogService.log('RESTORE_VENDOR', 'VENDOR', id, {
                tx,
                userId: session.user.role !== 'SUPER_ADMIN' ? session.user.id : null,
                superAdminId: session.user.role === 'SUPER_ADMIN' ? session.user.id : null,
                details: { name: client.name }
            })
            return restored
        })
    }
}
