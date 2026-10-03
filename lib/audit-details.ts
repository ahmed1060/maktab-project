import type { TranslationKey } from "@/lib/translations"
import { isPermission, type Scope } from "@/lib/permissions/catalogue"
import { permissionLabelKey, scopeLabelKey } from "@/lib/permissions/matrix"

/**
 * An audit entry's details, as the reader reads them.
 *
 * The details are stored as they were written, in the code's own terms
 * (`oldStatus: "IN_PROGRESS"`), and stay that way: this only changes how they
 * are shown. Each field gets its name in the reader's language
 * (`audit_field_*`); coded values their label (`audit_value_*`); permissions
 * and scopes the names the permission matrix uses; dates the reader's format;
 * a change (`{ old, new }` or `{ from, to }`) reads "before → after". What a
 * person typed — names, titles, reasons — is shown as typed. A field or code
 * with no label yet is shown readably rather than hidden: "oldStatus" reads
 * "Old status".
 */

export type DetailLine = { label: string; value?: string; lines?: DetailLine[] }

type T = (key: TranslationKey) => string
type Reader = { t: T; locale: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
const CODE = /^[A-Z][A-Z0-9_]*$/

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const isGrant = (v: unknown): v is { permission: string; scope: string } =>
    isObject(v) && typeof v.permission === "string" && typeof v.scope === "string"

/** `{ old, new }` or `{ from, to }`: a before and an after. */
function change(v: unknown): [unknown, unknown] | null {
    if (!isObject(v)) return null
    const keys = Object.keys(v).sort().join(",")
    if (keys === "new,old") return [v.old, v.new]
    if (keys === "from,to") return [v.from, v.to]
    return null
}

/** "oldStatus" → "Old status", for a field with no label yet. */
export function humanize(key: string): string {
    const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase()
    return words.charAt(0).toUpperCase() + words.slice(1)
}

export function fieldLabel(key: string, t: T): string {
    return t(`audit_field_${key}` as TranslationKey) || humanize(key)
}

export function describeValue(value: unknown, field: string, { t, locale }: Reader): string {
    if (value === null || value === undefined || value === "") return t("audit_value_none")
    if (typeof value === "boolean") return t(value ? "audit_value_true" : "audit_value_false")
    if (typeof value === "number") return String(value)
    if (typeof value === "string") {
        if (value === "[REDACTED]") return t("audit_value_redacted")
        // Separation-of-duties pairs, by their key (lib/permissions/separation.ts).
        if (field === "pairs") return t(`sod_${value}` as TranslationKey) || value
        if (isPermission(value)) return t(permissionLabelKey(value))
        if (DATE.test(value)) return new Date(value).toLocaleDateString(locale, { timeZone: "UTC" })
        if (DATE_TIME.test(value)) {
            const at = new Date(value)
            // A date stored as midnight UTC (a day off, a trial's end) is a
            // date, not a moment: shown as such, it is the same day everywhere.
            return at.getTime() % 86_400_000 === 0 ? at.toLocaleDateString(locale, { timeZone: "UTC" }) : at.toLocaleString(locale)
        }
        if (CODE.test(value)) return t(`audit_value_${value}` as TranslationKey) || value
        return value
    }
    if (Array.isArray(value)) {
        if (value.length === 0) return t("audit_value_none")
        const separator = locale === "ar" ? "، " : ", "
        return value.map(item => isGrant(item)
            ? `${describeValue(item.permission, "permission", { t, locale })} (${t(scopeLabelKey(item.scope as Scope)) || item.scope})`
            : describeValue(item, field, { t, locale })).join(separator)
    }
    return JSON.stringify(value)
}

export function describeDetails(details: unknown, reader: Reader): DetailLine[] {
    if (!isObject(details)) return details === null || details === undefined ? [] : [{ label: "", value: describeValue(details, "", reader) }]
    const arrow = reader.locale === "ar" ? " ← " : " → "
    return Object.entries(details)
        .filter(([, v]) => v !== undefined)
        .map(([key, v]): DetailLine => {
            const label = fieldLabel(key, reader.t)
            const pair = change(v)
            if (pair) return { label, value: describeValue(pair[0], key, reader) + arrow + describeValue(pair[1], key, reader) }
            if (isObject(v)) return { label, lines: describeDetails(v, reader) }
            if (Array.isArray(v) && v.some(item => isObject(item) && !isGrant(item))) {
                return { label, lines: v.map((item, i) => isObject(item) ? { label: String(i + 1), lines: describeDetails(item, reader) } : { label: String(i + 1), value: describeValue(item, key, reader) }) }
            }
            return { label, value: describeValue(v, key, reader) }
        })
}
