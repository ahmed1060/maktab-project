import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { JobHeartbeatService } from "@/lib/services/job-heartbeat.service"
import { GDriveService } from "@/lib/services/gdrive.service"

/** Older than this and the newest backup is stale. A nightly job plus Vercel's
 *  cron window plus a slow run still lands inside a day and a bit. */
const BACKUP_STALE_AFTER_HOURS = 30

/**
 * What the System Health page needs to say whether the machinery is alive.
 *
 * Two questions in one response because they are one card, and because the
 * backup is the reason the card exists: it failed every night from 11 to 17
 * September and nothing inside the product knew. The failure emails arrived
 * daily and went unread, which is a property of the channel rather than of
 * anyone reading it — a message that says the same thing every morning stops
 * being a message.
 *
 * The backup half distinguishes two reds that need different sentences. "No
 * recent backup" and "cannot reach Drive" are different failures, and for a
 * week the true one was the second: the backup was stale *and* the product
 * could no longer ask. A card that only knew how to say "stale" would have
 * understated it.
 */
export const GET = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    const jobs = await JobHeartbeatService.list()

    // Never fatal: the jobs half of the card must still render when Drive is
    // unreachable, which is precisely the state this is built to surface.
    let backup: {
        reachable: boolean
        error: string | null
        newestAt: string | null
        newestName: string | null
        ageHours: number | null
        stale: boolean
    } = { reachable: false, error: null, newestAt: null, newestName: null, ageHours: null, stale: true }

    try {
        const backups = await GDriveService.listBackups()
        const newest = backups
            .slice()
            .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())[0]

        if (!newest) {
            backup = { ...backup, reachable: true, error: 'NO_BACKUPS' }
        } else {
            const ageHours = (Date.now() - new Date(newest.modifiedTime).getTime()) / 36e5
            backup = {
                reachable: true,
                error: null,
                newestAt: newest.modifiedTime,
                newestName: newest.baseName,
                ageHours: Math.round(ageHours * 10) / 10,
                stale: ageHours > BACKUP_STALE_AFTER_HOURS,
            }
        }
    } catch (error: any) {
        // The three GDriveService raises, kept as codes rather than prose so
        // the page can translate them.
        backup = { ...backup, reachable: false, error: error?.message ?? 'GDRIVE_LIST_FAILED' }
    }

    return ApiResponse.success({ jobs, backup, staleAfterHours: BACKUP_STALE_AFTER_HOURS })
}, {
    rateLimit: { maxRequests: 30, windowMs: 60_000 },
})
