/**
 * exceljs's cell.value is a richer type than SheetJS's — a date/time cell
 * can come back as a native Date, and a formula or rich-text cell as an
 * object rather than a plain scalar. Reduces to what the bulk task import
 * row-parsing code actually knows how to handle.
 */
export function cellToPrimitive(value: unknown): string | number | Date | null | undefined {
    if (value === null || value === undefined) return value
    if (value instanceof Date) return value
    if (typeof value === 'object') {
        const v = value as any
        if (typeof v.result !== 'undefined') return cellToPrimitive(v.result) // formula cell
        if (typeof v.text === 'string') return v.text // hyperlink / rich-text cell
        if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('')
        return String(value)
    }
    return value as string | number
}
