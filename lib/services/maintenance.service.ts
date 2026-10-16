import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { supabase } from "@/lib/storage"
import { decideCleanup } from "@/lib/orphan-guard"
import { RESERVED_PATHS, extractBucketPaths, isSweepable } from "@/lib/bucket-refs"

export class MaintenanceService {
    /**
     * Get system health statistics.
     */
    static async getStats() {
        const ninetyDaysAgo = new Date()
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

        const [
            totalLogs,
            oldLogs,
            totalNotifications,
            oldNotifications,
            storageFiles
        ] = await Promise.all([
            prisma.auditLog.count(),
            prisma.auditLog.count({ where: { createdAt: { lt: ninetyDaysAgo } } }),
            prisma.notification.count(),
            prisma.notification.count({ where: { read: true, createdAt: { lt: thirtyDaysAgo } } }),
            // File storage is a separate service. When it can't be reached,
            // the rest of the page still reports, and says so, rather than
            // the whole health check failing with a 500: an outage is when
            // somebody opens this page.
            this.listAllAssets().catch(() => null)
        ])

        return {
            auditing: {
                total: totalLogs,
                prunable: oldLogs,
                retentionDays: 90
            },
            notifications: {
                total: totalNotifications,
                prunable: oldNotifications,
                retentionDays: 30
            },
            storage: {
                totalFiles: storageFiles ? storageFiles.length : null,
                reachable: storageFiles !== null,
            }
        }
    }

    /**
     * Every object in the bucket, by full path.
     *
     * Supabase's list() is not recursive: it returns one level, with folders
     * appearing as entries that have no id. Called on '' it therefore returned
     * "avatars", "templates", "<companyId>" — prefixes, not objects — while
     * every caller was comparing them against full paths like
     * "avatars/1712-ab.png". Nothing could ever match, so every prefix looked
     * orphaned and every real file looked referenced. Verified against the live
     * bucket: 106 objects, none of them at the root.
     */
    static async listAllAssets(prefix = ''): Promise<{ name: string; size: number }[]> {
        const LIMIT = 1000
        let entries: any[] = []
        let offset = 0

        while (true) {
            const { data: batch, error } = await supabase.storage.from('app-assets').list(prefix, { limit: LIMIT, offset })
            if (error) throw error
            if (!batch || batch.length === 0) break

            entries = entries.concat(batch)
            if (batch.length < LIMIT) break
            offset += LIMIT
        }

        const files: { name: string; size: number }[] = []
        for (const entry of entries) {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name
            // A folder is an entry with no id. Recursing on it is what turns
            // this into a list of objects rather than a list of directories.
            if (entry.id === null || entry.id === undefined) {
                files.push(...await this.listAllAssets(path))
            } else {
                // Size carried through so a report can say how much a sweep
                // would free. A count alone does not tell anybody whether this
                // is worth doing or worth double-checking.
                files.push({ name: path, size: Number(entry.metadata?.size ?? 0) })
            }
        }
        return files
    }



    /**
     * Every bucket path any live row refers to.
     *
     * All six columns that can hold one, and the sweep deletes whatever is not
     * in here — so a column added later and forgotten here is a delayed data
     * loss. lib/bucket-refs.ts explains why each value is scanned rather than
     * parsed.
     *
     * AuditLog.details is deliberately absent, and it is the one exclusion
     * worth stating. It does contain bucket URLs — an avatar reset records the
     * old one — but as a record of what a value used to be, not as a thing
     * still in use. Counting history as a reference would mean no file this app
     * has ever replaced is ever collectable.
     */
    static async collectReferencedPaths(): Promise<Set<string>> {
        const referenced = new Set<string>()
        const BATCH = 500
        const add = (value: unknown) => {
            for (const path of extractBucketPaths(value)) referenced.add(path)
        }

        // Paged, because these are the two that scale with usage.
        for (let skip = 0; ; skip += BATCH) {
            const rows = await prisma.user.findMany({
                where: { avatar: { not: null } },
                select: { avatar: true },
                skip, take: BATCH,
            })
            rows.forEach(r => add(r.avatar))
            if (rows.length < BATCH) break
        }

        for (let skip = 0; ; skip += BATCH) {
            const rows = await prisma.task.findMany({
                where: { attachments: { not: Prisma.DbNull } },
                select: { attachments: true },
                skip, take: BATCH,
            })
            rows.forEach(r => add(r.attachments))
            if (rows.length < BATCH) break
        }

        for (let skip = 0; ; skip += BATCH) {
            const rows = await prisma.obligation.findMany({
                where: { attachments: { not: null } },
                select: { attachments: true },
                skip, take: BATCH,
            })
            rows.forEach(r => add(r.attachments))
            if (rows.length < BATCH) break
        }

        for (let skip = 0; ; skip += BATCH) {
            const rows = await prisma.clientRecord.findMany({
                where: { attachment: { not: null } },
                select: { attachment: true },
                skip, take: BATCH,
            })
            rows.forEach(r => add(r.attachment))
            if (rows.length < BATCH) break
        }

        // Bounded by the number of companies and of Super Admins, so unpaged.
        const companies = await prisma.company.findMany({
            where: { logoUrl: { not: null } },
            select: { logoUrl: true },
        })
        companies.forEach(c => add(c.logoUrl))

        // Was missing until the reference set was audited against the live
        // bucket, which found a Super Admin's avatar sitting in it unreferenced
        // — it would have been deleted on the first sweep that ran.
        const superAdmins = await prisma.superAdmin.findMany({
            where: { avatar: { not: null } },
            select: { avatar: true },
        })
        superAdmins.forEach(a => add(a.avatar))

        return referenced
    }

