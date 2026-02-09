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
            // 1. List all files in the bucket (flat structure)
            const { data: files, error } = await supabase.storage.from('app-assets').list('', { limit: 1000 })
            if (error) throw error
            if (!files || files.length === 0) return { deleted: 0, total: 0 }

            const fileNames = files.map((f: { name: string }) => f.name)

            // 2. Fetch all references from the DB
            // We need to check: User.avatar, and Task.attachments (JSON string)
            const [users, tasks] = await Promise.all([
                prisma.user.findMany({ where: { avatar: { not: null } }, select: { avatar: true } }),
                prisma.task.findMany({ where: { attachments: { not: null } }, select: { attachments: true } })
            ])

            const activeFiles = new Set<string>()

            // Extract from users
            users.forEach(u => {
                const parts = u.avatar?.split('/app-assets/')
                if (parts && parts.length > 1) activeFiles.add(parts[1])
            })

            // Extract from tasks
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

            // 5. Audit Log (System)
            await prisma.auditLog.create({
                data: {
                    action: 'SYSTEM_CLEANUP',
                    entityType: 'SYSTEM',
                    entityId: 'MAINTENANCE',
                    details: JSON.stringify({ deletedFiles: orphaned.length, filenames: orphaned })
                }
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
            await prisma.auditLog.create({
                data: {
                    action: 'SYSTEM_PRUNE_LOGS',
                    entityType: 'SYSTEM',
                    entityId: 'MAINTENANCE',
                    details: JSON.stringify({ deletedCount: result.count, retentionDays })
                }
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
            await prisma.auditLog.create({
                data: {
                    action: 'SYSTEM_PRUNE_NOTIFICATIONS',
                    entityType: 'SYSTEM',
                    entityId: 'MAINTENANCE',
                    details: JSON.stringify({ deletedCount: result.count, retentionDays })
                }
            })
        }

        console.log(`[Maintenance] Pruned ${result.count} notifications.`)
        return result.count
    }
}
