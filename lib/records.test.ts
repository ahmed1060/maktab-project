import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { addDays, daysBetween, EXPIRES_SOON_DAYS, expiryDay, expiryRange, expiryState, parseExpiryDay } from "./record-expiry"
import { ownFilePath, parseRecordFiles, storeRecordFiles } from "./record-files"
import { createRecordSchema, updateRecordSchema, RECORD_TEXT_MAX } from "./validations/record.schema"
import { personName } from "@/components/records/types"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * A client's records (CLIENTS_PLAN.md §0.2): when one has expired or expires
 * soon, which files it may carry, and what a new or edited one must say.
 */

describe("a record's expiry", () => {
    const today = "2026-10-16"

    it("is a calendar day, stored as its UTC midnight", () => {
        expect(parseExpiryDay("2026-10-20")!.toISOString()).toBe("2026-10-20T00:00:00.000Z")
        expect(expiryDay(parseExpiryDay("2026-10-20")!)).toBe("2026-10-20")
        // Not a day anybody chose: rolled over, or not a date at all.
        for (const bad of ["2026-02-30", "2026-13-01", "20-10-2026", "2026-10-16T00:00", ""]) expect(parseExpiryDay(bad), bad).toBeNull()
    })

    it("has expired once its day has passed, and not on the day itself", () => {
        expect(expiryState("2026-10-15", today)).toBe("expired")
        expect(expiryState("2026-10-16", today)).toBe("soon")
    })

    it("expires soon from 30 days before, up to and including the day", () => {
        expect(EXPIRES_SOON_DAYS).toBe(30)
        expect(expiryState(addDays(today, 30), today)).toBe("soon")
        expect(expiryState(addDays(today, 31), today)).toBeNull()
        expect(expiryState(null, today)).toBeNull()
    })

    it("filters exactly the records the badge marks", () => {
        // Every day from 40 before to 40 after: in the filter's range exactly when the badge says so.
        for (let d = -40; d <= 40; d++) {
            const day = addDays(today, d)
            const at = parseExpiryDay(day)!
            for (const state of ["soon", "expired"] as const) {
                const { gte, lt } = expiryRange(state, today)
                const inRange = (!gte || at >= gte) && at < lt
                expect(inRange, `${state} ${day}`).toBe(expiryState(day, today) === state)
            }
        }
    })

    it("counts the days left for a reminder, across a month's end", () => {
        expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3)
        expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
        expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
    })
})

describe("a record's files", () => {
    const BUCKET = "https://abc.supabase.co/storage/v1/object/public/app-assets"
    afterEach(() => { delete process.env.NEXT_PUBLIC_SUPABASE_URL })

    it("read the same from each shape the old Clients section stored", () => {
        const file = { url: `${BUCKET}/c1/notes/a.pdf`, name: "a.pdf", size: 10, type: "application/pdf" }
        expect(parseRecordFiles(JSON.stringify([file]))).toEqual([file])
        expect(parseRecordFiles(JSON.stringify([file.url]))).toEqual([{ url: file.url, name: "a.pdf", size: 0 }])
        expect(parseRecordFiles(JSON.stringify(file))).toEqual([file])
        expect(parseRecordFiles(file.url)).toEqual([{ url: file.url, name: "a.pdf", size: 0 }])
        expect(parseRecordFiles(null)).toEqual([])
        expect(parseRecordFiles("[null, 3, {}]")).toEqual([])
        expect(storeRecordFiles([])).toBeNull()
    })

    it("are only records' files uploaded here, for the record's company or by a Super Admin", () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co"
        expect(ownFilePath(`${BUCKET}/c1/records/1-a.pdf`, "c1")).toBe("c1/records/1-a.pdf")
        expect(ownFilePath(`${BUCKET}/platform/records/1-a.pdf`, "c1")).toBe("platform/records/1-a.pdf")
        for (const url of [
            `${BUCKET}/c2/records/1-a.pdf`,                              // another company's
            `${BUCKET}/c1/avatars/1-a.png`,                              // the company's other files
            `${BUCKET}/c1/misc/logo.png`,
            `${BUCKET}/c1/1-a.pdf`,
            `${BUCKET}/c1/records/old/1-a.pdf`,
            `${BUCKET}/c1/records/`,
            "https://evil.example/storage/v1/object/public/app-assets/c1/a.pdf", // another host
            `${BUCKET}/c1/records/a.pdf?download=1`,
            `${BUCKET}/c1/../c2/a.pdf`,
            `${BUCKET}/c1`,
            "javascript:alert(1)",
            `http://abc.supabase.co/storage/v1/object/public/app-assets/c1/a.pdf`,
            `${BUCKET}/c1/%E0%A4%A.pdf`,
            "not a url",
        ]) expect(ownFilePath(url, "c1"), url).toBeNull()
    })
})

