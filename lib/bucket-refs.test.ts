import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { FOLDER_PLACEHOLDER, RESERVED_PATHS, extractBucketPaths, isSweepable } from "./bucket-refs"

const BASE = "https://vfgemjpipkuhgbsqjvdz.supabase.co/storage/v1/object/public/app-assets/"

// The three paths actually referenced in production when the reference set was
// audited, one per encoding, each verified against storage.objects to match a
// real object exactly. They are the fixtures because they are the evidence.
const AVATAR = "avatars/1768970955019-8pz2mm.jpeg"
const TASK_FILE = "d9790ec4-0a73-4a27-858b-3003032c5cf3/misc/1788713706536-g3orvn.PNG"
const OBLIGATION_FILE = "d9790ec4-0a73-4a27-858b-3003032c5cf3/misc/1788714774803-qsunum.PNG"

describe("the five encodings these six columns actually use", () => {
    it("a bare URL — User.avatar, SuperAdmin.avatar, Company.logoUrl", () => {
        expect(extractBucketPaths(BASE + AVATAR)).toEqual([AVATAR])
    })

    it("real Json — Task.attachments", () => {
        // Passed as the parsed value Prisma hands back, not as text.
        const attachments = [
            { url: BASE + TASK_FILE, name: "shot.PNG" },
            { url: BASE + AVATAR, name: "other.jpeg" },
        ]
        expect(extractBucketPaths(attachments)).toEqual([TASK_FILE, AVATAR])
    })

    it("a JSON string — Obligation.attachments", () => {
        const stored = JSON.stringify([{ url: BASE + OBLIGATION_FILE }])
        expect(extractBucketPaths(stored)).toEqual([OBLIGATION_FILE])
    })

    it("a JSON string of bare strings — one of ClientNote.attachment's shapes", () => {
        expect(extractBucketPaths(JSON.stringify([BASE + AVATAR]))).toEqual([AVATAR])
    })

    it("a single JSON object, and a bare URL — ClientNote.attachment's other two", () => {
        // Its own delete path parses, falls back to treating the whole column as
        // one URL in a catch, and handles array-or-single. Three shapes in one
        // column is why nothing here parses.
        expect(extractBucketPaths(JSON.stringify({ url: BASE + AVATAR }))).toEqual([AVATAR])
        expect(extractBucketPaths(BASE + AVATAR)).toEqual([AVATAR])
    })
})

describe("what it must never do — miss a reference", () => {
    it("finds every path in a value, not just the first", () => {
        // A task with four attachments must protect four files. Stopping at one
        // deletes the rest.
        const many = [1, 2, 3, 4].map(n => ({ url: `${BASE}misc/file-${n}.png` }))
        expect(extractBucketPaths(many)).toEqual([
            "misc/file-1.png", "misc/file-2.png", "misc/file-3.png", "misc/file-4.png",
        ])
    })

    it("keeps the whole path, including the company-scoped prefix", () => {
        // Two layouts coexist in this bucket: the legacy "avatars/x" and the
        // scoped "<companyId>/misc/x". Truncating at the first slash would make
        // every scoped file look orphaned.
        expect(extractBucketPaths(BASE + TASK_FILE)[0]).toBe(TASK_FILE)
        expect(extractBucketPaths(BASE + TASK_FILE)[0].split("/")).toHaveLength(3)
    })

    it("survives escaped quotes around a JSON-in-JSON value", () => {
        // Obligation.attachments is a JSON string; nested inside another payload
        // its quotes arrive backslash-escaped.
        const nested = JSON.stringify(JSON.stringify([{ url: BASE + OBLIGATION_FILE }]))
        expect(extractBucketPaths(nested)).toEqual([OBLIGATION_FILE])
    })

    it("reads an uppercase extension as written", () => {
        // Both real task files in production are .PNG. A case-folding step here
        // would produce a path that matches no object.
        expect(extractBucketPaths(BASE + "misc/a.PNG")).toEqual(["misc/a.PNG"])
    })
})

