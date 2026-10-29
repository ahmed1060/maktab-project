/**
 * The files attached to a record (CLIENTS_PLAN.md §0.2).
 *
 * Stored as a JSON string in ClientNote.attachment. The old Clients section
 * wrote three shapes there over time: a list of { url, name, size, type }, a
 * list of bare URLs, and a single URL. All three read the same way here.
 */

export type RecordFile = { url: string; name: string; size: number; type?: string; uploadedAt?: string }

/** At most this many files on one record. */
export const RECORD_FILES_MAX = 10

/** The largest file the upload route takes (app/api/upload/route.ts). */
export const RECORD_FILE_MAX_BYTES = 4 * 1024 * 1024

/** What a file picker offers: what the upload route takes. */
export const RECORD_FILE_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"

function nameOf(url: string): string {
    const last = url.split("?")[0].split("/").pop() || ""
    try {
        return decodeURIComponent(last) || "File"
    } catch {
        return last || "File"
    }
}

function one(item: unknown): RecordFile | null {
    if (typeof item === "string") return item ? { url: item, name: nameOf(item), size: 0 } : null
    if (!item || typeof item !== "object") return null
    const o = item as Record<string, unknown>
    if (typeof o.url !== "string" || !o.url) return null
    return {
        url: o.url,
        name: typeof o.name === "string" && o.name ? o.name : nameOf(o.url),
        size: typeof o.size === "number" && o.size >= 0 ? o.size : 0,
        ...(typeof o.type === "string" ? { type: o.type } : {}),
        ...(typeof o.uploadedAt === "string" ? { uploadedAt: o.uploadedAt } : {}),
    }
}

/** A record's files, from whatever shape the column holds. */
export function parseRecordFiles(stored: string | null | undefined): RecordFile[] {
    if (!stored) return []
    let parsed: unknown
    try {
        parsed = JSON.parse(stored)
    } catch {
        return stored.startsWith("http") ? [one(stored)!] : []
    }
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list.map(one).filter((f): f is RecordFile => f !== null)
}

/** What the column stores for a record's files: null for none. */
export function storeRecordFiles(files: readonly RecordFile[]): string | null {
    return files.length ? JSON.stringify(files) : null
}

const BUCKET = "/storage/v1/object/public/app-assets/"

/** Whether a URL is on the storage's own address, when the address is known. */
function sameOrigin(url: URL, storage: string | undefined): boolean {
    if (!storage) return true
    try {
        return url.origin === new URL(storage).origin
    } catch {
        return false
    }
}

/** The upload route's folder for records' files (RecordForm). */
export const RECORD_FILES_FOLDER = "records"

/**
 * The file's path in the bucket, if it's a record's file uploaded here for
 * this company: the upload route puts a company's files under its own
 * folder, and a Super Admin's under "platform", in the folder the form
 * names. Anything else, such as a link to another site, another company's
 * file, or one of the company's other files like a photo or its logo, isn't
 * a record's file, so a record can neither carry it nor delete it. Another
 * folder's files, such as a cost's receipts, are checked as theirs.
 */
export function ownFilePath(url: string, companyId: string, folderName: string = RECORD_FILES_FOLDER): string | null {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return null
    }
    if (parsed.protocol !== "https:" || parsed.search || parsed.hash) return null
    if (!sameOrigin(parsed, process.env.NEXT_PUBLIC_SUPABASE_URL)) return null
    if (!parsed.pathname.startsWith(BUCKET)) return null
    let path: string
    try {
        path = decodeURIComponent(parsed.pathname.slice(BUCKET.length))
    } catch {
        return null
    }
    const [owner, folder, name, ...more] = path.split("/")
    if (folder !== folderName || !name || more.length || path.includes("..")) return null
    return owner === companyId || owner === "platform" ? path : null
}

/** "2.4 MB", in the page's language. */
export function fileSize(bytes: number, locale: string): string {
    const nf = (n: number, digits: number) => n.toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { maximumFractionDigits: digits })
    if (bytes >= 1024 * 1024) return `${nf(bytes / (1024 * 1024), 1)} MB`
    if (bytes >= 1024) return `${nf(bytes / 1024, 0)} KB`
    return `${nf(bytes, 0)} B`
}
