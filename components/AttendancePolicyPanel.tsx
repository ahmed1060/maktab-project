'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { CopyIcon, HourglassIcon, PencilSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { apiErrorText } from '@/lib/api-error-text'
import { countOf } from '@/lib/plural'
import { policyOn, type DeductionRule, type PolicyBody, type PolicyVersion } from '@/lib/attendance/policy'
import { Button, Card, Choice, Details, Dialog, EmptyState, Row } from '@/components/ui'
import { firstOfNextMonth } from '@/components/attendance-calendar/hours-form'
import PolicyDialog from '@/components/attendance-policy/PolicyDialog'

/**
 * A company's attendance policy (ATTENDANCE_PLAN.md §6): what lateness, early
 * leave, overtime and absence cost, and how permission hours work.
 *
 * Like the hours, it changes from a date (§6.1): saving asks "from when?" and
 * adds a version, so days already worked keep the rules they were measured
 * under. A template is a starting point that is copied (§6.8); editing a
 * template later changes nobody's policy.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 3b): a
 * card with the policy in force as details, each rule a line at a time, and
 * the policies to come, each withdrawn after asking.
 */

type Template = { id: string; name: string; nameAr: string | null; description: string | null; body: PolicyBody }
type PolicyData = { versions: (PolicyVersion & { appliedTemplateId: string | null })[]; templates: Template[]; today: string; canEdit: boolean }

