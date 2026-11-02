import { formatMinutes, parseTime, shiftEnd, type DayHours, type Version } from '@/lib/attendance/calendar'
import type { TranslationKey } from '@/lib/translations'

/**
 * A schedule's hours as the hours dialog holds them (ATTENDANCE_PLAN.md §7):
 * clock times and the break as typed, so a field can be emptied on the way
 * to another value and said to be wrong rather than quietly sent as 0.
 */
export type HoursForm = {
    start: string
    end: string
    /** As typed: empty is no break. */
    breakMinutes: string
    /** Empty: the company's work week. */
    workWeek: number[]
    customWeek: boolean
    /** Weekdays with their own hours, as clock times. */
    days: { weekday: number; start: string; end: string }[]
}

/** Which field an error goes under. */
export type HoursField = 'start' | 'end' | 'breakMinutes' | 'workWeek' | 'days'

export type Hours = { startMinutes: number; endMinutes: number; breakMinutes: number; workWeek: number[]; days: DayHours[] }

/** A clock time for a time field: the next day's 06:00 is 06:00. */
export const clock = (minutes: number) => formatMinutes(minutes % 1440).slice(0, 5)

export function firstOfNextMonth(today: string): string {
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

export function formFromVersion(v: Pick<Version, 'startMinutes' | 'endMinutes' | 'breakMinutes' | 'workWeek' | 'days'> | null): HoursForm {
    return {
        start: v ? clock(v.startMinutes) : '09:00',
        end: v ? clock(v.endMinutes) : '17:00',
        breakMinutes: String(v?.breakMinutes ?? 60),
        workWeek: v ? [...v.workWeek] : [],
        customWeek: !!v && v.workWeek.length > 0,
        days: (v?.days ?? []).map(d => ({ weekday: d.weekday, start: clock(d.startMinutes), end: clock(d.endMinutes) })),
    }
}

/** The hours as the API takes them, or what is wrong with them and under which field it's said. */
export function hoursFromForm(form: HoursForm): ({ ok: true } & Hours) | { ok: false; error: TranslationKey; field: HoursField } {
    const start = parseTime(form.start), end = parseTime(form.end)
    if (start === null) return { ok: false, error: 'attendance_time_invalid', field: 'start' }
    if (end === null) return { ok: false, error: 'attendance_time_invalid', field: 'end' }
    const typed = form.breakMinutes.trim()
    if (typed !== '' && !/^\d+$/.test(typed)) return { ok: false, error: 'attendance_break_invalid', field: 'breakMinutes' }
    const days: DayHours[] = []
    for (const d of form.days) {
        const s = parseTime(d.start), e = parseTime(d.end)
        if (s === null || e === null) return { ok: false, error: 'attendance_time_invalid', field: 'days' }
        days.push({ weekday: d.weekday, startMinutes: s, endMinutes: shiftEnd(s, e) })
    }
    if (form.customWeek && form.workWeek.length === 0) return { ok: false, error: 'attendance_work_week_empty', field: 'workWeek' }
    return {
        ok: true, startMinutes: start, endMinutes: shiftEnd(start, end), breakMinutes: typed === '' ? 0 : Number(typed),
        workWeek: form.customWeek ? form.workWeek : [], days,
    }
}
