'use client'

import { PlusIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, Field, Row, Select, StatusBadge } from '@/components/ui'
import { yearsAround } from '@/lib/period-address'
import { publicHolidaysApplyOn } from '@/lib/attendance/calendar'
import type { Ctx } from './types'

/**
 * The holidays a company observes (ATTENDANCE_PLAN.md §7.2) in the year
 * picked: the public ones, each a box ticked while it's observed, and the
 * company's own, each removable. Adding one is a dialog of its own.
 *
 * Above the public ones, whether they apply at all (FIRST_CHANGES_PLAN.md §6,
 * DESIGN.md §5.5, PR 362): the switch, a change to come with Withdraw, and,
 * while they're off, each one from then worked through, with no box.
 */
export function HolidaysCard({ ctx }: { ctx: Ctx }) {
    const { t, locale, data, editable, busy, send, askFirst, dateText, companyId, setYear, setAddingHoliday, setTurningPublic } = ctx
    const h = data.holidays
    const { changes } = data.publicHolidays
    const appliesNow = publicHolidaysApplyOn(changes, data.today)
    // At most one, as a change waits for any to come before it.
    const coming = changes.filter(c => c.effectiveFrom > data.today)
    const begun = changes.filter(c => c.effectiveFrom <= data.today)
    const offSince = appliesNow ? null : begun.at(-1)?.effectiveFrom ?? null
    // The change the first of the year's holidays that doesn't apply falls under, for the line above them.
    const firstOff = h.public.find(p => !p.applies)
    const offFrom = firstOff ? changes.filter(c => c.effectiveFrom <= firstOff.date).at(-1)?.effectiveFrom ?? null : null
    const digits = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const years = yearsAround(Number(data.today.slice(0, 4)), h.year)
        .map(y => ({ value: String(y), label: y.toLocaleString(digits, { useGrouping: false }) }))

    return (
        <Card
            title={t('attendance_holidays')}
            actions={editable && <Button size="sm" icon={PlusIcon} onClick={() => setAddingHoliday(true)}>{t('attendance_add_holiday')}</Button>}
        >
            <p className="ui-card-note">{t('attendance_holidays_hint')}</p>
            {/* The year the holidays are about, picked as a page's period is (DESIGN.md §5.3). */}
            <Field label={t('year')}>{p => (
                <Select {...p} name="year" value={String(h.year)} onChange={e => setYear(Number(e.target.value))} options={years} />
            )}</Field>

            <section>
                <h3 className="ui-subsection-title">{t('attendance_public_holidays')}</h3>
                {/* Whether they apply at all, and a change to come (PR 362). */}
                <ul className="ui-rows ui-rows-flush ui-public-switch" aria-label={t('attendance_public_apply')}>
                    <Row
                        title={t('attendance_public_apply')}
                        detail={offSince ? t('attendance_public_off_hint').replace('{date}', dateText(offSince)) : t('attendance_public_on_hint')}
                        end={<>
                            <StatusBadge tone={appliesNow ? 'good' : 'neutral'}>{t(appliesNow ? 'attendance_public_on_badge' : 'attendance_public_off_badge')}</StatusBadge>
                            {/* While a change is to come, it's withdrawn first. */}
                            {editable && coming.length === 0 && (appliesNow
                                ? <Button size="sm" disabled={busy} onClick={() => setTurningPublic(false)}>{t('settings_turn_off')}</Button>
                                : <Button size="sm" variant="primary" disabled={busy} onClick={() => setTurningPublic(true)}>{t('settings_turn_on')}</Button>)}
                        </>}
                    />
                    {coming.map(c => {
                        const line = t(c.apply ? 'attendance_public_coming_on' : 'attendance_public_coming_off').replace('{date}', dateText(c.effectiveFrom))
                        return (
                            <Row
                                key={c.id}
                                title={line}
                                end={editable && (
                                    <Button size="sm" variant="quiet" aria-label={t('attendance_withdraw_named').replace('{name}', line)}
                                        onClick={() => askFirst({
                                            title: t('attendance_withdraw_title'),
                                            body: t('attendance_public_withdraw_body'),
                                            confirm: t('attendance_withdraw'),
                                            run: () => send(`/api/attendance/holidays/apply/${c.id}`, 'DELETE', undefined, t('attendance_withdrawn')),
                                        })}>
                                        {t('attendance_withdraw')}
                                    </Button>
                                )}
                            />
                        )
                    })}
                </ul>
                {offFrom && <p className="ui-card-note">{t('attendance_public_off_note').replace('{date}', dateText(offFrom))}</p>}
                {h.public.length === 0 ? (
                    <p className="ui-card-note">{t('attendance_no_holidays')}</p>
                ) : (
                    // Ticked: a day off. Unticked: the company works through it.
                    // While public holidays are off on its date, it's worked
                    // through whatever its box says, so it has none.
                    <div role="group" aria-label={t('attendance_public_holidays')}>
                        {h.public.map(p => p.applies ? (
                            <label key={p.id} className="ui-choice" data-disabled={!editable || undefined}>
                                <input type="checkbox" className="ui-check" checked={p.observed} disabled={!editable || busy}
                                    onChange={e => { void send('/api/attendance/holidays/observed', 'PUT', { companyId, publicHolidayId: p.id, observed: e.target.checked }, t('settings_saved_success')) }} />
                                <bdi>{locale === 'ar' && p.nameAr ? p.nameAr : p.name}</bdi>
                                <span className="ui-hint">{dateText(p.date)}</span>
                                {!p.observed && <StatusBadge tone="neutral">{t('attendance_worked_through')}</StatusBadge>}
                            </label>
                        ) : (
                            <div key={p.id} className="ui-choice ui-public-off">
                                <bdi>{locale === 'ar' && p.nameAr ? p.nameAr : p.name}</bdi>
                                <span className="ui-hint">{dateText(p.date)}</span>
                                <StatusBadge tone="neutral">{t('attendance_worked_through')}</StatusBadge>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section>
                <h3 className="ui-subsection-title">{t('attendance_own_holidays')}</h3>
                {h.own.length === 0 ? (
                    <p className="ui-card-note">{t('attendance_no_own_holidays')}</p>
                ) : (
                    <ul className="ui-rows ui-rows-flush" aria-label={t('attendance_own_holidays')}>
                        {h.own.map(o => (
                            <Row
                                key={o.id}
                                title={<bdi>{o.name}</bdi>}
                                detail={dateText(o.date)}
                                end={<>
                                    {!o.isPaid && <StatusBadge tone="neutral">{t('attendance_unpaid')}</StatusBadge>}
                                    {editable && (
                                        <Button size="sm" variant="quiet" aria-label={t('attendance_remove_named').replace('{name}', o.name)}
                                            onClick={() => askFirst({
                                                title: t('attendance_remove_title').replace('{name}', o.name),
                                                body: t('attendance_holiday_remove_body').replace('{date}', dateText(o.date)),
                                                confirm: t('remove'),
                                                run: () => send(`/api/attendance/holidays/${o.id}`, 'DELETE', undefined, t('attendance_holiday_removed')),
                                            })}>
                                            {t('remove')}
                                        </Button>
                                    )}
                                </>}
                            />
                        ))}
                    </ul>
                )}
            </section>
        </Card>
    )
}
