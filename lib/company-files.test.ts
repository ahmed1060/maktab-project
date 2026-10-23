import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Deleting a company removes everything it stored (CLIENTS_PLAN.md change
 * log, 2026-10-17): its records' files were removed, but its logo, its
 * people's photos and their uploads, all under the folder named by its id,
 * stayed in storage for good.
 *
 * The bucket below lists one level at a time, folders as entries with no
 * id, as Supabase's does, and refuses more than 100 keys in one removal.
 */

const bucket = new Set<string>()
const state = { refuse: false }
/** What live rows still use, as stored: public URLs into the bucket. */
const live = { avatars: [] as string[] }
/**
 * People, as Postgres keeps them: in the order they were written, which a
 * query without an order may return. `whilePaging` runs once, after the first
 * page is read, as a change made meanwhile would.
 */
const people = { rows: [] as { id: string; avatar: string }[], whilePaging: null as null | (() => void) }
const url = (path: string) => `https://nizmo.supabase.co/storage/v1/object/public/app-assets/${path}`
vi.mock("@/lib/storage", () => ({
    supabase: {
        storage: {
            from: () => ({
                list: async (prefix: string, { limit, offset }: { limit: number; offset: number }) => {
                    const under = [...bucket].filter(p => !prefix || p.startsWith(`${prefix}/`)).map(p => (prefix ? p.slice(prefix.length + 1) : p))
                    const names = [...new Set(under.map(rest => rest.split("/")[0]))].sort()
                    const entries = names.map(name => (under.includes(name) ? { name, id: `id-${name}`, metadata: { size: 1 } } : { name, id: null }))
                    return { data: entries.slice(offset, offset + limit), error: null }
                },
                remove: async (paths: string[]) => {
                    if (paths.length > 100) return { data: null, error: { message: "Too many keys" } }
                    if (state.refuse) return { data: null, error: { message: "Service unavailable" } }
                    paths.forEach(p => bucket.delete(p))
                    return { data: [], error: null }
                },
            }),
        },
    },
    uploadToCloud: async () => { throw new Error("no uploads here") },
}))
vi.mock("@/lib/step-up", () => ({ assertRecentStepUp: async () => {}, assertStepUp: async () => {} }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {} } }))
vi.mock("@/lib/services/record.service", () => ({ RecordService: { filesOfCompany: async () => [], removeUnused: async () => {} } }))
vi.mock("@/lib/prisma", () => {
    const tx = { company: { delete: async ({ where }: any) => ({ id: where.id, name: "Acme" }) } }
    // Rows left once the company is gone: only people's photos refer to anything here.
    const none = { findMany: async () => [] }
    return { prisma: {
        company: { findUnique: async ({ where }: any) => ({ id: where.id, name: "Acme", users: [] }), findMany: async () => [] },
        user: {
            findMany: async ({ where, skip = 0, take, orderBy }: any) => {
                let rows = [...people.rows, ...live.avatars.map((avatar, i) => ({ id: `live-${i}`, avatar }))]
                if (where?.id?.gt) rows = rows.filter(r => r.id > where.id.gt)
                if (orderBy?.id === "asc") rows.sort((a, b) => (a.id < b.id ? -1 : 1))
                const page = rows.slice(skip, skip + (take ?? rows.length))
                const change = people.whilePaging
                people.whilePaging = null
                change?.()
                return page
            },
        },
        task: none, obligation: none, clientRecord: none, superAdmin: none,
        $transaction: async (fn: any) => fn(tx),
    } }
})

const STORED = [
    "c1/logos/1-logo.png",
    "c1/avatars/2-face.png",
    "c1/tasks/3-receipt.pdf",
    ...Array.from({ length: 150 }, (_, i) => `c1/misc/${i}.pdf`),
    "c2/logos/1-logo.png",
    "c2/avatars/2-face.png",
    "templates/template_en.xlsx",
    "platform/records/1-guide.pdf",
]
const session = { user: { id: "sa1", role: "SUPER_ADMIN" } }

beforeEach(() => {
    bucket.clear()
    STORED.forEach(p => bucket.add(p))
    state.refuse = false
    live.avatars = []
    people.rows = []
    people.whilePaging = null
})

describe("deleting a company", () => {
    it("removes everything it stored, and nothing anyone else did", async () => {
        const { CompanyService } = await import("@/lib/services/company.service")
        await CompanyService.delete("c1", session)
        expect([...bucket].sort()).toEqual(["c2/avatars/2-face.png", "c2/logos/1-logo.png", "platform/records/1-guide.pdf", "templates/template_en.xlsx"])
    })

    it("keeps a file a live row still uses: the photo of someone moved to another company", async () => {
        // A Super Admin can move a person to another company; their photo stays where they uploaded it.
        live.avatars = ["https://nizmo.supabase.co/storage/v1/object/public/app-assets/c1/avatars/2-face.png"]
        const { CompanyService } = await import("@/lib/services/company.service")
        await CompanyService.delete("c1", session)
        expect([...bucket].filter(p => p.startsWith("c1/"))).toEqual(["c1/avatars/2-face.png"])
    })

    it("keeps a photo in use when someone else is deleted while the references are read", async () => {
        // 600 people with photos elsewhere, and the one moved from c1 first on the second page of 500.
        people.rows = Array.from({ length: 600 }, (_, i) => ({ id: `p${String(i).padStart(4, "0")}`, avatar: url(`c2/avatars/${i}.png`) }))
        people.rows[500].avatar = url("c1/avatars/2-face.png")
        // An earlier person deleted after the first page: an offset would step past one row (Codex on #89).
        people.whilePaging = () => { people.rows.shift() }
        const { CompanyService } = await import("@/lib/services/company.service")
        await CompanyService.delete("c1", session)
        expect([...bucket].filter(p => p.startsWith("c1/"))).toEqual(["c1/avatars/2-face.png"])
    })

    it("is still done when storage refuses, which is logged", async () => {
        state.refuse = true
        const logged = vi.spyOn(console, "error").mockImplementation(() => {})
        try {
            const { CompanyService } = await import("@/lib/services/company.service")
            await expect(CompanyService.delete("c1", session)).resolves.toMatchObject({ id: "c1" })
            expect(logged).toHaveBeenCalledWith("[COMPANY_DELETE] Removing the company's files failed", expect.objectContaining({ companyId: "c1" }))
        } finally {
            logged.mockRestore()
        }
    })
})

describe("removing a folder", () => {
    it("takes only one company's folder: never the whole bucket, a path, or the platform's own", async () => {
        const { MaintenanceService } = await import("@/lib/services/maintenance.service")
        for (const folder of ["", "c1/avatars", "../c2", "c1 ", "platform", "templates", "avatars"]) {
            await expect(MaintenanceService.removeFolder(folder)).rejects.toThrow("FOLDER_INVALID")
        }
        expect(bucket.size).toBe(STORED.length)
        expect(await MaintenanceService.removeFolder("c2")).toEqual({ removed: 2 })
    })
})