    /**
     * Orphaned storage objects: what is in the bucket that no row refers to.
     *
     * Reports by default and deletes only when told to. That is not timidity
     * about the code, it is the shape of the risk: the reference set is a
     * hand-kept list of six queries that has to grow whenever a feature starts
     * storing a file, and nothing in a typecheck or a build notices when it
     * does not. So the first sweep of any backlog should be a list somebody
     * reads, and the threshold in lib/orphan-guard.ts stands between an
     * unreviewed run and a mass delete.
     *
     * `confirm` is how a person who has read that list authorises it anyway —
     * needed for a genuine backlog, where a large share is the honest answer
     * rather than a sign of a missing table.
     */
    static async cleanupOrphanedAssets(options: { dryRun?: boolean; confirm?: boolean } = {}) {
        const { dryRun = true, confirm = false } = options
        console.log(`[Maintenance] Orphan sweep (${dryRun ? 'report only' : 'deleting'})...`)

        const allFiles = await this.listAllAssets()
        const sweepable = allFiles.filter(f => isSweepable(f.name))
        if (sweepable.length === 0) {
            return { deleted: 0, total: 0, orphaned: 0, orphans: [], bytes: 0, dryRun, reserved: RESERVED_PATHS.length }
        }

        const referenced = await this.collectReferencedPaths()
        const orphanFiles = sweepable.filter(f => !referenced.has(f.name))
        const orphans = orphanFiles.map(f => f.name)

        const decision = decideCleanup(orphans.length, sweepable.length)
        const summary = {
            total: sweepable.length,
            referenced: referenced.size,
            orphaned: orphans.length,
            orphans,
            bytes: orphanFiles.reduce((sum, f) => sum + f.size, 0),
            dryRun,
        }

        if (decision.proceed === false && decision.reason === 'nothing_to_do') {
            console.log("[Maintenance] No orphaned assets found.")
            return { ...summary, deleted: 0 }
        }

        if (dryRun) {
            return { ...summary, deleted: 0, wouldRefuse: !decision.proceed }
        }

        if (!decision.proceed && !confirm) {
            const share = decision.reason === 'implausible' ? decision.share : 0
            console.error(`[Maintenance] Refusing to delete ${orphans.length} of ${sweepable.length} objects (${Math.round(share * 100)}%) without confirmation — the reference set may be incomplete.`)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('SYSTEM_CLEANUP', 'SYSTEM', 'MAINTENANCE', {
                details: { refused: true, wouldHaveDeleted: orphans.length, total: sweepable.length, reason: 'orphan share above threshold, unconfirmed' }
            })
            return { ...summary, deleted: 0, refused: true }
        }

        // Supabase caps how many keys one remove() accepts, and a single call
        // for thousands is also a single failure for all of them.
        const CHUNK = 100
        let deleted = 0
        for (let i = 0; i < orphans.length; i += CHUNK) {
            const chunk = orphans.slice(i, i + CHUNK)
            const { error } = await supabase.storage.from('app-assets').remove(chunk)
            if (error) throw error
            deleted += chunk.length
        }

        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('SYSTEM_CLEANUP', 'SYSTEM', 'MAINTENANCE', {
            details: { deletedFiles: deleted, total: sweepable.length, confirmed: confirm, filenames: orphans.slice(0, 200) }
        })

        console.log(`[Maintenance] Deleted ${deleted} orphaned files.`)
        return { ...summary, deleted }
    }

    /**
     * Prune old audit logs based on retention policy.
     */
    static async pruneOldLogs(retentionDays: number = 90) {
        const threshold = new Date()
        threshold.setDate(threshold.getDate() - retentionDays)

        console.log(`[Maintenance] Pruning logs older than ${retentionDays} days (${threshold.toISOString()})...`)

        const result = await prisma.auditLog.deleteMany({
            where: { createdAt: { lt: threshold } }
        })

        if (result.count > 0) {
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('SYSTEM_PRUNE_LOGS', 'SYSTEM', 'MAINTENANCE', {
                details: { deletedCount: result.count, retentionDays }
            })
        }

        console.log(`[Maintenance] Pruned ${result.count} audit logs.`)
        return result.count
    }

    /**
     * Prune old read notifications.
     */
    static async pruneOldNotifications(retentionDays: number = 30) {
        const threshold = new Date()
        threshold.setDate(threshold.getDate() - retentionDays)

        console.log(`[Maintenance] Pruning read notifications older than ${retentionDays} days...`)

        const result = await prisma.notification.deleteMany({
            where: {
                read: true,
                createdAt: { lt: threshold }
            }
        })

        if (result.count > 0) {
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('SYSTEM_PRUNE_NOTIFICATIONS', 'SYSTEM', 'MAINTENANCE', {
                details: { deletedCount: result.count, retentionDays }
            })
        }

        console.log(`[Maintenance] Pruned ${result.count} notifications.`)
        return result.count
    }
}
