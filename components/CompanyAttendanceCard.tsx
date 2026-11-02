'use client'

import { useCallback, useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, ButtonLink, Dialog, EmptyState } from '@/components/ui'
import AttendancePolicyPanel from '@/components/AttendancePolicyPanel'
import FaceLegalPanel from '@/components/FaceLegalPanel'
import AttendancePayrollPanel from '@/components/AttendancePayrollPanel'
import AttendanceTerminalsPanel from '@/components/AttendanceTerminalsPanel'
import AttendanceLocationsPanel from '@/components/AttendanceLocationsPanel'
import { apiErrorText } from '@/lib/api-error-text'
import { formatMinutes } from '@/lib/attendance/calendar'
import { SchedulesCard, ScheduleCard } from '@/components/attendance-calendar/Schedules'
import { PeopleCard } from '@/components/attendance-calendar/People'
import { HolidaysCard } from '@/components/attendance-calendar/Holidays'
import HoursDialog from '@/components/attendance-calendar/HoursDialog'
import { DefaultDialog, HolidayDialog, MoveDialog } from '@/components/attendance-calendar/Dialogs'
import type { Calendar, Confirming, Ctx, Editing, Schedule } from '@/components/attendance-calendar/types'

/**
 * A company's attendance calendar (ATTENDANCE_PLAN.md §7): its schedules and
 * their hours, seasonal hours such as Ramadan, who works which schedule, and
 * the holidays it observes.
 *
 * Every change of hours asks "from when?" (§6.1) and becomes a new version
 * from that date, so the days before it keep the hours they were worked under.
 * Nothing here can change a month whose payroll is approved; the server
 * refuses it in so many words.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 3a):
 * a card for the schedules and one for each, one for who works which and one
 * for the holidays; every change in the building blocks' dialog, and every
 * change that can't be taken back asked about first.
 */
export default function CompanyAttendanceCard({ companyId, readOnly = false }: { companyId: string; readOnly?: boolean }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'

    const [year, setYear] = useState<number | null>(null)
    const [editing, setEditing] = useState<Editing | null>(null)
    const [confirming, setConfirming] = useState<Confirming | null>(null)
    const [makingDefault, setMakingDefault] = useState<Schedule | null>(null)
    const [moving, setMoving] = useState(false)
    const [addingHoliday, setAddingHoliday] = useState(false)
    const [busy, setBusy] = useState(false)

    const query = new URLSearchParams({ companyId, ...(year ? { year: String(year) } : {}) })
    // Kept while another year loads, so the tab does not blank between years.
    const { data: body, error, isValidating, mutate } = useSWR(`/api/attendance/calendar?${query}`, fetcher, { keepPreviousData: true })
    const data: Calendar | null = body?.data ?? null
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

    if (!data) return error ? (
        <div className="ui-panel">
            <EmptyState icon={WarningCircleIcon} title={t('attendance_calendar_load_failed')} detail={(error as SWRError).info?.error}
                action={<Button busy={isValidating} onClick={() => { void load() }}>{t('try_again')}</Button>} />
        </div>
    ) : (
        <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
    )

    const active = data.schedules.filter(s => !s.archivedAt)
    // Times and minutes in the page's digits, as its dates and counts are
    // (the audit on company settings part 3a): formatMinutes writes Latin ones.
    const digits = (text: string) => locale === 'ar' ? text.replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]) : text
    const ctx: Ctx = {
        companyId, data, active, editable, busy, locale, t, send, setEditing, setMakingDefault, setMoving, setAddingHoliday,
        askFirst: setConfirming, setYear, weekdayName, dateText, digits,
        timeRange: (start, end) => t('attendance_time_range').replace('{start}', digits(formatMinutes(start))).replace('{end}', digits(formatMinutes(end))),
        dateRange: (start, end) => t('attendance_date_range').replace('{start}', dateText(start)).replace('{end}', dateText(end)),
    }

    return (
        <>
            {/* The Super Admin has no side bar entry into one company's punches; this is it. */}
            {session?.user?.role === 'SUPER_ADMIN' && (
                <div className="ui-card-actions">
                    <ButtonLink href={`/dashboard/attendance?companyId=${encodeURIComponent(companyId)}`}>{t('punch_open')}</ButtonLink>
                </div>
            )}
            {/* Whether any of this reaches anybody's pay yet (§12). */}
            <AttendancePayrollPanel companyId={companyId} readOnly={!editable} />
            {/* Only for a company holding the Terminals add-on; hides itself otherwise (§16). */}
            <AttendanceTerminalsPanel companyId={companyId} readOnly={!editable} />
            {/* Only for a company holding the Mobile App add-on; hides itself otherwise (§16). */}
            <AttendanceLocationsPanel companyId={companyId} readOnly={!editable} />
            {/* The policy first: its work week is what the schedules inherit. */}
            <AttendancePolicyPanel companyId={companyId} readOnly={!editable} onChanged={load} />
            <FaceLegalPanel companyId={companyId} readOnly={!editable} />
            <SchedulesCard ctx={ctx} />
            {active.map(schedule => <ScheduleCard key={schedule.id} ctx={ctx} schedule={schedule} />)}
            <PeopleCard ctx={ctx} />
            {/* Keyed by the year, so another year starts the card afresh. */}
            <HolidaysCard key={data.holidays.year} ctx={ctx} />

            {editing && (
                <HoursDialog
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
                <DefaultDialog
                    schedule={makingDefault}
                    today={data.today}
                    busy={busy}
                    onClose={() => setMakingDefault(null)}
                    onSubmit={async effectiveFrom => {
                        if (await send(`/api/attendance/schedules/${makingDefault.id}/default`, 'POST', { effectiveFrom }, t('attendance_default_set'))) setMakingDefault(null)
                    }}
                />
            )}

            {moving && (
                <MoveDialog
                    data={data}
                    active={active}
                    busy={busy}
                    onClose={() => setMoving(false)}
                    onSubmit={async move => {
                        if (await send('/api/attendance/assignments', 'POST', { companyId, ...move }, t('attendance_moved'))) setMoving(false)
                    }}
                />
            )}

            {addingHoliday && (
                <HolidayDialog
                    busy={busy}
                    onClose={() => setAddingHoliday(false)}
                    onSubmit={async holiday => {
                        if (!await send('/api/attendance/holidays', 'POST', { companyId, ...holiday }, t('attendance_holiday_added'))) return
                        setAddingHoliday(false)
                        // Show the year it was added to, or a holiday for next year
                        // vanishes from view the moment it is saved (review on #10).
                        setYear(Number(holiday.date.slice(0, 4)))
                    }}
                />
            )}

            {/* A change that can't be taken back by itself, asked about first:
                it stays open, its button busy, until the change is made. */}
            <Dialog
                open={!!confirming}
                onClose={() => { if (!busy) setConfirming(null) }}
                title={confirming?.title ?? ''}
                actions={<>
                    <Button onClick={() => setConfirming(null)} disabled={busy}>{t('cancel')}</Button>
                    <Button variant="danger" busy={busy} onClick={async () => {
                        if (confirming && await confirming.run()) setConfirming(null)
                    }}>{confirming?.confirm}</Button>
                </>}
            >
                <p>{confirming?.body}</p>
            </Dialog>
        </>
    )
}
