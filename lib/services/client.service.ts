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

        if (!can(session.user, "clients.edit", { companyId: client.companyId })) {
            throw new Error("FORBIDDEN")
        }

        const { hq, ...fields } = rest
        // Restoring is ClientService.restore's, never a side effect of an edit.
        const details = { name: fields.name, ownerName: fields.ownerName, mobileNumber: fields.mobileNumber }
        const { AuditLogService } = await import("./audit-log.service")
        return prisma.$transaction(async tx => {
            await tx.client.update({ where: { id }, data: details })
            // Its HQ's details, and its own location fields with them: a
            // change to the HQ it has needs locations.edit (PR 377).
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

    /**
     * Deletes a client, or archives one with tasks, records or a tax position
     * (CLIENTS_PLAN.md §4.3; CLIENT_PORTAL_PLAN.md §3.6). With `archive`, it's
     * archived whatever it holds now: archiving is what was confirmed, and it
     * can be undone where deleting can't.
     *
     * With `forGood`, an archived client that no task or record holds is
     * deleted, its tax position going with it: the second step, and from the
     * archive only.
     */
    static async delete(id: string, session: any, options: { archive?: boolean; forGood?: boolean } = {}) {
        const userRole = session.user.role
        const userId = session.user.id

        const client = await prisma.client.findUnique({ where: { id } })
        if (!client) throw new Error("CLIENT_NOT_FOUND")

        if (!can(session.user, "clients.delete", { companyId: client.companyId })) {
            throw new Error("FORBIDDEN")
        }

        const { AuditLogService } = await import("./audit-log.service")
        return prisma.$transaction(async tx => {
            // One with tasks or records is archived instead (CLIENTS_PLAN.md
            // §4.3): its records would go with it, licences, contracts and
            // their files, and its tasks would lose it. Its row is held first,
            // so a record or task being added meanwhile is counted, or finds
            // the client gone.
            const locked = await tx.$queryRaw<{ id: string; archivedAt: Date | null }[]>`SELECT id, "archivedAt" FROM "Client" WHERE id = ${id} FOR UPDATE`
            if (!locked.length) throw new Error("CLIENT_NOT_FOUND")
            // One after another: a transaction has one connection.
            const records = await tx.clientRecord.count({ where: { section: { clientId: id } } })
            const tasks = await tx.task.count({ where: { clientId: id } })
            const held = records > 0 || tasks > 0
            // Its tax position is as much its history as its records are: a
            // file uploaded for it, with claims open or none
            // (CLIENT_PORTAL_PLAN.md §3.6).
            const claims = await tx.taxClaim.count({ where: { clientId: id } })
            const hasTax = claims > 0 || (await tx.clientTaxPosition.count({ where: { clientId: id } })) > 0
            // Its people who can sign in, whose accounts would go with it in
            // one step: archived instead, as for a tax position (§3.6, the
            // owner 2026-11-19, PR 329). Counted with the client held, so one
            // added meanwhile is counted, or finds the client gone.
            const people = await tx.clientAccount.count({ where: { clientId: id } })
            // What anyone holds for it in cash advances joins their running
            // balance, archived or deleted (CLIENTS_PLAN.md §7.9).
            const { CashAdvanceService } = await import("./cash-advance.service")
            const mover = { id: userId, name: session.user.name, role: userRole }
            if (options.forGood) {
                // From the archive only, so deleting for good is always a
                // second step; and never one that tasks or records hold, whose
                // records would go with it and whose tasks would lose it.
                if (!locked[0].archivedAt) throw new Error("CLIENT_NOT_ARCHIVED")
                if (held) throw new Error("CLIENT_IN_USE")
                await CashAdvanceService.movePart(tx, client.companyId, { taskId: null, clientId: id }, "CLIENT_DELETED", mover)
                const result = await tx.client.delete({ where: { id } })
                await AuditLogService.log('DELETE_VENDOR', 'VENDOR', id, {
                    tx,
                    userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                    superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                    // How many claims went with it, and how many of its people.
                    details: { name: client.name, claims, ...(people ? { people } : {}) }
                })
                return { ...result, archived: false as const, forTax: false, forPeople: false }
            }

            if (held || hasTax || people > 0 || options.archive) {
                const archived = await tx.client.update({ where: { id }, data: { archivedAt: locked[0].archivedAt ?? new Date() } })
                await CashAdvanceService.movePart(tx, client.companyId, { taskId: null, clientId: id }, "CLIENT_ARCHIVED", mover)
                await AuditLogService.log('ARCHIVE_VENDOR', 'VENDOR', id, {
                    tx,
                    userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                    superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                    details: { name: client.name, records, tasks, ...(hasTax ? { claims } : {}), ...(people ? { people } : {}) }
                })
                // Kept for its tax position alone, where no task or record
                // holds it; or for its people alone, where nothing else does.
                return { ...archived, archived: true as const, forTax: !held && hasTax, forPeople: !held && !hasTax && people > 0 }
            }

            await CashAdvanceService.movePart(tx, client.companyId, { taskId: null, clientId: id }, "CLIENT_DELETED", mover)
            const result = await tx.client.delete({ where: { id } })

            await AuditLogService.log('DELETE_VENDOR', 'VENDOR', id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                details: { name: client.name }
            })

            return { ...result, archived: false as const, forTax: false, forPeople: false }
        })
    }

    /** An archived client in use again (CLIENTS_PLAN.md §4.3): undoing archiving, so clients.delete's. */
    static async restore(id: string, session: any) {
        const client = await prisma.client.findUnique({ where: { id } })
        if (!client) throw new Error("CLIENT_NOT_FOUND")
        if (!can(session.user, "clients.delete", { companyId: client.companyId })) throw new Error("FORBIDDEN")
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
