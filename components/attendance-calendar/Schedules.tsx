'use client'

import { ArchiveIcon, CalendarPlusIcon, ClockIcon, PencilSimpleIcon, PlusIcon, StarIcon, TrashIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, Details, Row, RowMenu, StatusBadge, type MenuItem } from '@/components/ui'
import { countOf } from '@/lib/plural'
import { companyWeekOn, defaultOn, scheduleIdOn, versionOn, workDaysOf } from '@/lib/attendance/calendar'
import { fill } from './fill'
import type { Ctx, Schedule } from './types'

/**
 * The schedules (ATTENDANCE_PLAN.md §7): a card saying what they're for,
 * with New schedule and the default changes to come, then a card for each.
 */
export function SchedulesCard({ ctx }: { ctx: Ctx }) {
    const { t, active, editable, setEditing, data, dateText, askFirst, send } = ctx
    // Default changes still to come, each withdrawable until payroll locks it.
    const upcomingDefaults = data.defaults.filter(d => d.effectiveFrom > data.today)
    const nameOf = (id: string) => data.schedules.find(s => s.id === id)?.name ?? ''
    return (
        <Card
            title={t('attendance_schedules')}
            actions={editable && <Button size="sm" variant="primary" icon={PlusIcon} onClick={() => setEditing({ kind: 'schedule' })}>{t('attendance_new_schedule')}</Button>}
        >
            <p className="ui-card-note">{t('attendance_schedules_hint')}</p>
            {active.length === 0 && <p className="ui-card-note">{t('attendance_no_schedules')}</p>}
            {upcomingDefaults.length > 0 && (
                <ul className="ui-rows ui-rows-flush" aria-label={t('attendance_default_changes')}>
                    {upcomingDefaults.map(d => {
                        const line = t('attendance_default_from').replace('{name}', nameOf(d.scheduleId)).replace('{date}', dateText(d.effectiveFrom))
                        return (
                            <Row
                                key={d.id}
                                title={fill(t('attendance_default_from'), { name: <bdi>{nameOf(d.scheduleId)}</bdi>, date: dateText(d.effectiveFrom) })}
                                end={editable && (
                                    <Button size="sm" variant="quiet" aria-label={t('attendance_withdraw_named').replace('{name}', line)}
                                        onClick={() => askFirst({
                                            title: t('attendance_withdraw_title'),
                                            body: t('attendance_withdraw_default_body'),
                                            confirm: t('attendance_withdraw'),
                                            run: () => send(`/api/attendance/defaults/${d.id}`, 'DELETE', undefined, t('attendance_withdrawn')),
                                        })}>
                                        {t('attendance_withdraw')}
                                    </Button>
                                )}
                            />
                        )
                    })}
                </ul>
            )}
        </Card>
    )
}

/**
 * One schedule: its name, whether it's the default, its hours, its days and
 * how many work it; its changes to come and its seasonal hours; and what can
 * be done to it in a menu named for it.
 */
