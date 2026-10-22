import type { ExpiryState } from '@/lib/record-expiry'
import type { RecordFile } from '@/lib/record-files'

/** A record as GET /api/records sends it (RecordService.list). */
export type RecordItem = {
    id: string
    content: string
    files: RecordFile[]
    /** The day it expires, "YYYY-MM-DD", or null. */
    expiryDate: string | null
    /** Worked out by the server, against the same day its filter uses. */
    expiry: ExpiryState | null
    reminderDays: number | null
    createdAt: string
    lastEditedAt: string | null
    createdBy: { firstName: string; lastName: string } | null
    lastEditedBy: { firstName: string; lastName: string } | null
    /** Whoever's missing above was a Super Admin; otherwise a user since deleted. */
    createdBySuperAdmin: boolean
    lastEditedBySuperAdmin: boolean
    section: { id: string; title: string }
    /** The client it's kept for, and its company in a Super Admin's view of every company. */
    client: { id: string; name: string; company?: string }
}

/** One of a client's sections, with how many records it holds. */
export type SectionItem = { id: string; title: string; records: number }

const lang = (locale: string) => (locale === 'ar' ? 'ar-EG' : 'en-GB')

/** "20 Oct 2026" for a calendar day, the same wherever the reader is. */
export function formatDay(day: string, locale: string): string {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString(lang(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** "20 Oct 2026" for a moment, on the reader's calendar. */
export function formatMoment(iso: string, locale: string): string {
    return new Date(iso).toLocaleDateString(lang(locale), { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Who added or edited a record: their name, or, with none, a Super Admin
 * (who has no user row) or a user who has since been deleted.
 */
export const personName = (
    p: { firstName: string; lastName: string } | null | undefined,
    bySuperAdmin: boolean,
    t: (key: 'role_super_admin' | 'records_deleted_user') => string,
) => (p ? `${p.firstName} ${p.lastName}` : t(bySuperAdmin ? 'role_super_admin' : 'records_deleted_user'))
