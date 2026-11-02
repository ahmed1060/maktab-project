'use client'

import { PlusIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, Field, Row, Select, StatusBadge } from '@/components/ui'
import { yearsAround } from '@/lib/period-address'
import type { Ctx } from './types'

/**
 * The holidays a company observes (ATTENDANCE_PLAN.md §7.2) in the year
 * picked: the public ones, each a box ticked while it's observed, and the
 * company's own, each removable. Adding one is a dialog of its own.
 */
export function HolidaysCard({ ctx }: { ctx: Ctx }) {
    const { t, locale, data, editable, busy, send, askFirst, dateText, companyId, setYear, setAddingHoliday } = ctx
    const h = data.holidays
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
                {h.public.length === 0 ? (
                    <p className="ui-card-note">{t('attendance_no_holidays')}</p>
                ) : (
                    // Ticked: a day off. Unticked: the company works through it.
                    <div role="group" aria-label={t('attendance_public_holidays')}>
                        {h.public.map(p => (
                            <label key={p.id} className="ui-choice" data-disabled={!editable || undefined}>
                                <input type="checkbox" className="ui-check" checked={p.observed} disabled={!editable || busy}
                                    onChange={e => { void send('/api/attendance/holidays/observed', 'PUT', { companyId, publicHolidayId: p.id, observed: e.target.checked }, t('settings_saved_success')) }} />
                                <bdi>{locale === 'ar' && p.nameAr ? p.nameAr : p.name}</bdi>
                                <span className="ui-hint">{dateText(p.date)}</span>
                                {!p.observed && <StatusBadge tone="neutral">{t('attendance_worked_through')}</StatusBadge>}
                            </label>
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
