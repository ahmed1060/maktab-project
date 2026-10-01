'use client'

import { useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import Modal from '@/components/Modal'
import AttendancePolicyPanel from '@/components/AttendancePolicyPanel'
import ConfirmModal from '@/components/ConfirmModal'
import { apiErrorText } from '@/lib/api-error-text'
import {
    companyWeekOn, defaultOn, formatMinutes, parseTime, scheduleIdOn, shiftEnd, versionOn, workDaysOf,
    type DayHours, type Override, type Version,
} from '@/lib/attendance/calendar'

/**
 * A company's attendance calendar (ATTENDANCE_PLAN.md §7): its schedules and
 * their hours, seasonal hours such as Ramadan, who works which schedule, and
 * the holidays it observes.
 *
 * Every change of hours asks "from when?" (§6.1) and becomes a new version
 * from that date, so the days before it keep the hours they were worked under.
 * Nothing here can change a month whose payroll is approved; the server
 * refuses it in so many words.
 */

type Schedule = {
    id: string
    name: string
    archivedAt: string | null
    versions: Version[]
    overrides: Override[]
}

type Calendar = {
    today: string
    companyWorkWeek: number[]
    /** The company's work week by date, from its policy (review on #11). */
    companyWorkWeeks: { effectiveFrom: string; workWeek: number[] }[]
    schedules: Schedule[]
    /** The company's default schedule, by date (review on #10). */
    defaults: { id: string; scheduleId: string; effectiveFrom: string }[]
    assignments: { id: string; userId: string; scheduleId: string; effectiveFrom: string }[]
    people: { id: string; name: string; role: string }[]
    holidays: {
        year: number
        public: { id: string; date: string; name: string; nameAr: string | null; observed: boolean }[]
        own: { id: string; date: string; name: string; isPaid: boolean }[]
    }
    canEdit: boolean
}

type HoursForm = {
    start: string
    end: string
    breakMinutes: number
    /** Empty: the company's work week. */
    workWeek: number[]
    customWeek: boolean
    /** Weekdays with their own hours, as clock times. */
    days: { weekday: number; start: string; end: string }[]
}

type Editing =
    | { kind: 'schedule' }
    | { kind: 'version'; schedule: Schedule }
    | { kind: 'override'; schedule: Schedule; override: Override | null }
    | null

/** What every panel of the tab reads and does, passed down as one object. */
type Ctx = {
    companyId: string
    data: Calendar
    active: Schedule[]
    defaultSchedule: Schedule | null
    setMakingDefault: (s: Schedule | null) => void
    editable: boolean
    busy: boolean
    isRtl: boolean
    t: (key: any) => string
    send: (url: string, method: string, body?: unknown, done?: string) => Promise<boolean>
    setEditing: (e: Editing) => void
    setConfirming: (c: { message: string; run: () => Promise<void> } | null) => void
    setYear: (y: number) => void
    weekdayName: (d: number) => string
    dateText: (date: string) => string
}

const span = (start: number, end: number) => `${formatMinutes(start)}–${formatMinutes(end)}`

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

const clock = (minutes: number) => formatMinutes(minutes % 1440).slice(0, 5)

function firstOfNextMonth(today: string): string {
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

function formFromVersion(v: Pick<Version, 'startMinutes' | 'endMinutes' | 'breakMinutes' | 'workWeek' | 'days'> | null): HoursForm {
    return {
        start: v ? clock(v.startMinutes) : '09:00',
        end: v ? clock(v.endMinutes) : '17:00',
        breakMinutes: v?.breakMinutes ?? 60,
        workWeek: v ? [...v.workWeek] : [],
        customWeek: !!v && v.workWeek.length > 0,
        days: (v?.days ?? []).map(d => ({ weekday: d.weekday, start: clock(d.startMinutes), end: clock(d.endMinutes) })),
    }
}

/** The hours as the API takes them, or the key of what is wrong with them. */
function hoursFromForm(form: HoursForm): { ok: true; startMinutes: number; endMinutes: number; breakMinutes: number; workWeek: number[]; days: DayHours[] } | { ok: false; error: string } {
    const start = parseTime(form.start), end = parseTime(form.end)
    if (start === null || end === null) return { ok: false, error: 'attendance_time_invalid' }
    const days: DayHours[] = []
    for (const d of form.days) {
        const s = parseTime(d.start), e = parseTime(d.end)
        if (s === null || e === null) return { ok: false, error: 'attendance_time_invalid' }
        days.push({ weekday: d.weekday, startMinutes: s, endMinutes: shiftEnd(s, e) })
    }
    if (form.customWeek && form.workWeek.length === 0) return { ok: false, error: 'attendance_work_week_empty' }
    return {
        ok: true, startMinutes: start, endMinutes: shiftEnd(start, end), breakMinutes: Math.max(0, Math.round(form.breakMinutes || 0)),
        workWeek: form.customWeek ? form.workWeek : [], days,
    }
}

export default function CompanyAttendanceCard({ companyId, readOnly = false }: { companyId: string; readOnly?: boolean }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const isRtl = locale === 'ar'
    const intl = isRtl ? 'ar-EG' : 'en-GB'

    const [year, setYear] = useState<number | null>(null)
    const [editing, setEditing] = useState<Editing>(null)
    const [confirming, setConfirming] = useState<{ message: string; run: () => Promise<void> } | null>(null)
    const [makingDefault, setMakingDefault] = useState<Schedule | null>(null)
    const [busy, setBusy] = useState(false)

    const query = new URLSearchParams({ companyId, ...(year ? { year: String(year) } : {}) })
    // Kept while another year loads, so the tab does not blank between years.
    const { data: body, error, mutate } = useSWR(`/api/attendance/calendar?${query}`, fetcher, { keepPreviousData: true })
    const data: Calendar | null = body?.data ?? null
    const loadFailed = !!error && !data
    const load = useCallback(async () => { await mutate() }, [mutate])

    const editable = !readOnly && !!data?.canEdit

    const weekdayName = useCallback((d: number) =>
        new Date(Date.UTC(2026, 2, 1 + d)).toLocaleDateString(intl, { weekday: 'short', timeZone: 'UTC' }), [intl])
    const dateText = useCallback((date: string) =>
        new Date(`${date}T00:00:00Z`).toLocaleDateString(intl, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), [intl])

    /** Sends one change, then reloads; the server's refusal is shown as it said it. */
    const send = useCallback(async (url: string, method: string, body?: unknown, done?: string) => {
        setBusy(true)
        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
            })
            if (!res.ok) {
                showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
                return false
            }
            if (done) showToast(done, 'success')
            await load()
            return true
        } catch {
            showToast(t('error_generic'), 'error')
            return false
        } finally {
            setBusy(false)
        }
    }, [load, showToast, t])

    if (loadFailed) return <div className="glass" style={{ padding: '1.5rem', borderRadius: '1rem' }}>{t('error_generic')}</div>
    if (!data) return <div className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', color: 'var(--text-soft)' }}>{t('loading')}</div>

    const active = data.schedules.filter(s => !s.archivedAt)
    const ctx: Ctx = {
        companyId, data, active, defaultSchedule: active.find(s => s.id === defaultOn(data.defaults, data.today)) ?? null, setMakingDefault,
        editable, busy, isRtl, t: t as Ctx['t'], send, setEditing, setConfirming, setYear, weekdayName, dateText,
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: isRtl ? 'right' : 'left' }}>
            {/* The policy first: its work week is what the schedules inherit. */}
            <AttendancePolicyPanel companyId={companyId} readOnly={!editable} onChanged={load} />
            <SchedulesSection ctx={ctx} />
            {/* Keyed by the data, so a reload starts the panel's own fields afresh. */}
            <PeoplePanel ctx={ctx} />
            <HolidaysPanel key={data.holidays.year} ctx={ctx} />

            {editing && (
                <HoursModal
                    editing={editing}
                    today={data.today}
                    companyWorkWeeks={data.companyWorkWeeks}
                    weekdayName={weekdayName}
                    busy={busy}
                    onClose={() => setEditing(null)}
                    onSubmit={async payload => {
                        let ok = false
                        if (editing.kind === 'schedule') ok = await send('/api/attendance/schedules', 'POST', { companyId, ...payload }, t('attendance_schedule_created'))
                        if (editing.kind === 'version') ok = await send(`/api/attendance/schedules/${editing.schedule.id}/versions`, 'POST', payload, t('attendance_hours_changed'))
                        if (editing.kind === 'override') {
                            ok = editing.override
                                ? await send(`/api/attendance/overrides/${editing.override.id}`, 'PUT', payload, t('settings_saved_success'))
                                : await send(`/api/attendance/schedules/${editing.schedule.id}/overrides`, 'POST', payload, t('attendance_override_created'))
                        }
                        if (ok) setEditing(null)
                    }}
                />
            )}

            {makingDefault && (
                <DefaultModal
                    schedule={makingDefault}
                    today={data.today}
                    busy={busy}
                    onClose={() => setMakingDefault(null)}
                    onSubmit={async effectiveFrom => {
                        const ok = await send(`/api/attendance/schedules/${makingDefault.id}/default`, 'POST', { effectiveFrom }, t('attendance_default_set'))
                        if (ok) setMakingDefault(null)
                    }}
                />
            )}

            <ConfirmModal
                isOpen={!!confirming}
                title={t('confirm_action')}
                message={confirming?.message ?? ''}
                confirmText={t('confirm')}
                variant="warning"
                onConfirm={async () => {
                    const next = confirming
                    setConfirming(null)
                    await next?.run()
                }}
                onCancel={() => setConfirming(null)}
            />
        </div>
    )
}

