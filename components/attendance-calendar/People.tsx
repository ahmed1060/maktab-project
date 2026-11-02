'use client'

import { useMemo } from 'react'
import { UsersThreeIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, Row } from '@/components/ui'
import { scheduleIdOn } from '@/lib/attendance/calendar'
import { fill } from './fill'
import type { Ctx } from './types'

/**
 * Who works which schedule (ATTENDANCE_PLAN.md §7.3): each person with the
 * schedule they're on and the move to come, which can be withdrawn. Moving
 * people is a dialog of its own (MoveDialog).
 */
export function PeopleCard({ ctx }: { ctx: Ctx }) {
    const { t, data, active, editable, send, askFirst, dateText, setMoving } = ctx

    const rows = useMemo(() => data.people.map(p => {
        const mine = data.assignments.filter(a => a.userId === p.id)
        const now = scheduleIdOn(mine, data.defaults, data.today)
        const next = mine.filter(a => a.effectiveFrom > data.today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0]
        return { ...p, now, next, explicit: mine.some(a => a.effectiveFrom <= data.today) }
    }), [data])
    const nameOf = (id: string | null | undefined) => data.schedules.find(s => s.id === id)?.name ?? t('attendance_none')

    // Nothing to move anybody to until there's a schedule.
    if (active.length === 0) return null
    return (
        <Card
            title={t('attendance_who_works_which')}
            actions={editable && rows.length > 0 && <Button size="sm" icon={UsersThreeIcon} onClick={() => setMoving(true)}>{t('attendance_move_people')}</Button>}
        >
            <p className="ui-card-note">{t('attendance_who_works_which_hint')}</p>
            {rows.length === 0 ? (
                <p className="ui-card-note">{t('attendance_no_people')}</p>
            ) : (
                <ul className="ui-rows ui-rows-flush" aria-label={t('attendance_who_works_which')}>
                    {rows.map(r => {
                        const next = r.next && t('attendance_next_move').replace('{name}', nameOf(r.next.scheduleId)).replace('{date}', dateText(r.next.effectiveFrom))
                        return (
                            <Row
                                key={r.id}
                                title={<bdi>{r.name}</bdi>}
                                // Someone not moved anywhere is on the default, which says so.
                                detail={!r.explicit && r.now ? fill(t('attendance_on_default'), { name: <bdi>{nameOf(r.now)}</bdi> }) : <bdi>{nameOf(r.now)}</bdi>}
                                end={next && r.next && (
                                    <>
                                        <span className="ui-hint">{fill(t('attendance_next_move'), { name: <bdi>{nameOf(r.next.scheduleId)}</bdi>, date: dateText(r.next.effectiveFrom) })}</span>
                                        {editable && (
                                            <Button size="sm" variant="quiet" aria-label={t('attendance_withdraw_named').replace('{name}', next)}
                                                onClick={() => askFirst({
                                                    title: t('attendance_withdraw_title'),
                                                    body: t('attendance_withdraw_move_body').replace('{name}', r.name),
                                                    confirm: t('attendance_withdraw'),
                                                    run: () => send(`/api/attendance/assignments/${r.next!.id}`, 'DELETE', undefined, t('attendance_withdrawn')),
                                                })}>
                                                {t('attendance_withdraw')}
                                            </Button>
                                        )}
                                    </>
                                )}
                            />
                        )
                    })}
                </ul>
            )}
        </Card>
    )
}