describe("a new or edited record", () => {
    const base = { content: "Licence 2026", sectionId: "s1" }

    it("needs its text, and a section: one there, or a new one's name", () => {
        expect(createRecordSchema.safeParse(base).success).toBe(true)
        expect(createRecordSchema.safeParse({ content: "x", vendorId: "v1", sectionTitle: "Licences" }).success).toBe(true)
        expect(createRecordSchema.safeParse({ ...base, content: "   " }).success).toBe(false)
        expect(createRecordSchema.safeParse({ ...base, content: "x".repeat(RECORD_TEXT_MAX + 1) }).success).toBe(false)
        expect(createRecordSchema.safeParse({ content: "x" }).success).toBe(false)
        expect(createRecordSchema.safeParse({ content: "x", vendorId: "v1" }).success).toBe(false)
        expect(createRecordSchema.safeParse({ ...base, vendorId: "v1", sectionTitle: "Both" }).success).toBe(false)
    })

    it("reminds only with a real expiry date to count back from, and at most a year ahead", () => {
        expect(createRecordSchema.safeParse({ ...base, expiryDate: "2026-11-01", reminderDays: 7 }).success).toBe(true)
        expect(createRecordSchema.safeParse({ ...base, reminderDays: 7 }).success).toBe(false)
        expect(createRecordSchema.safeParse({ ...base, expiryDate: "2026-02-30" }).success).toBe(false)
        expect(createRecordSchema.safeParse({ ...base, expiryDate: "2026-11-01", reminderDays: 0 }).success).toBe(false)
        expect(createRecordSchema.safeParse({ ...base, expiryDate: "2026-11-01", reminderDays: 366 }).success).toBe(false)
        expect(updateRecordSchema.safeParse({ id: "r1", content: "x", reminderDays: 3 }).success).toBe(false)
    })

    it("carries at most 10 files, each at most 4 MB", () => {
        const file = (n: number) => ({ url: `https://x/${n}.pdf`, name: `${n}.pdf`, size: 100 })
        expect(createRecordSchema.safeParse({ ...base, files: Array.from({ length: 10 }, (_, i) => file(i)) }).success).toBe(true)
        expect(createRecordSchema.safeParse({ ...base, files: Array.from({ length: 11 }, (_, i) => file(i)) }).success).toBe(false)
        expect(createRecordSchema.safeParse({ ...base, files: [{ ...file(1), size: 4 * 1024 * 1024 + 1 }] }).success).toBe(false)
    })
})

describe("a record's form", () => {
    const FORM = readFileSync("components/records/RecordForm.tsx", "utf8")

    it("says which files the record had when it opened, so the server can refuse it if someone changed them since", () => {
        expect(FORM).toContain("filesBefore: record!.files.map(f => f.url)")
        expect(updateRecordSchema.safeParse({ id: "r1", content: "x", files: [] }).success).toBe(false)
        expect(updateRecordSchema.safeParse({ id: "r1", content: "x", files: [], filesBefore: [] }).success).toBe(true)
    })

    it("keeps each file it uploads, so a failed save doesn't upload it again", () => {
        expect(FORM).toContain("const done = await upload(file)")
        expect(FORM).toContain("setKept(files)")
        expect(FORM).toContain("setPicked(p => p.filter(f => f !== file))")
    })

    it("removes what it uploaded again if it closes without saving it, or saves without it", () => {
        expect(FORM).toContain("unsaved.current.push(done.url)")
        expect(FORM).toContain("if (!inFlight.current) discard(list.splice(0))")
        expect(FORM).toContain("discard(unsaved.current.splice(0).filter(url => !saved.has(url)))")
        expect(FORM).toContain("fetch('/api/records/uploads', {")
    })

    it("closed while a save is on its way, leaves that save's files to it: kept if it saves, removed if not", () => {
        // Removing them as the form closes would take the files out from under a save that then stores them.
        expect(FORM).not.toContain("return () => discard(list.splice(0))")
        expect(FORM).toContain("inFlight.current = true")
        expect(FORM).toMatch(/finally \{\s*inFlight\.current = false\s*\/\/[^\n]*\n\s*if \(closed\.current\) discard\(unsaved\.current\.splice\(0\)\)/)
    })
})

describe("a record a reminder links to", () => {
    const LIST = readFileSync("components/records/RecordsList.tsx", "utf8")

    it("opens on its own client's page only, not over another client's records", () => {
        expect(LIST).toContain("if (body?.data && (!vendorId || body.data.client.id === vendorId)) setViewing(body.data)")
        expect(LIST).not.toContain("if (body?.data) setViewing(body.data)")
    })
})

describe("who added or edited a record", () => {
    const t = (key: "role_super_admin" | "records_deleted_user") => en[key]

    it("is their name, or a Super Admin, or a user since deleted, never mistaken for each other", () => {
        expect(personName({ firstName: "Mona", lastName: "Fahmy" }, false, t)).toBe("Mona Fahmy")
        expect(personName(null, true, t)).toBe("Super Admin")
        expect(personName(null, false, t)).toBe("Deleted user")
        expect(ar.records_deleted_user).toBe("مستخدم محذوف")
    })
})
