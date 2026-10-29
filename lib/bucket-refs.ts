/**
 * Finding every bucket path a stored value refers to.
 *
 * The orphan sweep deletes what this cannot find, so the cost of the two
 * possible mistakes is wildly asymmetric: over-match and a dead file survives
 * another sweep, under-match and a live one is gone for good. Everything here
 * errs toward over-matching, deliberately.
 *
 * That is why it scans text for the bucket marker rather than parsing each
 * column's format. The seven columns that can hold one of these disagree about
 * how: `User.avatar` and `Company.logoUrl` are a bare URL, `Task.attachments`
 * is real Json, `Obligation.attachments` is a JSON *string*, and
 * `ClientNote.attachment` is a JSON string holding either an array of objects,
 * an array of strings, or a single object — or, when it fails to parse, a bare
 * URL, which its own delete path handles in a catch. Five encodings and a
 * fallback. A parser per format is five chances to miss a variant nobody
 * remembered; the substring is present in all of them.
 */

/** The bucket every one of these URLs points into. */
const MARKER = "/app-assets/"

/**
 * Paths that belong to no database row and must never be swept.
 *
 * The Excel base templates are addressed by a fixed path in code
 * (lib/storage.ts), not by a stored URL, so nothing in any table refers to
 * them. To a reference-counting sweep they look exactly like an orphan.
 */
export const RESERVED_PATHS: readonly string[] = [
    "templates/template_en.xlsx",
    "templates/template_ar.xlsx",
]

/** Supabase writes one of these into an otherwise empty folder. Not a file. */
export const FOLDER_PLACEHOLDER = ".emptyFolderPlaceholder"

/**
 * Every bucket path mentioned anywhere in this value.
 *
 * Terminates a path at the characters that can only be the encoding around it —
 * a quote, whitespace, a comma, a closing bracket or brace, a backslash — and
 * never at a character a Supabase object key can contain.
 */
export function extractBucketPaths(value: unknown): string[] {
    if (value === null || value === undefined) return []
    // Objects and arrays are stringified rather than walked: the marker survives
    // JSON.stringify, and walking would need to know each shape.
    const text = typeof value === "string" ? value : JSON.stringify(value)
    if (!text || !text.includes(MARKER)) return []

    const found: string[] = []
    let from = 0
    while (true) {
        const at = text.indexOf(MARKER, from)
        if (at === -1) break
        const start = at + MARKER.length
        let end = start
        while (end < text.length && !`"' \t\r\n,]}\\`.includes(text[end])) end++
        const path = text.slice(start, end)
        if (path) found.push(path)
        from = end > at ? end : at + MARKER.length
    }
    return found
}

/** Whether a stored object is swept at all, before any reference is considered. */
export function isSweepable(objectPath: string): boolean {
    if (!objectPath) return false
    if (objectPath.endsWith(FOLDER_PLACEHOLDER)) return false
    return !RESERVED_PATHS.includes(objectPath)
}
