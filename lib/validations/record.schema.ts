import { z } from "zod"
import { parseExpiryDay } from "@/lib/record-expiry"
import { RECORD_FILES_MAX, RECORD_FILE_MAX_BYTES } from "@/lib/record-files"

/** The longest a record's text may be. */
export const RECORD_TEXT_MAX = 1000
/** The longest a section's name may be. */
export const SECTION_TITLE_MAX = 100
/** The furthest ahead a reminder may be, in days. */
export const REMINDER_DAYS_MAX = 365

const id = z.string().trim().min(1).max(100)
const title = z.string().trim().min(1, "Give the section a name.").max(SECTION_TITLE_MAX)
const day = z.string().refine(v => parseExpiryDay(v) !== null, "That isn't a real date.")

const file = z.object({
    url: z.string().url().max(2000),
    name: z.string().trim().min(1).max(255),
    size: z.number().int().min(0).max(RECORD_FILE_MAX_BYTES),
    type: z.string().max(200).optional(),
    uploadedAt: z.string().max(40).optional(),
})

const content = {
    content: z.string().trim().min(1, "Write what the record says.").max(RECORD_TEXT_MAX),
    files: z.array(file).max(RECORD_FILES_MAX).default([]),
    expiryDate: day.nullable().default(null),
    reminderDays: z.number().int().min(1).max(REMINDER_DAYS_MAX).nullable().default(null),
}

// A reminder counts back from the expiry date, so it needs one.
const remindsOnlyWithExpiry = (r: { expiryDate: string | null; reminderDays: number | null }) => r.reminderDays === null || r.expiryDate !== null
const REMINDER_NEEDS_DATE = { message: "A reminder needs an expiry date.", path: ["reminderDays"] }

/**
 * A new record goes into a section: one the client has, by its id, or one
 * made for it by name, which is how a client's first record starts its first
 * section.
 */
export const createRecordSchema = z.object({
    ...content,
    sectionId: id.optional(),
    vendorId: id.optional(),
    sectionTitle: title.optional(),
})
    .refine(r => (r.sectionId !== undefined) !== (r.vendorId !== undefined && r.sectionTitle !== undefined), { message: "Choose a section, or name a new one.", path: ["sectionId"] })
    .refine(remindsOnlyWithExpiry, REMINDER_NEEDS_DATE)

/**
 * An edit replaces the record's text, files and dates; it may move it to
 * another of the client's sections. It says which files the record had
 * when its form opened, and is refused if someone has changed them since.
 */
export const updateRecordSchema = z.object({ id, ...content, sectionId: id.optional(), filesBefore: z.array(z.string().max(2000)).max(RECORD_FILES_MAX) })
    .refine(remindsOnlyWithExpiry, REMINDER_NEEDS_DATE)

export const createSectionSchema = z.object({ vendorId: id, title })
export const renameSectionSchema = z.object({ id, title })

/** Files uploaded for a record that was never saved with them (RecordForm). */
export const discardUploadsSchema = z.object({ urls: z.array(z.string().max(2000)).min(1).max(RECORD_FILES_MAX) })

export type CreateRecordInput = z.infer<typeof createRecordSchema>
export type UpdateRecordInput = z.infer<typeof updateRecordSchema>
export type CreateSectionInput = z.infer<typeof createSectionSchema>
export type RenameSectionInput = z.infer<typeof renameSectionSchema>