export function ScheduleCard({ ctx, schedule }: { ctx: Ctx; schedule: Schedule }) {
    const { t, locale, data, editable, send, setEditing, setMakingDefault, askFirst, weekdayName, dateText, timeRange, dateRange, digits } = ctx
    const isDefault = defaultOn(data.defaults, data.today) === schedule.id
    const willBeDefault = data.defaults.some(d => d.effectiveFrom > data.today && d.scheduleId === schedule.id)
    const current = versionOn(schedule.versions, data.today)
    const upcoming = schedule.versions.filter(v => v.effectiveFrom > data.today)
    const people = data.people.filter(p => scheduleIdOn(
        data.assignments.filter(a => a.userId === p.id), data.defaults, data.today) === schedule.id).length
    const shown = current ?? upcoming[0] ?? null
    // An upcoming version inherits the company's week in force when it starts.
    const days = shown ? workDaysOf(shown, companyWeekOn(data.companyWorkWeeks, shown.effectiveFrom > data.today ? shown.effectiveFrom : data.today)) : []
    const counted = countOf(t, locale, people, 'employees')

    const menu: MenuItem[] = [
        { key: 'hours', label: t('attendance_change_hours'), icon: ClockIcon, onSelect: () => setEditing({ kind: 'version', schedule }) },
        { key: 'override', label: t('attendance_add_seasonal'), icon: CalendarPlusIcon, onSelect: () => setEditing({ kind: 'override', schedule, override: null }) },
        ...(!isDefault ? [{ key: 'default', label: t('attendance_make_default'), icon: StarIcon, onSelect: () => setMakingDefault(schedule) }] : []),
        // The default, or one that's about to be, can't go: someone would be left on nothing.
        ...(!isDefault && !willBeDefault ? [{
            key: 'archive', label: t('attendance_archive'), icon: ArchiveIcon, danger: true,
            onSelect: () => askFirst({
                title: t('attendance_archive_title').replace('{name}', schedule.name),
                body: t('attendance_archive_body'),
                confirm: t('attendance_archive'),
                run: () => send(`/api/attendance/schedules/${schedule.id}`, 'DELETE', undefined, t('attendance_archived')),
            }),
        }] : []),
    ]

    return (
        <Card
            title={<><bdi>{schedule.name}</bdi>{isDefault && <> <StatusBadge tone="progress">{t('attendance_default')}</StatusBadge></>}</>}
            actions={editable && <RowMenu label={t('ui_more_actions_for').replace('{name}', schedule.name)} tooltip={t('ui_more_actions')} items={menu} />}
        >
            {shown ? (
                <Details items={[
                    { label: t('attendance_hours_label'), value: timeRange(shown.startMinutes, shown.endMinutes) },
                    { label: t('attendance_break_label'), value: shown.breakMinutes > 0 ? t('attendance_break_n').replace('{n}', digits(String(shown.breakMinutes))) : t('attendance_none') },
                    {
                        label: t('attendance_work_week'),
                        value: `${days.map(weekdayName).join(' ')}${shown.workWeek.length === 0 ? ` (${t('attendance_company_week')})` : ''}`,
                    },
                    // A weekday with its own hours, such as a shorter Thursday.
                    ...shown.days.map(d => ({
                        label: t('attendance_hours_on').replace('{day}', weekdayName(d.weekday)),
                        value: `${weekdayName(d.weekday)} ${timeRange(d.startMinutes, d.endMinutes)}`,
                    })),
                    { label: t('attendance_people_label'), value: isDefault ? t('attendance_people_default').replace('{count}', counted) : counted },
                ]} />
            ) : (
                <p className="ui-card-note">{t('attendance_no_hours')}</p>
            )}

            {upcoming.length > 0 && (
                <section>
                    <h3 className="ui-subsection-title">{t('attendance_changes_to_come')}</h3>
                    <ul className="ui-rows ui-rows-flush" aria-label={t('attendance_changes_to_come')}>
                        {upcoming.map(v => {
                            const from = t('attendance_from_date').replace('{date}', dateText(v.effectiveFrom))
                            return (
                                <Row
                                    key={v.id}
                                    title={from}
                                    detail={timeRange(v.startMinutes, v.endMinutes)}
                                    end={editable && (
                                        <Button size="sm" variant="quiet" aria-label={t('attendance_withdraw_named').replace('{name}', from)}
                                            onClick={() => askFirst({
                                                title: t('attendance_withdraw_title'),
                                                body: t('attendance_withdraw_hours_body'),
                                                confirm: t('attendance_withdraw'),
                                                run: () => send(`/api/attendance/versions/${v.id}`, 'DELETE', undefined, t('attendance_withdrawn')),
                                            })}>
                                            {t('attendance_withdraw')}
                                        </Button>
                                    )}
                                />
                            )
                        })}
                    </ul>
                </section>
            )}

            {schedule.overrides.length > 0 && (
                <section>
                    <h3 className="ui-subsection-title">{t('attendance_overrides')}</h3>
                    <ul className="ui-rows ui-rows-flush" aria-label={t('attendance_overrides')}>
                        {schedule.overrides.map(o => (
                            <Row
                                key={o.id}
                                title={<bdi>{o.name}</bdi>}
                                detail={t('attendance_override_line')
                                    .replace('{dates}', dateRange(o.startDate, o.endDate))
                                    .replace('{hours}', timeRange(o.startMinutes, o.endMinutes))}
                                end={editable && (
                                    <RowMenu label={t('ui_more_actions_for').replace('{name}', o.name)} tooltip={t('ui_more_actions')} items={[
                                        { key: 'edit', label: t('edit'), icon: PencilSimpleIcon, onSelect: () => setEditing({ kind: 'override', schedule, override: o }) },
                                        {
                                            key: 'remove', label: t('remove'), icon: TrashIcon, danger: true,
                                            onSelect: () => askFirst({
                                                title: t('attendance_remove_title').replace('{name}', o.name),
                                                body: t('attendance_override_remove_body'),
                                                confirm: t('remove'),
                                                run: () => send(`/api/attendance/overrides/${o.id}`, 'DELETE', undefined, t('attendance_override_deleted')),
                                            }),
                                        },
                                    ]} />
                                )}
                            />
                        ))}
                    </ul>
                </section>
            )}
        </Card>
    )
}
