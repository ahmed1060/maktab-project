/**
 * Client input for a Json column (task attachments/comments) is typed
 * `z.any()` at the validation layer — "can be stringified JSON or array" —
 * because the frontend has historically sent either shape. With the column
 * now Prisma `Json` (F-12), a string value has to be parsed before it's
 * written, or it gets stored as a JSON *string scalar* (double-encoded)
 * rather than the array/object it actually represents.
 */
export function normalizeJsonInput(value: any): any {
    if (typeof value === 'string') {
        try { return JSON.parse(value) } catch { return value }
    }
    return value
}
