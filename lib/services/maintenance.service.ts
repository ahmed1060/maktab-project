import { prisma } from "@/lib/prisma"
import { supabase } from "@/lib/storage"

export class MaintenanceService {
    /**
     * Cleanup orphaned assets from Supabase storage.
     * This compares files in the 'app-assets' bucket against database records.
     */
    static async cleanupOrphanedAssets() {
        console.log("[Maintenance] Starting orphaned asset cleanup...")

        try {
            // 1. List all files in the bucket (with pagination support)
            let allFiles: { name: string }[] = []
            let offset = 0
            const LIMIT = 1000

            while (true) {
                const { data: batch, error } = await supabase.storage.from('app-assets').list('', { limit: LIMIT, offset })
                if (error) throw error
                if (!batch || batch.length === 0) break

                allFiles = allFiles.concat(batch)
                if (batch.length < LIMIT) break
                offset += LIMIT
            }

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

            // Process Tasks
            let taskSkip = 0
            while (true) {
                const tasks = await prisma.task.findMany({
                    where: { attachments: { not: null } },
                    select: { attachments: true },
                    skip: taskSkip,
                    take: BATCH_SIZE
                })
                if (tasks.length === 0) break

                tasks.forEach(t => {
                    try {
                        const attachments = JSON.parse(t.attachments!)
                        if (Array.isArray(attachments)) {
                            attachments.forEach((a: any) => {
                                const parts = a.url?.split('/app-assets/')
                                if (parts && parts.length > 1) activeFiles.add(parts[1])
                            })
                        }
                    } catch {
                        console.log("[Maintenance] Skipping malformed JSON in task attachments")
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
