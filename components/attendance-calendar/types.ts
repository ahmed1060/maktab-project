import type { Override, Version } from '@/lib/attendance/calendar'
import type { TranslationKey } from '@/lib/translations'

/** A company's attendance calendar as `/api/attendance/calendar` gives it (ATTENDANCE_PLAN.md §7). */
export type Schedule = {
    id: string
    name: string
    archivedAt: string | null
    versions: Version[]
    overrides: Override[]
}

export type Calendar = {
    today: string
    companyWorkWeek: number[]
    /** The company's work week by date, from its policy (review on #11). */
    companyWorkWeeks: { effectiveFrom: string; workWeek: number[] }[]
    schedules: Schedule[]
    /** The company's default schedule, by date (review on #10). */
    defaults: { id: string; scheduleId: string; effectiveFrom: string }[]
    assignments: { id: string; userId: string; scheduleId: string; effectiveFrom: string }[]
    /** Each in English, and in Arabic where they have it (LATER_CHANGES_PLAN.md §3.1, step 8k, PR 422). */
    people: { id: string; name: string; nameAr?: string | null; role: string }[]
    holidays: {
        year: number
        /** `applies`: not while the company has public holidays off on its date (PR 362). */
        public: { id: string; date: string; name: string; nameAr: string | null; observed: boolean; applies: boolean }[]
        own: { id: string; date: string; name: string; isPaid: boolean }[]
    }
    canEdit: boolean
    /**
     * Which add-ons' sections the tab shows this person: Fingerprint
     * terminals and the places people check in at (FIRST_CHANGES_PLAN.md §5,
     * PR 361). The tab asks for nothing else.
     */
    sections: { terminals: boolean; mobileApp: boolean }
    /**
     * Public holidays apply (FIRST_CHANGES_PLAN.md §6, PR 362): each change,
     * off or back on from a date, and the earliest the next may be from.
     */
    publicHolidays: { changes: { id: string; effectiveFrom: string; apply: boolean }[]; earliest: string | null }
}

/** What the hours dialog is open for. */
export type Editing =
    | { kind: 'schedule' }
    | { kind: 'version'; schedule: Schedule }
    | { kind: 'override'; schedule: Schedule; override: Override | null }

/** A change that can't be taken back by itself, asked about first in a dialog. */
export type Confirming = { title: string; body: string; confirm: string; run: () => Promise<boolean> }

/** What every card of the calendar reads and does, passed down as one object. */
export type Ctx = {
    companyId: string
    data: Calendar
    active: Schedule[]
    editable: boolean
    busy: boolean
    locale: string
    t: (key: TranslationKey) => string
    /** Sends one change, then reloads; true when it was made. */
    send: (url: string, method: string, body?: unknown, done?: string) => Promise<boolean>
    setEditing: (e: Editing) => void
    setMakingDefault: (s: Schedule) => void
    setMoving: (moving: boolean) => void
    setAddingHoliday: (adding: boolean) => void
    /** Opens the question for turning public holidays off (false) or back on (true). */
    setTurningPublic: (apply: boolean) => void
    /** Asks before a change that can't be taken back by itself, in a dialog. */
    askFirst: (c: Confirming) => void
    setYear: (y: number) => void
    weekdayName: (d: number) => string
    dateText: (date: string) => string
    /** Digits as the page's language writes them: Arabic-Indic in Arabic (DESIGN.md §3.3). */
    digits: (text: string) => string
    /** "09:00–17:00", as the page's language writes a range. */
    timeRange: (start: number, end: number) => string
    /** "18 Feb 2027 to 19 Mar 2027", as the page's language writes a range. */
    dateRange: (start: string, end: string) => string
}
