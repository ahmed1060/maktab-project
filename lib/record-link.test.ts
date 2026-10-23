import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A record's own address, the link in its reminder (Codex on #82): a record
 * that's gone or not theirs is "not found", but a failure to look it up,
 * such as the database being down, is an error, not a missing page.
 */

const NOT_FOUND = new Error("NEXT_NOT_FOUND")
let lookup: () => Promise<unknown> = async () => ({})

vi.mock("next/navigation", () => ({
    notFound: () => { throw NOT_FOUND },
    redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "a1", role: "ADMIN", companyId: "c1" } }) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/services/record.service", () => ({ RecordService: { get: () => lookup() } }))

const { default: RecordLink } = await import("@/app/(dashboard)/dashboard/records/[id]/page")
const open = () => RecordLink({ params: Promise.resolve({ id: "r1" }) })

beforeEach(() => { lookup = async () => ({}) })

describe("a reminder's link to a record", () => {
    it("opens the record on its client's page", async () => {
        lookup = async () => ({ client: { id: "v1" } })
        await expect(open()).rejects.toThrow("REDIRECT /dashboard/vendors/v1?record=r1")
    })

    it("is not found when the record is gone, or not theirs to see", async () => {
        for (const code of ["RECORD_NOT_FOUND", "RECORD_FORBIDDEN"]) {
            lookup = async () => { throw new Error(code) }
            await expect(open()).rejects.toBe(NOT_FOUND)
        }
    })

    it("is an error, not a missing page, when looking it up fails", async () => {
        lookup = async () => { throw new Error("Can't reach database server") }
        await expect(open()).rejects.toThrow("Can't reach database server")
    })
})