export default function AttendancePolicyPanel({ companyId, readOnly, onChanged }: { companyId: string; readOnly: boolean; onChanged: () => void }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const isRtl = locale === 'ar'
    const intl = isRtl ? 'ar-EG' : 'en-GB'

    const { data: body, error, isValidating, mutate } = useSWR(`/api/attendance/policy?companyId=${companyId}`, fetcher)
    const data: PolicyData | null = body?.data ?? null
    const [editing, setEditing] = useState<{ start: PolicyBody; templateId: string | null } | null>(null)
    const [choosing, setChoosing] = useState<string | null>(null)
    const [withdrawing, setWithdrawing] = useState<PolicyVersion | null>(null)
    const [busy, setBusy] = useState(false)

    if (!data) return error ? (
        <div className="ui-panel">
            <EmptyState icon={WarningCircleIcon} title={t('attendance_policy_load_failed')} detail={(error as SWRError).info?.error}
                action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
        </div>
    ) : (
        <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
    )

    const editable = !readOnly && data.canEdit
    const current = policyOn(data.versions, data.today)
    const upcoming = data.versions.filter(v => v.effectiveFrom > data.today)
    const shown = current ?? upcoming[0] ?? null

    // Numbers in the page's digits, as its dates are (DESIGN.md §3.3).
    const number = (n: number) => n.toLocaleString(intl, { maximumFractionDigits: 2 })
    const weekdayName = (d: number) => new Date(Date.UTC(2026, 2, 1 + d)).toLocaleDateString(intl, { weekday: 'short', timeZone: 'UTC' })
    const dateText = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(intl, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    const fraction = (f: number) => f === 1 ? t('attendance_day_1') : f === 0.5 ? t('attendance_day_half') : f === 0.25 ? t('attendance_day_quarter') : f === 0.75 ? t('attendance_day_three_quarters') : number(f)
    const templateName = (tpl: Template) => (isRtl && tpl.nameAr) ? tpl.nameAr : tpl.name
    const lines = (items: string[]) => <ul className="ui-detail-lines">{items.map((line, i) => <li key={i}>{line}</li>)}</ul>

    /** A rule in words, a line each: its grace, how it charges, the free ones and the cap. */
    const ruleLines = (rule: DeductionRule) => {
        if (!rule.enabled) return t('attendance_rule_off')
        const out = [t('attendance_grace_n').replace('{n}', number(rule.graceMinutes))]
        if (rule.mode === 'PER_MINUTE') out.push(t('attendance_per_minute'))
        else for (const b of rule.bands) {
            out.push(b.toMinutes === null
                ? t('attendance_band_open_line').replace('{from}', number(b.fromMinutes)).replace('{cost}', fraction(b.dayFraction))
                : t('attendance_band_line').replace('{from}', number(b.fromMinutes)).replace('{to}', number(b.toMinutes)).replace('{cost}', fraction(b.dayFraction)))
        }
        if (rule.freePerMonth > 0) out.push(t('attendance_free_line').replace('{times}', countOf(t, locale, rule.freePerMonth, 'times')))
        if (rule.monthlyCapDays !== null) out.push(t('attendance_cap_line').replace('{days}', countOf(t, locale, rule.monthlyCapDays, 'days')))
        return lines(out)
    }

    const save = async (payload: { effectiveFrom: string; body: PolicyBody; appliedTemplateId: string | null }) => {
        try {
            const res = await fetch('/api/attendance/policy', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId, ...payload }),
            })
            if (!res.ok) {
                showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
                return false
            }
        } catch {
            showToast(t('error_generic'), 'error')
            return false
        }
        showToast(t('attendance_policy_saved'), 'success')
        await mutate()
        onChanged()
        return true
    }

    /** Withdraws a policy to come; the dialog stays open, its button busy, until it's done. */
    const withdraw = async () => {
        if (!withdrawing) return
        setBusy(true)
        try {
            const res = await fetch(`/api/attendance/policy/${withdrawing.id}`, { method: 'DELETE' })
            if (!res.ok) {
                showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
                return
            }
            showToast(t('attendance_withdrawn'), 'success')
            setWithdrawing(null)
            await mutate()
            onChanged()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    const fromTemplate = editable && data.templates.length > 0 && (
        <Button variant={shown ? 'secondary' : 'primary'} icon={CopyIcon} onClick={() => setChoosing(data.templates[0].id)}>{t('attendance_start_from_template')}</Button>
    )

    return (
        <Card
            title={t('attendance_policy')}
            actions={editable && (
                <>
                    {fromTemplate}
                    {shown && (
                        <Button variant="primary" icon={PencilSimpleIcon}
                            onClick={() => setEditing({ start: (policyOn(data.versions, firstOfNextMonth(data.today)) ?? shown).body, templateId: null })}>
                            {t('attendance_change_policy')}
                        </Button>
                    )}
                </>
            )}
        >
            <p className="ui-card-note">{t('attendance_policy_hint')}</p>

            {!shown ? (
                <p className="ui-card-note">{t('attendance_no_policy')}</p>
            ) : (
                <Details items={[
                    { label: t('attendance_in_force'), value: current ? t('attendance_since_date').replace('{date}', dateText(current.effectiveFrom)) : t('attendance_from_date').replace('{date}', dateText(shown.effectiveFrom)) },
                    { label: t('attendance_work_week'), value: shown.body.workWeek.map(weekdayName).join(' ') },
                    // How a day is read (§6.9, PR 273).
                    { label: t('attendance_scans'), value: t('attendance_scans_line').replace('{minutes}', countOf(t, locale, shown.body.scanWindowMinutes, 'minutes')) },
                    { label: t('attendance_lateness'), value: ruleLines(shown.body.lateness) },
                    { label: t('attendance_early_leave'), value: ruleLines(shown.body.earlyLeave) },
                    {
                        label: t('attendance_overtime'),
                        value: shown.body.overtime.enabled ? lines([
                            t('attendance_overtime_rates')
                                .replace('{workday}', number(shown.body.overtime.multipliers.workday))
                                .replace('{restDay}', number(shown.body.overtime.multipliers.restDay))
                                .replace('{holiday}', number(shown.body.overtime.multipliers.holiday)),
                            ...(shown.body.overtime.requiresApproval ? [t('attendance_overtime_approved_only')] : []),
                        ]) : t('attendance_rule_off'),
                    },
                    {
                        label: t('attendance_absence'),
                        value: lines([shown.body.absence.multiplier === 0
                            ? t('attendance_absence_none_line')
                            : t('attendance_absence_line').replace('{days}', countOf(t, locale, shown.body.absence.multiplier, 'days'))]),
                    },
                    {
                        label: t('attendance_permission_hours'),
                        value: shown.body.permissionHours.enabled
                            ? lines([t('attendance_permission_line').replace('{hours}', countOf(t, locale, shown.body.permissionHours.monthlyAllowanceMinutes / 60, 'hours'))])
                            : t('attendance_rule_off'),
                    },
                ]} />
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
                                    end={editable && (
                                        <Button size="sm" variant="quiet" aria-label={t('attendance_withdraw_named').replace('{name}', from)} onClick={() => setWithdrawing(v)}>
                                            {t('attendance_withdraw')}
                                        </Button>
                                    )}
                                />
                            )
                        })}
                    </ul>
                </section>
            )}

            {/* Which template to start from, with what each is for. */}
            <Dialog
                open={choosing !== null}
                onClose={() => setChoosing(null)}
                title={t('attendance_start_from_template')}
                actions={<>
                    <Button onClick={() => setChoosing(null)}>{t('cancel')}</Button>
                    <Button variant="primary" onClick={() => {
                        const tpl = data.templates.find(x => x.id === choosing)
                        setChoosing(null)
                        if (tpl) setEditing({ start: tpl.body, templateId: tpl.id })
                    }}>{t('attendance_template_use')}</Button>
                </>}
            >
                <p>{t('attendance_templates_hint')}</p>
                <Choice
                    legend={t('attendance_templates_legend')}
                    name="template"
                    value={choosing ?? ''}
                    onChange={setChoosing}
                    options={data.templates.map(tpl => ({
                        value: tpl.id,
                        label: (
                            <span className="ui-choice-text">
                                <bdi>{templateName(tpl)}</bdi>
                                {tpl.description && <span className="ui-hint">{tpl.description}</span>}
                            </span>
                        ),
                    }))}
                />
            </Dialog>

            {editing && (
                <PolicyDialog
                    title={t('attendance_change_policy')}
                    companyId={companyId}
                    start={editing.start}
                    startOn={editing.templateId ? undefined : date => policyOn(data.versions, date)?.body ?? null}
                    defaultFrom={shown ? firstOfNextMonth(data.today) : data.today}
                    today={data.today}
                    weekdayName={weekdayName}
                    onClose={() => setEditing(null)}
                    onSave={async (effectiveFrom, policy) => {
                        if (await save({ effectiveFrom, body: policy, appliedTemplateId: editing.templateId })) setEditing(null)
                    }}
                />
            )}

            {/* Withdrawing a policy to come can't be taken back by itself: asked about first. */}
            <Dialog
                open={!!withdrawing}
                onClose={() => { if (!busy) setWithdrawing(null) }}
                title={t('attendance_withdraw_title')}
                actions={<>
                    <Button onClick={() => setWithdrawing(null)} disabled={busy}>{t('cancel')}</Button>
                    <Button variant="danger" busy={busy} onClick={() => { void withdraw() }}>{t('attendance_withdraw')}</Button>
                </>}
            >
                <p>{t('attendance_policy_withdraw_body')}</p>
            </Dialog>
        </Card>
    )
}