// --- Schedules -------------------------------------------------------------------

function SchedulesSection({ ctx }: { ctx: Ctx }) {
        const { t, active, editable, setEditing, data, busy, send, setConfirming, dateText } = ctx
        // Default changes still to come, each withdrawable until payroll locks it.
        const upcomingDefaults = data.defaults.filter(d => d.effectiveFrom > data.today)
        return (
            <section className="glass" style={{ padding: '1.5rem', borderRadius: '1rem' }} aria-labelledby="attendance-schedules">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <div>
                        <h3 id="attendance-schedules" style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>{t('attendance_schedules')}</h3>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-soft)' }}>{t('attendance_schedules_hint')}</p>
                    </div>
                    {editable && <button className="btn btn-primary" onClick={() => setEditing({ kind: 'schedule' })}>{t('attendance_new_schedule')}</button>}
                </div>

                {active.length === 0 && (
                    <p style={{ margin: '1rem 0 0', color: 'var(--text-soft)' }}>{t('attendance_no_schedules')}</p>
                )}

                {upcomingDefaults.length > 0 && (
                    <ul style={{ margin: '1rem 0 0', paddingInlineStart: '1.1rem', fontSize: '0.84rem' }}>
                        {upcomingDefaults.map(d => (
                            <li key={d.id}>
                                {t('attendance_default_from')
                                    .replace('{name}', data.schedules.find(s => s.id === d.scheduleId)?.name ?? '')
                                    .replace('{date}', dateText(d.effectiveFrom))}
                                {editable && (
                                    <button disabled={busy} style={{ marginInlineStart: '0.5rem', fontSize: '0.8rem', background: 'none', border: 'none', color: 'var(--danger-fg)', cursor: 'pointer' }}
                                        onClick={() => setConfirming({
                                            message: t('attendance_withdraw_confirm'),
                                            run: async () => { await send(`/api/attendance/defaults/${d.id}`, 'DELETE', undefined, t('attendance_withdrawn')) },
                                        })}>{t('attendance_withdraw')}</button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '1rem' }}>
                    {active.map(schedule => <ScheduleRow key={schedule.id} ctx={ctx} schedule={schedule} />)}
                </div>
            </section>
        )
    }

function ScheduleRow({ ctx, schedule }: { ctx: Ctx; schedule: Schedule }) {
        const { t, data, editable, busy, send, setEditing, setConfirming, weekdayName, dateText, setMakingDefault } = ctx
        const isDefault = defaultOn(data.defaults, data.today) === schedule.id
        const willBeDefault = data.defaults.some(d => d.effectiveFrom > data.today && d.scheduleId === schedule.id)
        const current = versionOn(schedule.versions, data.today)
        const upcoming = schedule.versions.filter(v => v.effectiveFrom > data.today)
        const people = data.people.filter(p => scheduleIdOn(
            data.assignments.filter(a => a.userId === p.id), data.defaults, data.today) === schedule.id).length
        const shown = current ?? upcoming[0] ?? null
        // An upcoming version inherits the company's week in force when it starts.
        const days = shown ? workDaysOf(shown, companyWeekOn(data.companyWorkWeeks, shown.effectiveFrom > data.today ? shown.effectiveFrom : data.today)) : []

        return (
            <div style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div>
                        <strong>{schedule.name}</strong>
                        {isDefault && (
                            <span style={{ marginInlineStart: '0.5rem', padding: '0.1rem 0.5rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600, background: 'var(--info-bg)', color: 'var(--info-fg)' }}>
                                {t('attendance_default')}
                            </span>
                        )}
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-body)', marginTop: '0.35rem' }}>
                            {shown ? (
                                <>
                                    {span(shown.startMinutes, shown.endMinutes)}
                                    {shown.breakMinutes > 0 && ` · ${t('attendance_break_n').replace('{n}', String(shown.breakMinutes))}`}
                                    {' · '}{days.map(weekdayName).join(' ')}
                                    {shown.workWeek.length === 0 && ` (${t('attendance_company_week')})`}
                                </>
                            ) : t('attendance_no_hours')}
                        </div>
                        {shown && shown.days.length > 0 && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: '0.2rem' }}>
                                {shown.days.map(d => `${weekdayName(d.weekday)} ${span(d.startMinutes, d.endMinutes)}`).join(' · ')}
                            </div>
                        )}
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: '0.2rem' }}>
                            {isDefault ? t('attendance_people_default').replace('{n}', String(people)) : t('attendance_people_n').replace('{n}', String(people))}
                        </div>
                    </div>
                    {editable && (
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                            <button className="btn btn-secondary" style={{ fontSize: '0.82rem' }} onClick={() => setEditing({ kind: 'version', schedule })}>{t('attendance_change_hours')}</button>
                            <button className="btn btn-secondary" style={{ fontSize: '0.82rem' }} onClick={() => setEditing({ kind: 'override', schedule, override: null })}>{t('attendance_add_override')}</button>
                            {!isDefault && (
                                <button className="btn btn-secondary" style={{ fontSize: '0.82rem' }} disabled={busy}
                                    onClick={() => setMakingDefault(schedule)}>
                                    {t('attendance_make_default')}
                                </button>
                            )}
                            {!isDefault && !willBeDefault && (
                                <button className="btn btn-secondary" style={{ fontSize: '0.82rem' }} disabled={busy}
                                    onClick={() => setConfirming({
                                        message: t('attendance_archive_confirm').replace('{name}', schedule.name),
                                        run: async () => { await send(`/api/attendance/schedules/${schedule.id}`, 'DELETE', undefined, t('attendance_archived')) },
                                    })}>
                                    {t('attendance_archive')}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {upcoming.length > 0 && (
                    <ul style={{ margin: '0.75rem 0 0', paddingInlineStart: '1.1rem', fontSize: '0.84rem' }}>
                        {upcoming.map(v => (
                            <li key={v.id} style={{ marginBottom: '0.25rem' }}>
                                {t('attendance_from_date').replace('{date}', dateText(v.effectiveFrom))}: {span(v.startMinutes, v.endMinutes)}
                                {editable && (
                                    <button className="btn-link" style={{ marginInlineStart: '0.5rem', fontSize: '0.8rem', background: 'none', border: 'none', color: 'var(--danger-fg)', cursor: 'pointer' }}
                                        onClick={() => setConfirming({
                                            message: t('attendance_withdraw_confirm'),
                                            run: async () => { await send(`/api/attendance/versions/${v.id}`, 'DELETE', undefined, t('attendance_withdrawn')) },
                                        })}>
                                        {t('attendance_withdraw')}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                {schedule.overrides.length > 0 && (
                    <div style={{ marginTop: '0.75rem' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{t('attendance_overrides')}</div>
                        {schedule.overrides.map(o => (
                            <div key={o.id} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.84rem', marginBottom: '0.25rem' }}>
                                <span><strong>{o.name}</strong> · {dateText(o.startDate)} – {dateText(o.endDate)} · {span(o.startMinutes, o.endMinutes)}</span>
                                {editable && (
                                    <>
                                        <button style={{ fontSize: '0.8rem', background: 'none', border: 'none', color: 'var(--brand-primary-text)', cursor: 'pointer' }}
                                            onClick={() => setEditing({ kind: 'override', schedule, override: o })}>{t('edit')}</button>
                                        <button style={{ fontSize: '0.8rem', background: 'none', border: 'none', color: 'var(--danger-fg)', cursor: 'pointer' }}
                                            onClick={() => setConfirming({
                                                message: t('attendance_override_delete_confirm').replace('{name}', o.name),
                                                run: async () => { await send(`/api/attendance/overrides/${o.id}`, 'DELETE', undefined, t('attendance_override_deleted')) },
                                            })}>{t('delete')}</button>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )
    }

// --- People ----------------------------------------------------------------------

function PeoplePanel({ ctx }: { ctx: Ctx }) {
        const { t, data, active, editable, busy, send, dateText, companyId, isRtl } = ctx
        const [selected, setSelected] = useState<string[]>([])
        const [target, setTarget] = useState(active[0]?.id ?? '')
        const [from, setFrom] = useState(firstOfNextMonth(data.today))

        const rows = useMemo(() => data.people.map(p => {
            const mine = data.assignments.filter(a => a.userId === p.id)
            const now = scheduleIdOn(mine, data.defaults, data.today)
            const next = mine.filter(a => a.effectiveFrom > data.today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0]
            return { ...p, now, next, explicit: mine.some(a => a.effectiveFrom <= data.today) }
        }), [data])
        const nameOf = (id: string | null | undefined) => data.schedules.find(s => s.id === id)?.name ?? t('attendance_none')

        if (active.length === 0) return null
        return (
            <section className="glass" style={{ padding: '1.5rem', borderRadius: '1rem' }} aria-labelledby="attendance-people">
                <h3 id="attendance-people" style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>{t('attendance_who_works_which')}</h3>
                <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-soft)' }}>{t('attendance_who_works_which_hint')}</p>

                {editable && (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
                        <div>
                            <label htmlFor="attendance-move-to" className="label">{t('attendance_move_to')}</label>
                            <select id="attendance-move-to" className="input" value={target} onChange={e => setTarget(e.target.value)} style={{ width: 'auto' }}>
                                {active.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="attendance-move-from" className="label">{t('attendance_from')}</label>
                            <input id="attendance-move-from" className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
                        </div>
                        <button className="btn btn-primary" disabled={busy || selected.length === 0 || !target || !from}
                            onClick={async () => {
                                const ok = await send('/api/attendance/assignments', 'POST', { companyId, userIds: selected, scheduleId: target, effectiveFrom: from }, t('attendance_moved'))
                                if (ok) setSelected([])
                            }}>
                            {t('attendance_move_n').replace('{n}', String(selected.length))}
                        </button>
                    </div>
                )}

                {rows.length === 0 ? (
                    <p style={{ margin: 0, color: 'var(--text-soft)', fontSize: '0.85rem' }}>{t('attendance_no_people')}</p>
                ) : (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
                        <thead>
                            <tr style={{ textAlign: isRtl ? 'right' : 'left', color: 'var(--text-muted)' }}>
                                {editable && <th style={{ padding: '0.4rem' }}>
                                    <input type="checkbox" aria-label={t('select_all')}
                                        checked={selected.length > 0 && selected.length === rows.length}
                                        onChange={e => setSelected(e.target.checked ? rows.map(r => r.id) : [])} />
                                </th>}
                                <th style={{ padding: '0.4rem' }}>{t('name')}</th>
                                <th style={{ padding: '0.4rem' }}>{t('attendance_schedule_now')}</th>
                                <th style={{ padding: '0.4rem' }}>{t('attendance_schedule_next')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                                    {editable && <td style={{ padding: '0.4rem' }}>
                                        <input type="checkbox" aria-label={r.name} checked={selected.includes(r.id)}
                                            onChange={e => setSelected(e.target.checked ? [...selected, r.id] : selected.filter(id => id !== r.id))} />
                                    </td>}
                                    <td style={{ padding: '0.4rem' }}>{r.name}</td>
                                    <td style={{ padding: '0.4rem' }}>
                                        {nameOf(r.now)}
                                        {!r.explicit && r.now && <span style={{ color: 'var(--text-soft)' }}> ({t('attendance_default').toLowerCase()})</span>}
                                    </td>
                                    <td style={{ padding: '0.4rem', color: 'var(--text-soft)' }}>
                                        {r.next ? (
                                            <>
                                                {t('attendance_next_move').replace('{name}', nameOf(r.next.scheduleId)).replace('{date}', dateText(r.next.effectiveFrom))}
                                                {editable && (
                                                    <button style={{ marginInlineStart: '0.4rem', fontSize: '0.78rem', background: 'none', border: 'none', color: 'var(--danger-fg)', cursor: 'pointer' }}
                                                        onClick={() => send(`/api/attendance/assignments/${r.next!.id}`, 'DELETE', undefined, t('attendance_withdrawn'))}>
                                                        {t('attendance_withdraw')}
                                                    </button>
                                                )}
                                            </>
                                        ) : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                )}
            </section>
        )
    }

// --- Holidays --------------------------------------------------------------------

function HolidaysPanel({ ctx }: { ctx: Ctx }) {
        const { t, data, editable, busy, send, dateText, companyId, isRtl, setYear } = ctx
        const [date, setDate] = useState('')
        const [name, setName] = useState('')
        const [isPaid, setIsPaid] = useState(true)
        const h = data.holidays

        return (
            <section className="glass" style={{ padding: '1.5rem', borderRadius: '1rem' }} aria-labelledby="attendance-holidays">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <div>
                        <h3 id="attendance-holidays" style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>{t('attendance_holidays')}</h3>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-soft)' }}>{t('attendance_holidays_hint')}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        <button className="btn btn-secondary" aria-label={t('previous_page')} onClick={() => setYear(h.year - 1)}>{'‹'}</button>
                        <strong>{h.year}</strong>
                        <button className="btn btn-secondary" aria-label={t('next_page')} onClick={() => setYear(h.year + 1)}>{'›'}</button>
                    </div>
                </div>

                <div style={{ marginTop: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>{t('attendance_public_holidays')}</div>
                    {h.public.length === 0 && <p style={{ margin: 0, color: 'var(--text-soft)', fontSize: '0.85rem' }}>{t('attendance_no_holidays')}</p>}
                    {h.public.map(p => (
                        <label key={p.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', padding: '0.3rem 0', fontSize: '0.86rem', opacity: p.observed ? 1 : 0.65 }}>
                            <input type="checkbox" checked={p.observed} disabled={!editable || busy}
                                onChange={e => send('/api/attendance/holidays/observed', 'PUT', { companyId, publicHolidayId: p.id, observed: e.target.checked }, t('settings_saved_success'))} />
                            <span style={{ minWidth: '7.5rem' }}>{dateText(p.date)}</span>
                            <span>{isRtl && p.nameAr ? p.nameAr : p.name}</span>
                            {!p.observed && <span style={{ color: 'var(--text-soft)' }}>· {t('attendance_worked_through')}</span>}
                        </label>
                    ))}
                </div>

                <div style={{ marginTop: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>{t('attendance_own_holidays')}</div>
                    {h.own.length === 0 && <p style={{ margin: 0, color: 'var(--text-soft)', fontSize: '0.85rem' }}>{t('attendance_no_own_holidays')}</p>}
                    {h.own.map(o => (
                        <div key={o.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', padding: '0.3rem 0', fontSize: '0.86rem' }}>
                            <span style={{ minWidth: '7.5rem' }}>{dateText(o.date)}</span>
                            <span>{o.name}</span>
                            {!o.isPaid && <span style={{ color: 'var(--text-soft)' }}>· {t('attendance_unpaid')}</span>}
                            {editable && (
                                <button style={{ fontSize: '0.8rem', background: 'none', border: 'none', color: 'var(--danger-fg)', cursor: 'pointer' }}
                                    onClick={() => send(`/api/attendance/holidays/${o.id}`, 'DELETE', undefined, t('attendance_holiday_removed'))}>{t('delete')}</button>
                            )}
                        </div>
                    ))}
                    {editable && (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.75rem' }}>
                            <div>
                                <label htmlFor="attendance-holiday-date" className="label">{t('date')}</label>
                                <input id="attendance-holiday-date" className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
                            </div>
                            <div style={{ flex: '1 1 12rem' }}>
                                <label htmlFor="attendance-holiday-name" className="label">{t('name')}</label>
                                <input id="attendance-holiday-name" className="input" value={name} maxLength={120} onChange={e => setName(e.target.value)} />
                            </div>
                            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.86rem', paddingBottom: '0.6rem' }}>
                                <input type="checkbox" checked={isPaid} onChange={e => setIsPaid(e.target.checked)} />
                                {t('attendance_paid')}
                            </label>
                            <button className="btn btn-primary" disabled={busy || !date || !name.trim()}
                                onClick={async () => {
                                    const ok = await send('/api/attendance/holidays', 'POST', { companyId, date, name: name.trim(), isPaid }, t('attendance_holiday_added'))
                                    // Show the year it was added to, or a holiday for next year
                                    // vanishes from view the moment it is saved (review on #10).
                                    if (ok) { setYear(Number(date.slice(0, 4))); setDate(''); setName(''); setIsPaid(true) }
                                }}>
                                {t('attendance_add_holiday')}
                            </button>
                        </div>
                    )}
                </div>
            </section>
        )
}

// --- The hours form ------------------------------------------------------------

function HoursModal({ editing, today, companyWorkWeeks, weekdayName, busy, onClose, onSubmit }: {
    editing: NonNullable<Editing>
    today: string
    companyWorkWeeks: { effectiveFrom: string; workWeek: number[] }[]
    weekdayName: (d: number) => string
    busy: boolean
    onClose: () => void
    onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
    const { t } = useLanguage()
    const isOverride = editing.kind === 'override'
    // A new version starts from the hours in force on its default date, next
    // month: an upcoming change already planned, not today's (review on #10).
    const base = editing.kind === 'version' ? versionOn(editing.schedule.versions, firstOfNextMonth(today)) ?? editing.schedule.versions.at(-1) ?? null
        : editing.kind === 'override' && editing.override ? { ...editing.override, workWeek: [] } : null

    const [name, setName] = useState(editing.kind === 'override' ? editing.override?.name ?? '' : '')
    const [form, setForm] = useState<HoursForm>(formFromVersion(base))
    // "From when?" (§6.1): the next payroll month unless they say otherwise.
    const [from, setFrom] = useState(editing.kind === 'schedule' ? today : firstOfNextMonth(today))
    const [startDate, setStartDate] = useState(editing.kind === 'override' ? editing.override?.startDate ?? '' : '')
    const [endDate, setEndDate] = useState(editing.kind === 'override' ? editing.override?.endDate ?? '' : '')
    // The company's week on the date these hours start, which is what they inherit.
    const companyWorkWeek = companyWeekOn(companyWorkWeeks, (isOverride ? startDate : from) || from)
    const [error, setError] = useState('')

    const title = editing.kind === 'schedule' ? t('attendance_new_schedule')
        : editing.kind === 'version' ? `${t('attendance_change_hours')}: ${editing.schedule.name}`
            : `${editing.override ? t('edit') : t('attendance_add_override')}: ${editing.schedule.name}`

    const submit = async () => {
        setError('')
        const hours = hoursFromForm(form)
        if (!hours.ok) { setError(t(hours.error as any)); return }
        const h = { startMinutes: hours.startMinutes, endMinutes: hours.endMinutes, breakMinutes: hours.breakMinutes, workWeek: hours.workWeek, days: hours.days }
        if (editing.kind === 'schedule') {
            if (!name.trim()) { setError(t('attendance_name_required')); return }
            await onSubmit({ name: name.trim(), version: { ...h, effectiveFrom: from } })
        } else if (editing.kind === 'version') {
            await onSubmit({ ...h, effectiveFrom: from })
        } else {
            if (!name.trim()) { setError(t('attendance_name_required')); return }
            if (!startDate || !endDate) { setError(t('attendance_dates_required')); return }
            await onSubmit({ name: name.trim(), startDate, endDate, startMinutes: h.startMinutes, endMinutes: h.endMinutes, breakMinutes: h.breakMinutes, days: h.days })
        }
    }

    const toggleDay = (d: number) => setForm(f => ({ ...f, workWeek: f.workWeek.includes(d) ? f.workWeek.filter(x => x !== d) : [...f.workWeek, d].sort() }))
    const hasOwnHours = (d: number) => form.days.some(x => x.weekday === d)

    return (
        <Modal isOpen onClose={onClose} title={title}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                {(editing.kind === 'schedule' || isOverride) && (
                    <div>
                        <label htmlFor="hours-name" className="label">{isOverride ? t('attendance_override_name') : t('attendance_schedule_name')}</label>
                        <input id="hours-name" className="input" value={name} maxLength={80} onChange={e => setName(e.target.value)}
                            placeholder={isOverride ? t('attendance_override_placeholder') : t('attendance_schedule_placeholder')} />
                    </div>
                )}

                {isOverride ? (
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <div>
                            <label htmlFor="hours-start-date" className="label">{t('attendance_first_day')}</label>
                            <input id="hours-start-date" className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                        </div>
                        <div>
                            <label htmlFor="hours-end-date" className="label">{t('attendance_last_day')}</label>
                            <input id="hours-end-date" className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                        </div>
                    </div>
                ) : (
                    <div>
                        <label htmlFor="hours-from" className="label">{t('attendance_from_when')}</label>
                        <input id="hours-from" className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} aria-describedby="hours-from-hint" />
                        <div id="hours-from-hint" style={{ fontSize: '0.78rem', color: 'var(--text-soft)', marginTop: '0.3rem' }}>
                            {t('attendance_from_when_hint')}
                            {' '}
                            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--brand-primary-text)', cursor: 'pointer', padding: 0 }} onClick={() => setFrom(today)}>{t('attendance_from_today')}</button>
                            {' · '}
                            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--brand-primary-text)', cursor: 'pointer', padding: 0 }} onClick={() => setFrom(firstOfNextMonth(today))}>{t('attendance_from_next_month')}</button>
                        </div>
                    </div>
                )}

                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <div>
                        <label htmlFor="hours-start" className="label">{t('attendance_starts')}</label>
                        <input id="hours-start" className="input" type="time" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} />
                    </div>
                    <div>
                        <label htmlFor="hours-end" className="label">{t('attendance_ends')}</label>
                        <input id="hours-end" className="input" type="time" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} aria-describedby="hours-end-hint" />
                    </div>
                    <div>
                        <label htmlFor="hours-break" className="label">{t('attendance_break_minutes')}</label>
                        <input id="hours-break" className="input" type="number" min={0} step={5} value={form.breakMinutes} style={{ width: '6rem' }}
                            onChange={e => setForm({ ...form, breakMinutes: Number(e.target.value) })} />
                    </div>
                </div>
                <div id="hours-end-hint" style={{ fontSize: '0.78rem', color: 'var(--text-soft)', marginTop: '-0.5rem' }}>{t('attendance_night_shift_hint')}</div>

                {!isOverride && (
                    <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                        <legend className="label">{t('attendance_work_week')}</legend>
                        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.86rem' }}>
                            <input type="checkbox" checked={!form.customWeek}
                                onChange={e => setForm({ ...form, customWeek: !e.target.checked, workWeek: e.target.checked ? [] : [...companyWorkWeek] })} />
                            {t('attendance_use_company_week').replace('{days}', companyWorkWeek.map(weekdayName).join(' '))}
                        </label>
                        {form.customWeek && (
                            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                                {WEEKDAYS.map(d => (
                                    <label key={d} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', fontSize: '0.86rem' }}>
                                        <input type="checkbox" checked={form.workWeek.includes(d)} onChange={() => toggleDay(d)} />
                                        {weekdayName(d)}
                                    </label>
                                ))}
                            </div>
                        )}
                    </fieldset>
                )}

                <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                    <legend className="label">{t('attendance_day_exceptions')}</legend>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-soft)', marginBottom: '0.4rem' }}>{t('attendance_day_exceptions_hint')}</div>
                    {WEEKDAYS.map(d => {
                        const own = form.days.find(x => x.weekday === d)
                        return (
                            <div key={d} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                                <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', minWidth: '5.5rem', fontSize: '0.86rem' }}>
                                    <input type="checkbox" checked={hasOwnHours(d)}
                                        onChange={e => setForm({
                                            ...form,
                                            days: e.target.checked ? [...form.days, { weekday: d, start: form.start, end: form.end }] : form.days.filter(x => x.weekday !== d),
                                        })} />
                                    {weekdayName(d)}
                                </label>
                                {own && (
                                    <>
                                        <input className="input" type="time" aria-label={`${weekdayName(d)} ${t('attendance_starts')}`} value={own.start} style={{ width: 'auto' }}
                                            onChange={e => setForm({ ...form, days: form.days.map(x => x.weekday === d ? { ...x, start: e.target.value } : x) })} />
                                        <input className="input" type="time" aria-label={`${weekdayName(d)} ${t('attendance_ends')}`} value={own.end} style={{ width: 'auto' }}
                                            onChange={e => setForm({ ...form, days: form.days.map(x => x.weekday === d ? { ...x, end: e.target.value } : x) })} />
                                    </>
                                )}
                            </div>
                        )
                    })}
                </fieldset>

                {error && <div role="alert" style={{ color: 'var(--danger-fg)', fontSize: '0.85rem' }}>{error}</div>}

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
                    <button className="btn btn-primary" disabled={busy} onClick={submit}>{t('save')}</button>
                </div>
            </div>
        </Modal>
    )
}


// --- Making a schedule the default -------------------------------------------------

function DefaultModal({ schedule, today, busy, onClose, onSubmit }: {
    schedule: Schedule
    today: string
    busy: boolean
    onClose: () => void
    onSubmit: (effectiveFrom: string) => Promise<void>
}) {
    const { t } = useLanguage()
    const [from, setFrom] = useState(firstOfNextMonth(today))
    return (
        <Modal isOpen onClose={onClose} title={`${t('attendance_make_default')}: ${schedule.name}`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-body)' }}>{t('attendance_default_hint')}</p>
                <div>
                    <label htmlFor="default-from" className="label">{t('attendance_from_when')}</label>
                    <input id="default-from" className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
                    <button className="btn btn-primary" disabled={busy || !from} onClick={() => onSubmit(from)}>{t('save')}</button>
                </div>
            </div>
        </Modal>
    )
}
