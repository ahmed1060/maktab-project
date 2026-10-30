import { supabase } from "@/lib/storage"
import { ownFilePath } from "@/lib/record-files"
import { RECEIPTS_FOLDER } from "@/lib/task-costs"

/**
 * Costs' receipt photos (CLIENTS_PLAN.md §6.2): each a file uploaded to its
 * company's receipts folder, or a Super Admin's, and on one cost only, which
 * TaskCost's unique receiptUrl holds to.
 */

/** Where a receipt is in the bucket, if it's one of this company's, or a Super Admin's. */
function receiptPath(url: string, companyId: string | null, folder: string = RECEIPTS_FOLDER): string | null {
    return ownFilePath(url, companyId ?? "platform", folder)
}

/**
 * The address the upload gave for this path: one spelling for each file, so
 * no file is on two costs under two spellings, and goes from storage with
 * either.
 */
function uploadedAddress(url: string, path: string): string {
    return `${new URL(url).origin}/storage/v1/object/public/app-assets/${encodeURI(path)}`
}

/**
 * Refuses receipts that aren't files uploaded here for this company's costs:
 * a link to anywhere else, another company's file, one of the company's
 * other files, a Super Admin's sent by anyone else, one spelt otherwise than
 * the upload gave it, one no longer stored, or one sent for two costs.
 */
export async function checkReceipts(urls: readonly string[], companyId: string | null, superAdmin: boolean): Promise<void> {
    if (!(await uploadedHere(urls, companyId, superAdmin, RECEIPTS_FOLDER))) throw new Error("COST_RECEIPT_INVALID")
}

/**
 * Whether these are files uploaded here, to this company's folder of this
 * name, as checkReceipts asks of receipts: each spelt as the upload gave it,
 * still stored, and none twice. Also a cash advance's hand-over photo
 * (CLIENTS_PLAN.md §7.3).
 */
export async function uploadedHere(urls: readonly string[], companyId: string | null, superAdmin: boolean, folder: string): Promise<boolean> {
    if (!urls.length) return true
    const paths = urls.map(url => receiptPath(url, companyId, folder))
    if (paths.some((path, i) => !path || (path.startsWith("platform/") && !superAdmin) || uploadedAddress(urls[i], path) !== urls[i])) return false
    if (new Set(paths).size !== paths.length) return false
    if (!supabase) return true
    const storage = supabase.storage.from("app-assets")
    const stored = await Promise.all(paths.map(async path => (await storage.exists(path!)).data))
    return stored.every(found => found)
}

/**
 * Removes receipts from storage once their costs are gone. Best effort, as a
 * task's photos are: one storage refuses is left for the orphan sweep.
 */
export async function removeReceipts(urls: readonly (string | null)[], companyId: string | null): Promise<void> {
    const paths = urls.map(url => url ? receiptPath(url, companyId) : null).filter((path): path is string => !!path)
    if (!paths.length || !supabase) return
    try {
        // A refused removal comes back as an error, not thrown.
        const { error } = await supabase.storage.from("app-assets").remove(paths)
        if (error) throw error
    } catch (error) {
        console.error("Cost receipt cleanup failed:", error)
    }
}
