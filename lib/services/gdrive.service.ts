export type BackupFolder = 'daily' | 'weekly' | 'monthly'

export type BackupEntry = {
    folder: BackupFolder
    baseName: string
    sizeBytes: number
    modifiedTime: string
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'

/**
 * Lists the Google Drive backup folders directly, for the System Health
 * page's restore picker. Reuses the same OAuth app + refresh token
 * backup.yml's rclone remote already holds — duplicated here as Vercel env
 * vars specifically so this can run from a dashboard request, since rclone
 * itself isn't available in a Vercel serverless function.
 *
 * Read-only: this never touches the actual backup files, only lists them.
 */
export class GDriveService {
    private static async getAccessToken(): Promise<string> {
        const clientId = process.env.GDRIVE_CLIENT_ID
        const clientSecret = process.env.GDRIVE_CLIENT_SECRET
        const tokenJson = process.env.RCLONE_CONFIG_GDRIVE_TOKEN
        if (!clientId || !clientSecret || !tokenJson) {
            throw new Error('GDRIVE_NOT_CONFIGURED')
        }

        let refreshToken: string | undefined
        try {
            refreshToken = JSON.parse(tokenJson).refresh_token
        } catch {
            throw new Error('GDRIVE_NOT_CONFIGURED')
        }
        if (!refreshToken) throw new Error('GDRIVE_NOT_CONFIGURED')

        const res = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }),
        })
        if (!res.ok) {
            console.error('[GDriveService] Token refresh failed', res.status, await res.text().catch(() => ''))
            throw new Error('GDRIVE_AUTH_FAILED')
        }
        const data = await res.json()
        if (!data.access_token) {
            console.error('[GDriveService] Token refresh returned no access_token', JSON.stringify(data))
            throw new Error('GDRIVE_AUTH_FAILED')
        }
        return data.access_token as string
    }

    private static async findSubfolderId(accessToken: string, parentId: string, name: string): Promise<string | null> {
        const q = `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
        const url = `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
        if (!res.ok) {
            console.error('[GDriveService] Subfolder lookup failed', name, res.status, await res.text().catch(() => ''))
            throw new Error('GDRIVE_LIST_FAILED')
        }
        const data = await res.json()
        return data.files?.[0]?.id ?? null
    }

    private static async listFilesIn(accessToken: string, folderId: string) {
        const q = `'${folderId}' in parents and trashed = false`
        const url = `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name,size,createdTime,modifiedTime)&spaces=drive&pageSize=1000`
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
        if (!res.ok) {
            console.error('[GDriveService] File listing failed', folderId, res.status, await res.text().catch(() => ''))
            throw new Error('GDRIVE_LIST_FAILED')
        }
        const data = await res.json()
        return (data.files ?? []) as Array<{ id: string; name: string; size?: string; createdTime?: string; modifiedTime?: string }>
    }

    /**
     * Newest first. Each entry represents one backup run (from its
     * _db.sql.gz.age file) — the matching _assets.tar.gz.age is assumed to
     * sit alongside it, since backup.yml always uploads both together.
     */
    static async listBackups(): Promise<BackupEntry[]> {
        const rootId = process.env.GDRIVE_FOLDER_ID
        if (!rootId) throw new Error('GDRIVE_NOT_CONFIGURED')

        const accessToken = await this.getAccessToken()
        const folders: BackupFolder[] = ['daily', 'weekly', 'monthly']

        const entries: BackupEntry[] = []
        for (const folder of folders) {
            const folderId = await this.findSubfolderId(accessToken, rootId, folder)
            if (!folderId) continue // e.g. weekly/monthly before they've ever been created

            const files = await this.listFilesIn(accessToken, folderId)
            for (const file of files) {
                if (!file.name.endsWith('_db.sql.gz.age')) continue
                entries.push({
                    folder,
                    baseName: file.name.replace(/_db\.sql\.gz\.age$/, ''),
                    sizeBytes: Number(file.size || 0),
                    modifiedTime: file.modifiedTime || file.createdTime || '',
                })
            }
        }

        return entries.sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1))
    }
}
