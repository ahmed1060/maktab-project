import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { supabase } from "@/lib/storage"
import { decideCleanup } from "@/lib/orphan-guard"

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
            this.listAllAssets()
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
                totalFiles: storageFiles.length,
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
    static async listAllAssets(prefix = ''): Promise<{ name: string }[]> {
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

        const files: { name: string }[] = []
        for (const entry of entries) {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name
            // A folder is an entry with no id. Recursing on it is what turns
            // this into a list of objects rather than a list of directories.
            if (entry.id === null || entry.id === undefined) {
                files.push(...await this.listAllAssets(path))
            } else {
                files.push({ name: path })
            }
        }
        return files
    }



    /**
     * Cleanup orphaned assets from Supabase storage.
     * This compares files in the 'app-assets' bucket against database records.
     */
    static async cleanupOrphanedAssets() {
        console.log("[Maintenance] Starting orphaned asset cleanup...")

        try {
            // 1. List all files in the bucket
            const allFiles = await this.listAllAssets()
            if (allFiles.length === 0) return { deleted: 0, total: 0 }
            const fileNames = allFiles.map(f => f.name)

            const activeFiles = new Set<string>()
            const BATCH_SIZE = 500

            // 2. Fetch all references from the DB using batches
            // Process Users
            let userSkip = 0
            while (true) {
                const users = await prisma.user.findMany({
                    where: { avatar: { not: null } },
                    select: { avatar: true },
                    skip: userSkip,
                    take: BATCH_SIZE
                })
                if (users.length === 0) break

                users.forEach(u => {
                    const parts = u.avatar?.split('/app-assets/')
                    if (parts && parts.length > 1) activeFiles.add(parts[1])
                })
                if (users.length < BATCH_SIZE) break
                userSkip += BATCH_SIZE
            }

            // Process Company logos. Every table whose rows point at this
            // bucket has to be represented here: a file this loop does not see
            // a reference to is deleted as an orphan, so adding a column that
            // stores a URL without adding it here is a delayed data loss.
            const companies = await prisma.company.findMany({
                where: { logoUrl: { not: null } },
                select: { logoUrl: true }
            })
            companies.forEach(c => {
                const parts = c.logoUrl?.split('/app-assets/')
                if (parts && parts.length > 1) activeFiles.add(parts[1])
            })

            // Process Tasks
            let taskSkip = 0
            while (true) {
                const tasks = await prisma.task.findMany({
                    where: { attachments: { not: Prisma.DbNull } },
                    select: { attachments: true },
                    skip: taskSkip,
                    take: BATCH_SIZE
                })
                if (tasks.length === 0) break

                tasks.forEach(t => {
                    // No JSON.parse needed (F-12: attachments is Json now) — a
                    // malformed row already became NULL at migration time, so
                    // anything reaching here is either an array or something
                    // the migration's quarantine didn't anticipate; the
                    // Array.isArray guard covers the latter case too.
                    if (Array.isArray(t.attachments)) {
                        t.attachments.forEach((a: any) => {
                            const parts = a.url?.split('/app-assets/')
                            if (parts && parts.length > 1) activeFiles.add(parts[1])
                        })
                    }
                })
                if (tasks.length < BATCH_SIZE) break
                taskSkip += BATCH_SIZE
            }

            // 3. Identify orphaned files
            const orphaned = fileNames.filter((name: string) => !activeFiles.has(name) && name !== '.emptyFolderPlaceholder')

            if (orphaned.length === 0) {
                console.log("[Maintenance] No orphaned assets found.")
                return { deleted: 0, total: fileNames.length }
            }

            // Refuse rather than delete when the result is implausible. A
            // genuine orphan is a leftover from a failed write or a deleted
            // row — a handful. A large fraction of the whole bucket means the
            // reference set above is missing a table, not that most of the
            // bucket is garbage.
            //
            // This is not hypothetical. As of writing, the queries above cover
            // User.avatar and Task.attachments and Company.logoUrl, and the
            // bucket also holds note attachments, obligation attachments and
            // the Excel templates — none of which are gathered. Against the
            // live bucket that is 101 of 106 objects. This refusal is the only
            // reason fixing listAllAssets above is not a data-loss bug.
            const decision = decideCleanup(orphaned.length, fileNames.length)
            if (!decision.proceed && decision.reason === 'implausible') {
                console.error(`[Maintenance] Refusing to delete ${orphaned.length} of ${fileNames.length} objects (${Math.round(decision.share * 100)}%) — the reference set is probably incomplete.`)
                const { AuditLogService } = await import("./audit-log.service")
                await AuditLogService.log('SYSTEM_CLEANUP', 'SYSTEM', 'MAINTENANCE', {
                    details: { refused: true, wouldHaveDeleted: orphaned.length, total: fileNames.length, reason: 'orphan share above threshold' }
                })
                return { deleted: 0, total: fileNames.length, refused: true, wouldHaveDeleted: orphaned.length }
            }

            // 4. Delete orphaned files
            console.log(`[Maintenance] Found ${orphaned.length} orphaned files. Deleting...`)
            const { error: deleteError } = await supabase.storage.from('app-assets').remove(orphaned)
            if (deleteError) throw deleteError

            // 5. Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('SYSTEM_CLEANUP', 'SYSTEM', 'MAINTENANCE', {
                details: { deletedFiles: orphaned.length, filenames: orphaned }
            })

            console.log(`[Maintenance] Cleanup finished. Deleted ${orphaned.length} files.`)
            return { deleted: orphaned.length, total: fileNames.length }
        } catch (error) {
            console.error("[Maintenance] Cleanup failed:", error)
            throw error
        }
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