describe("what it returns nothing for", () => {
    it("is quiet on values that hold no bucket path", () => {
        for (const value of [null, undefined, "", "no urls here", 42, {}, [], "https://example.com/x.png"]) {
            expect(extractBucketPaths(value), JSON.stringify(value)).toEqual([])
        }
    })

    it("does not invent a path from the marker alone", () => {
        expect(extractBucketPaths(BASE)).toEqual([])
        expect(extractBucketPaths(`"${BASE}"`)).toEqual([])
    })
})

describe("objects the sweep leaves alone before any reference is checked", () => {
    it("spares the Excel templates, which no row refers to", () => {
        // Addressed by a fixed path in lib/storage.ts. To a reference-counting
        // sweep they are indistinguishable from an orphan.
        for (const path of RESERVED_PATHS) {
            expect(isSweepable(path), path).toBe(false)
        }
        expect(RESERVED_PATHS).toContain("templates/template_en.xlsx")
        expect(RESERVED_PATHS).toContain("templates/template_ar.xlsx")
    })

    it("spares folder placeholders at any depth", () => {
        // The previous check was `name !== '.emptyFolderPlaceholder'`, an exact
        // match — which stopped working the moment the listing became recursive,
        // because the real ones are at "avatars/.emptyFolderPlaceholder".
        expect(isSweepable(FOLDER_PLACEHOLDER)).toBe(false)
        expect(isSweepable(`avatars/${FOLDER_PLACEHOLDER}`)).toBe(false)
        expect(isSweepable(`a/b/c/${FOLDER_PLACEHOLDER}`)).toBe(false)
    })

    it("sweeps an ordinary object", () => {
        expect(isSweepable(AVATAR)).toBe(true)
        expect(isSweepable(TASK_FILE)).toBe(true)
        expect(isSweepable("")).toBe(false)
    })
})

describe("the reference set covers every column that can hold a bucket path", () => {
    // The recurrence guard. A column added later that stores an uploaded file's
    // URL, without being gathered by collectReferencedPaths, means every file
    // that feature writes is deleted on the next sweep — and nothing in a
    // typecheck or a build notices. So the schema is read, not trusted to
    // memory.
    const schema = readFileSync("prisma/schema.prisma", "utf8")
    const service = readFileSync("lib/services/maintenance.service.ts", "utf8")

    // Fields whose name says they hold a file: avatar, anything ending in Url,
    // anything attachment-shaped. Nullable String or Json only.
    const candidates: { model: string; field: string }[] = []
    let model = ""
    for (const raw of schema.split("\n")) {
        const line = raw.trim()
        const declaration = /^model\s+(\w+)\s*\{/.exec(line)
        if (declaration) { model = declaration[1]; continue }
        if (line.startsWith("//") || !model) continue
        const field = /^(\w+)\s+(String|Json)\??/.exec(line)
        if (!field) continue
        if (/^avatar$|Url$|^attachment$|^attachments$/.test(field[1])) {
            candidates.push({ model, field: field[1] })
        }
    }

    it("finds the columns to check in the first place", () => {
        // If the heuristic above ever stops matching, this test would pass by
        // checking nothing at all.
        expect(candidates.length).toBeGreaterThanOrEqual(6)
    })

    it.each(candidates.map(c => [`${c.model}.${c.field}`, c.field]))(
        "%s is gathered",
        (_label, field) => {
            expect(service).toContain(`${field}:`)
        }
    )

    it("gathers all six known sources by name", () => {
        // A hard floor independent of the heuristic.
        for (const source of [
            "prisma.user.findMany",
            "prisma.superAdmin.findMany",
            "prisma.company.findMany",
            "prisma.task.findMany",
            "prisma.obligation.findMany",
            "prisma.clientRecord.findMany",
        ]) {
            expect(service, `${source} is not part of the reference set`).toContain(source)
        }
    })

    it("deliberately excludes AuditLog.details, and says so", () => {
        // It does contain bucket URLs — an avatar reset records the old one —
        // but as history. Counting it would mean no replaced file is ever
        // collectable. Documented rather than merely absent, so the next person
        // to notice it in a column scan does not "fix" it.
        expect(service).not.toContain("prisma.auditLog.findMany")
        expect(service).toContain("AuditLog.details is deliberately absent")
    })
})
