'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import Modal from '@/components/Modal'
import ConfirmModal from '@/components/ConfirmModal'
import { fetcher } from '@/lib/swr-fetcher'
import { apiErrorText } from '@/lib/api-error-text'
import { policyOn, PERMISSION_TYPES, type DeductionRule, type PolicyBody, type PolicyVersion } from '@/lib/attendance/policy'

/**
 * A company's attendance policy (ATTENDANCE_PLAN.md §6): what lateness, early
 * leave, overtime and absence cost, and how permission hours work.
 *
 * Like the hours, it changes from a date (§6.1): saving asks "from when?" and
 * adds a version, so days already worked keep the rules they were measured
 * under. A template is a starting point that is copied (§6.8); editing a
 * template later changes nobody's policy.
 */

type Template = { id: string; name: string; nameAr: string | null; description: string | null; body: PolicyBody }
type PolicyData = { versions: (PolicyVersion & { appliedTemplateId: string | null })[]; templates: Template[]; today: string; canEdit: boolean }

const FRACTIONS = [0.25, 0.5, 0.75, 1]
const ABSENCE_MULTIPLIERS = [0, 1, 1.5, 2]
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

function firstOfNextMonth(today: string): string {
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/** Bands are edited as where each one ends; where it starts follows from the one before (lib/attendance/policy.ts). */
function withStarts(rule: DeductionRule, ends: { toMinutes: number | null; dayFraction: number }[]): DeductionRule {
    let from = rule.graceMinutes + 1
    const bands = ends.map(b => {
        const band = { fromMinutes: from, toMinutes: b.toMinutes, dayFraction: b.dayFraction }
        from = (b.toMinutes ?? from) + 1
        return band
    })
    return { ...rule, bands }
}

export default function AttendancePolicyPanel({ companyId, readOnly, onChanged }: { companyId: string; readOnly: boolean; onChanged: () => void }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const isRtl = locale === 'ar'
    const intl = isRtl ? 'ar-EG' : 'en-GB'

    const { data: body, mutate } = useSWR(`/api/attendance/policy?companyId=${companyId}`, fetcher)
    const data: PolicyData | null = body?.data ?? null
    const [editing, setEditing] = useState<{ start: PolicyBody; templateId: string | null } | null>(null)
    const [withdrawing, setWithdrawing] = useState<string | null>(null)

    if (!data) return null
    const editable = !readOnly && data.canEdit
    const current = policyOn(data.versions, data.today)
    const upcoming = data.versions.filter(v => v.effectiveFrom > data.today)
    const shown = current ?? upcoming[0] ?? null

    const weekday = (d: number) => new Date(Date.UTC(2026, 2, 1 + d)).toLocaleDateString(intl, { weekday: 'short', timeZone: 'UTC' })
    const dateText = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(intl, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    const fraction = (f: number) => f === 1 ? t('attendance_day_1') : f === 0.5 ? t('attendance_day_half') : f === 0.25 ? t('attendance_day_quarter') : f === 0.75 ? t('attendance_day_three_quarters') : String(f)
    const templateName = (tpl: Template) => (isRtl && tpl.nameAr) ? tpl.nameAr : tpl.name

    const ruleSummary = (rule: DeductionRule) => {
        if (!rule.enabled) return t('attendance_rule_off')
        const parts = [t('attendance_grace_n').replace('{n}', String(rule.graceMinutes))]
        if (rule.mode === 'PER_MINUTE') parts.push(t('attendance_per_minute'))
        else parts.push(rule.bands.map(b => `${b.fromMinutes}${b.toMinutes === null ? '+' : `–${b.toMinutes}`} → ${fraction(b.dayFraction)}`).join(', '))
        if (rule.freePerMonth > 0) parts.push(t('attendance_free_n').replace('{n}', String(rule.freePerMonth)))
        if (rule.monthlyCapDays !== null) parts.push(t('attendance_cap_n').replace('{n}', String(rule.monthlyCapDays)))
        return parts.join(' · ')
    }

    const save = async (payload: { effectiveFrom: string; body: PolicyBody; appliedTemplateId: string | null }) => {
        const res = await fetch('/api/attendance/policy', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyId, ...payload }),
        })
        if (!res.ok) {
            showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
            return false
        }
        showToast(t('attendance_policy_saved'), 'success')
        await mutate()
        onChanged()
        return true
    }

    return (
        <section className="glass" style={{ padding: '1.5rem', borderRadius: '1rem' }} aria-labelledby="attendance-policy">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                <div>
                    <h3 id="attendance-policy" style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>{t('attendance_policy')}</h3>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-soft)' }}>{t('attendance_policy_hint')}</p>
                </div>
                {editable && (
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <select className="input" aria-label={t('attendance_start_from_template')} style={{ width: 'auto' }} value=""
                            onChange={e => {
                                const tpl = data.templates.find(x => x.id === e.target.value)
                                if (tpl) setEditing({ start: tpl.body, templateId: tpl.id })
                            }}>
                            <option value="">{t('attendance_start_from_template')}</option>
                            {data.templates.map(tpl => <option key={tpl.id} value={tpl.id}>{templateName(tpl)}</option>)}
                        </select>
                        {shown && <button className="btn btn-primary" onClick={() => setEditing({ start: (policyOn(data.versions, firstOfNextMonth(data.today)) ?? shown).body, templateId: null })}>{t('attendance_change_policy')}</button>}
                    </div>
                )}
            </div>

            {!shown ? (
                <p style={{ margin: '1rem 0 0', color: 'var(--text-soft)', fontSize: '0.88rem' }}>{t('attendance_no_policy')}</p>
            ) : (
                <dl style={{ margin: '1rem 0 0', display: 'grid', gridTemplateColumns: 'minmax(8rem, max-content) 1fr', gap: '0.35rem 1rem', fontSize: '0.86rem' }}>
                    <dt style={{ color: 'var(--text-muted)' }}>{t('attendance_in_force')}</dt>
                    <dd style={{ margin: 0 }}>{current ? t('attendance_since_date').replace('{date}', dateText(current.effectiveFrom)) : t('attendance_from_date').replace('{date}', dateText(shown.effectiveFrom))}</dd>
                    <dt style={{ color: 'var(--text-muted)' }}>{t('attendance_work_week')}</dt>
                    <dd style={{ margin: 0 }}>{shown.body.workWeek.map(weekday).join(' ')}</dd>
                    <dt style={{ color: 'var(--text-muted)' }}>{t('attendance_lateness')}</dt>
                    <dd style={{ margin: 0 }}>{ruleSummary(shown.body.lateness)}</dd>
                    <dt style={{ color: 'var(--text-muted)' }}>{t('attendance_early_leave')}</dt>
                    <dd style={{ margin: 0 }}>{ruleSummary(shown.body.earlyLeave)}</dd>
                    <dt style={{ color: 'var(--text-muted)' }}>{t('attendance_overtime')}</dt>
                    <dd style={{ margin: 0 }}>{shown.body.overtime.enabled
                        ? `×${shown.body.overtime.multipliers.workday} / ×${shown.body.overtime.multipliers.restDay} / ×${shown.body.overtime.multipliers.holiday}${shown.body.overtime.requiresApproval ? ` · ${t('attendance_needs_approval')}` : ''}`
                        : t('attendance_rule_off')}</dd>
                    <dt style={{ color: 'var(--text-muted)' }}>{t('attendance_absence')}</dt>
                    <dd style={{ margin: 0 }}>{t('attendance_absence_n').replace('{n}', String(shown.body.absence.multiplier))}</dd>
                    <dt style={{ color: 'var(--text-muted)' }}>{t('attendance_permission_hours')}</dt>
                    <dd style={{ margin: 0 }}>{shown.body.permissionHours.enabled
                        ? t('attendance_permission_summary').replace('{h}', String(shown.body.permissionHours.monthlyAllowanceMinutes / 60))
                        : t('attendance_rule_off')}</dd>
                </dl>
            )}

            {upcoming.length > 0 && (
                <ul style={{ margin: '0.75rem 0 0', paddingInlineStart: '1.1rem', fontSize: '0.84rem' }}>
                    {upcoming.map(v => (
                        <li key={v.id}>
                            {t('attendance_policy_from').replace('{date}', dateText(v.effectiveFrom))}
                            {editable && (
                                <button style={{ marginInlineStart: '0.5rem', fontSize: '0.8rem', background: 'none', border: 'none', color: 'var(--danger-fg)', cursor: 'pointer' }}
                                    onClick={() => setWithdrawing(v.id)}>{t('attendance_withdraw')}</button>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {editing && (
                <PolicyEditor
                    companyId={companyId}
                    start={editing.start}
                    defaultFrom={shown ? firstOfNextMonth(data.today) : data.today}
                    today={data.today}
                    weekday={weekday}
                    fraction={fraction}
                    onClose={() => setEditing(null)}
                    onSave={async (effectiveFrom, policy) => {
                        if (await save({ effectiveFrom, body: policy, appliedTemplateId: editing.templateId })) setEditing(null)
                    }}
                />
            )}

            <ConfirmModal
                isOpen={!!withdrawing}
                title={t('confirm_action')}
                message={t('attendance_policy_withdraw_confirm')}
                confirmText={t('attendance_withdraw')}
                variant="warning"
                onConfirm={async () => {
                    const id = withdrawing
                    setWithdrawing(null)
                    if (!id) return
                    const res = await fetch(`/api/attendance/policy/${id}`, { method: 'DELETE' })
                    if (!res.ok) showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
                    await mutate()
                    onChanged()
                }}
                onCancel={() => setWithdrawing(null)}
            />
        </section>
    )
}

// --- The editor -------------------------------------------------------------------

const num = (value: string) => (value === '' ? 0 : Number(value))
const field = { display: 'flex', flexDirection: 'column' as const, gap: '0.25rem' }
const row = { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' as const, alignItems: 'flex-end' }
const check = { display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.86rem' }

/** Lateness or early leave: grace, bands or per minute, free occurrences, escalation, cap (§6.3). */
function RuleEditor({ name, rule, onChange, fraction }: { name: 'lateness' | 'earlyLeave'; rule: DeductionRule; onChange: (r: DeductionRule) => void; fraction: (f: number) => string }) {
const { t } = useLanguage()
    const ends = rule.bands.map(b => ({ toMinutes: b.toMinutes, dayFraction: b.dayFraction }))
    const setEnds = (next: typeof ends) => onChange(withStarts(rule, next))
    return (
        <fieldset style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.85rem', margin: 0 }}>
            <legend style={{ fontWeight: 600, padding: '0 0.35rem' }}>{name === 'lateness' ? t('attendance_lateness') : t('attendance_early_leave')}</legend>
            <label style={check}>
                <input type="checkbox" checked={rule.enabled} onChange={e => onChange({ ...rule, enabled: e.target.checked })} />
                {t('attendance_rule_on')}
            </label>
            {rule.enabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginTop: '0.6rem' }}>
                    <div style={row}>
                        <label style={field}>
                            <span className="label">{t('attendance_grace_minutes')}</span>
                            <input className="input" type="number" min={0} max={240} value={rule.graceMinutes} style={{ width: '6rem' }}
                                onChange={e => onChange(withStarts({ ...rule, graceMinutes: num(e.target.value) }, ends))} />
                        </label>
                        <label style={field}>
                            <span className="label">{t('attendance_charge')}</span>
                            <select className="input" value={rule.mode} style={{ width: 'auto' }}
                                onChange={e => onChange({ ...rule, mode: e.target.value as DeductionRule['mode'], bands: e.target.value === 'BANDS' && rule.bands.length === 0
                                    ? withStarts(rule, [{ toMinutes: null, dayFraction: 0.25 }]).bands : rule.bands })}>
                                <option value="BANDS">{t('attendance_bands')}</option>
                                <option value="PER_MINUTE">{t('attendance_per_minute')}</option>
                            </select>
                        </label>
                    </div>
                    {rule.mode === 'BANDS' && (
                        <div>
                            {rule.bands.map((b, i) => {
                                const last = i === rule.bands.length - 1
                                return (
                                    <div key={i} style={{ ...row, marginBottom: '0.35rem', alignItems: 'center', fontSize: '0.86rem' }}>
                                        <span style={{ minWidth: '6.5rem' }}>{t('attendance_from_minute').replace('{n}', String(b.fromMinutes))}</span>
                                        {last ? <span>{t('attendance_and_over')}</span> : (
                                            <input className="input" type="number" aria-label={t('attendance_to_minute')} min={b.fromMinutes} value={b.toMinutes ?? ''} style={{ width: '5.5rem' }}
                                                onChange={e => setEnds(ends.map((x, j) => j === i ? { ...x, toMinutes: num(e.target.value) } : x))} />
                                        )}
                                        <select className="input" aria-label={t('attendance_costs')} value={b.dayFraction} style={{ width: 'auto' }}
                                            onChange={e => setEnds(ends.map((x, j) => j === i ? { ...x, dayFraction: Number(e.target.value) } : x))}>
                                            {FRACTIONS.map(f => <option key={f} value={f}>{fraction(f)}</option>)}
                                        </select>
                                        {rule.bands.length > 1 && (
                                            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--danger-fg)', cursor: 'pointer', fontSize: '0.8rem' }}
                                                onClick={() => {
                                                    const next = ends.filter((_, j) => j !== i)
                                                    next[next.length - 1] = { ...next[next.length - 1], toMinutes: null }
                                                    setEnds(next)
                                                }}>{t('delete')}</button>
                                        )}
                                    </div>
                                )
                            })}
                            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}
                                onClick={() => {
                                    // The open band closes 30 minutes on, and a new open band follows it.
                                    const next = [...ends]
                                    const lastBand = rule.bands.at(-1)
                                    next[next.length - 1] = { ...next[next.length - 1], toMinutes: (lastBand?.fromMinutes ?? rule.graceMinutes + 1) + 29 }
                                    next.push({ toMinutes: null, dayFraction: 1 })
                                    setEnds(next)
                                }}>{t('attendance_add_band')}</button>
                        </div>
                    )}
                    <div style={row}>
                        <label style={field}>
                            <span className="label">{t('attendance_free_per_month')}</span>
                            <input className="input" type="number" min={0} max={31} value={rule.freePerMonth} style={{ width: '6rem' }}
                                onChange={e => onChange({ ...rule, freePerMonth: num(e.target.value) })} />
                        </label>
                        <label style={field}>
                            <span className="label">{t('attendance_cap_days')}</span>
                            <input className="input" type="number" min={0} max={31} step={0.25} placeholder={t('attendance_no_cap')} value={rule.monthlyCapDays ?? ''} style={{ width: '7rem' }}
                                onChange={e => onChange({ ...rule, monthlyCapDays: e.target.value === '' ? null : num(e.target.value) })} />
                        </label>
                    </div>
                    <label style={check}>
                        <input type="checkbox" checked={!!rule.escalation}
                            onChange={e => onChange({ ...rule, escalation: e.target.checked ? { fromOccurrence: 3, multiplier: 2 } : null })} />
                        {t('attendance_escalation')}
                    </label>
                    {rule.escalation && (
                        <div style={row}>
                            <label style={field}>
                                <span className="label">{t('attendance_escalation_from')}</span>
                                <input className="input" type="number" min={1} max={31} value={rule.escalation.fromOccurrence} style={{ width: '6rem' }}
                                    onChange={e => onChange({ ...rule, escalation: { ...rule.escalation!, fromOccurrence: Math.max(1, num(e.target.value)) } })} />
                            </label>
                            <label style={field}>
                                <span className="label">{t('attendance_escalation_times')}</span>
                                <input className="input" type="number" min={1} max={5} step={0.5} value={rule.escalation.multiplier} style={{ width: '6rem' }}
                                    onChange={e => onChange({ ...rule, escalation: { ...rule.escalation!, multiplier: Math.max(1, num(e.target.value)) } })} />
                            </label>
                        </div>
                    )}
                </div>
            )}
        </fieldset>
    )
}


/**
 * The policy's rules, edited. For a company it asks "from when?" (§6.1) and
 * can preview the draft on last month (§6.7); for a template (§6.8) it has
 * neither — a template is a starting point — and shows its own fields above.
 */
export function PolicyEditor({ companyId, start, defaultFrom, today, weekday, fraction, title, header, canSave = true, onClose, onSave }: {
    /** The company whose days a draft is replayed over; none for a template. */
    companyId?: string
    start: PolicyBody
    /** "From when?" — left out for a template, which has no date. */
    defaultFrom?: string
    today?: string
    weekday: (d: number) => string
    fraction: (f: number) => string
    title?: string
    header?: React.ReactNode
    canSave?: boolean
    onClose: () => void
    onSave: (effectiveFrom: string, policy: PolicyBody) => Promise<void>
}) {
    const { t } = useLanguage()
    const [p, setP] = useState<PolicyBody>(structuredClone(start))
    const [from, setFrom] = useState(defaultFrom ?? '')
    const [saving, setSaving] = useState(false)


    const ph = p.permissionHours
    return (
        <Modal isOpen onClose={onClose} title={title ?? t('attendance_change_policy')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {header}
                {defaultFrom !== undefined && (
                    <label style={field}>
                        <span className="label">{t('attendance_from_when')}</span>
                        <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-soft)' }}>
                            {t('attendance_policy_from_hint')}{' '}
                            {today && <button type="button" style={{ background: 'none', border: 'none', color: 'var(--brand-primary-text)', cursor: 'pointer', padding: 0 }} onClick={() => setFrom(today)}>{t('attendance_from_today')}</button>}
                        </span>
                    </label>
                )}

                <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                    <legend className="label">{t('attendance_work_week')}</legend>
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        {WEEKDAYS.map(d => (
                            <label key={d} style={check}>
                                <input type="checkbox" checked={p.workWeek.includes(d)}
                                    onChange={e => setP({ ...p, workWeek: e.target.checked ? [...p.workWeek, d].sort() : p.workWeek.filter(x => x !== d) })} />
                                {weekday(d)}
                            </label>
                        ))}
                    </div>
                </fieldset>

                <RuleEditor name="lateness" rule={p.lateness} fraction={fraction} onChange={lateness => setP({ ...p, lateness })} />
                <RuleEditor name="earlyLeave" rule={p.earlyLeave} fraction={fraction} onChange={earlyLeave => setP({ ...p, earlyLeave })} />

                <fieldset style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.85rem', margin: 0 }}>
                    <legend style={{ fontWeight: 600, padding: '0 0.35rem' }}>{t('attendance_overtime')}</legend>
                    <label style={check}>
                        <input type="checkbox" checked={p.overtime.enabled} onChange={e => setP({ ...p, overtime: { ...p.overtime, enabled: e.target.checked } })} />
                        {t('attendance_overtime_on')}
                    </label>
                    {p.overtime.enabled && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.6rem' }}>
                            <div style={row}>
                                <label style={field}>
                                    <span className="label">{t('attendance_overtime_minimum')}</span>
                                    <input className="input" type="number" min={0} max={240} value={p.overtime.minimumMinutes} style={{ width: '6rem' }}
                                        onChange={e => setP({ ...p, overtime: { ...p.overtime, minimumMinutes: num(e.target.value) } })} />
                                </label>
                                {(['workday', 'restDay', 'holiday'] as const).map(kind => (
                                    <label key={kind} style={field}>
                                        <span className="label">{t(`attendance_rate_${kind}` as any)}</span>
                                        <input className="input" type="number" min={1} max={5} step={0.05} value={p.overtime.multipliers[kind]} style={{ width: '6rem' }}
                                            onChange={e => setP({ ...p, overtime: { ...p.overtime, multipliers: { ...p.overtime.multipliers, [kind]: num(e.target.value) } } })} />
                                    </label>
                                ))}
                            </div>
                            <label style={check}>
                                <input type="checkbox" checked={p.overtime.requiresApproval} onChange={e => setP({ ...p, overtime: { ...p.overtime, requiresApproval: e.target.checked } })} />
                                {t('attendance_overtime_approval')}
                            </label>
                        </div>
                    )}
                </fieldset>

                <label style={field}>
                    <span className="label">{t('attendance_absence')}</span>
                    <select className="input" value={p.absence.multiplier} style={{ width: 'auto' }}
                        onChange={e => setP({ ...p, absence: { multiplier: Number(e.target.value) } })}>
                        {ABSENCE_MULTIPLIERS.map(m => <option key={m} value={m}>{t('attendance_absence_n').replace('{n}', String(m))}</option>)}
                    </select>
                </label>

                <fieldset style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.85rem', margin: 0 }}>
                    <legend style={{ fontWeight: 600, padding: '0 0.35rem' }}>{t('attendance_permission_hours')}</legend>
                    <label style={check}>
                        <input type="checkbox" checked={ph.enabled} onChange={e => setP({ ...p, permissionHours: { ...ph, enabled: e.target.checked } })} />
                        {t('attendance_permission_on')}
                    </label>
                    {ph.enabled && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.6rem' }}>
                            <div style={row}>
                                <label style={field}>
                                    <span className="label">{t('attendance_permission_allowance')}</span>
                                    <input className="input" type="number" min={0} max={60} step={0.5} value={ph.monthlyAllowanceMinutes / 60} style={{ width: '6rem' }}
                                        onChange={e => setP({ ...p, permissionHours: { ...ph, monthlyAllowanceMinutes: Math.round(num(e.target.value) * 60) } })} />
                                </label>
                                <label style={field}>
                                    <span className="label">{t('attendance_permission_min')}</span>
                                    <input className="input" type="number" min={1} max={1440} value={ph.minPerRequestMinutes} style={{ width: '6rem' }}
                                        onChange={e => setP({ ...p, permissionHours: { ...ph, minPerRequestMinutes: num(e.target.value) } })} />
                                </label>
                                <label style={field}>
                                    <span className="label">{t('attendance_permission_max')}</span>
                                    <input className="input" type="number" min={1} max={1440} value={ph.maxPerRequestMinutes} style={{ width: '6rem' }}
                                        onChange={e => setP({ ...p, permissionHours: { ...ph, maxPerRequestMinutes: num(e.target.value) } })} />
                                </label>
                                <label style={field}>
                                    <span className="label">{t('attendance_permission_max_requests')}</span>
                                    <input className="input" type="number" min={1} max={31} placeholder={t('attendance_no_cap')} value={ph.maxRequestsPerMonth ?? ''} style={{ width: '6rem' }}
                                        onChange={e => setP({ ...p, permissionHours: { ...ph, maxRequestsPerMonth: e.target.value === '' ? null : num(e.target.value) } })} />
                                </label>
                            </div>
                            <div style={row}>
                                <label style={field}>
                                    <span className="label">{t('attendance_permission_after')}</span>
                                    <input className="input" type="number" min={0} max={168} value={ph.afterTheFactHours} style={{ width: '6rem' }}
                                        onChange={e => setP({ ...p, permissionHours: { ...ph, afterTheFactHours: num(e.target.value) } })} />
                                </label>
                                <label style={field}>
                                    <span className="label">{t('attendance_permission_carry')}</span>
                                    <select className="input" value={ph.carryOver} style={{ width: 'auto' }}
                                        onChange={e => setP({ ...p, permissionHours: { ...ph, carryOver: e.target.value as 'LAPSE' | 'CARRY_ONCE' } })}>
                                        <option value="LAPSE">{t('attendance_carry_lapse')}</option>
                                        <option value="CARRY_ONCE">{t('attendance_carry_once')}</option>
                                    </select>
                                </label>
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                {PERMISSION_TYPES.map(type => (
                                    <label key={type} style={check}>
                                        <input type="checkbox" checked={ph.types.includes(type)}
                                            onChange={e => setP({ ...p, permissionHours: { ...ph, types: e.target.checked ? [...ph.types, type] : ph.types.filter(x => x !== type) } })} />
                                        {t(`attendance_permission_type_${type}` as any)}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                </fieldset>

                {companyId && <SimulationPreview companyId={companyId} draft={p} />}

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
                    <button className="btn btn-primary" disabled={saving || !canSave || p.workWeek.length === 0}
                        onClick={async () => { setSaving(true); try { await onSave(from, p) } finally { setSaving(false) } }}>
                        {t('save')}
                    </button>
                </div>
            </div>
        </Modal>
    )
}

type Sum = { deductionDays: number; deductionMinor: number | null; overtimeMinor: number | null; days: number }
/** Money is null for whoever may not see salaries: then the preview is in days. */
type Simulation = { month: string; moneyHidden?: boolean; people: { userId: string; name: string; current: Sum; draft: Sum }[]; totals: { current: Sum; draft: Sum } }

/**
 * "Under this rule, last month would have been…" (§6.7): the draft replayed
 * over last month's measured days, per person against the policy in force.
 * Nothing is saved. A result for an earlier draft is marked as such.
 */
function SimulationPreview({ companyId, draft }: { companyId: string; draft: PolicyBody }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const [result, setResult] = useState<{ for: string; data: Simulation } | null>(null)
    const [busy, setBusy] = useState(false)
    const key = JSON.stringify(draft)
    const money = (minor: number) => (minor / 100).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const signed = (minor: number) => (minor > 0 ? '+' : minor < 0 ? '−' : '') + money(Math.abs(minor))

    const run = async () => {
        setBusy(true)
        try {
            const res = await fetch('/api/attendance/policy/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, body: draft }) })
            const text = await res.text()
            if (!res.ok) return showToast(apiErrorText(text, t('error_generic')), 'error')
            setResult({ for: key, data: JSON.parse(text).data })
        } finally { setBusy(false) }
    }

    const data = result?.data
    const hidden = !!data?.moneyHidden
    const changed = data?.people.filter(x => x.current.deductionDays !== x.draft.deductionDays || x.current.deductionMinor !== x.draft.deductionMinor || x.current.overtimeMinor !== x.draft.overtimeMinor) ?? []
    const days = (n: number) => t('day_days').replace('{n}', String(n))
    const signedDays = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${days(Math.round(Math.abs(n) * 10_000) / 10_000)}`
    return (
        <fieldset style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.85rem', margin: 0, display: 'grid', gap: '0.6rem' }}>
            <legend style={{ fontWeight: 600, padding: '0 0.35rem' }}>{t('sim_title')}</legend>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-soft)', flex: 1, minWidth: '12rem' }}>{t('sim_hint')}</span>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={run}>{busy ? '…' : t('sim_run')}</button>
            </div>
            {data && (
                <>
                    {result.for !== key && <p role="status" style={{ margin: 0, color: 'var(--warn-fg)', fontSize: '0.82rem' }}>{t('sim_stale')}</p>}
                    <p style={{ margin: 0, fontSize: '0.88rem' }}>
                        {hidden
                            ? t('sim_summary_days')
                                .replace('{month}', data.month)
                                .replace('{now}', days(data.totals.current.deductionDays))
                                .replace('{then}', days(data.totals.draft.deductionDays))
                            : t('sim_summary')
                                .replace('{month}', data.month)
                                .replace('{now}', money(data.totals.current.deductionMinor ?? 0))
                                .replace('{then}', money(data.totals.draft.deductionMinor ?? 0))
                                .replace('{diff}', signed((data.totals.draft.deductionMinor ?? 0) - (data.totals.current.deductionMinor ?? 0)))}
                        {!hidden && data.totals.current.overtimeMinor !== data.totals.draft.overtimeMinor && (
                            <> {t('sim_overtime').replace('{diff}', signed((data.totals.draft.overtimeMinor ?? 0) - (data.totals.current.overtimeMinor ?? 0)))}</>
                        )}
                    </p>
                    {data.totals.current.days === 0 ? <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-soft)' }}>{t('sim_no_days')}</p>
                        : changed.length === 0 ? <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-soft)' }}>{t('sim_no_change')}</p>
                            : (
                                <div style={{ overflowX: 'auto' }}>
                                    <table className="table" style={{ width: '100%', fontSize: '0.82rem' }}>
                                        <thead><tr><th>{t('sim_person')}</th><th>{t('sim_now')}</th><th>{t('sim_draft')}</th><th>{t('sim_difference')}</th></tr></thead>
                                        <tbody>
                                            {changed.map(x => (
                                                <tr key={x.userId}>
                                                    <td>{x.name}</td>
                                                    <td>{hidden ? days(x.current.deductionDays) : <><bdi>{money(x.current.deductionMinor ?? 0)}</bdi><div style={{ color: 'var(--text-soft)', fontSize: '0.75rem' }}>{days(x.current.deductionDays)}</div></>}</td>
                                                    <td>{hidden ? days(x.draft.deductionDays) : <><bdi>{money(x.draft.deductionMinor ?? 0)}</bdi><div style={{ color: 'var(--text-soft)', fontSize: '0.75rem' }}>{days(x.draft.deductionDays)}</div></>}</td>
                                                    <td style={{ fontWeight: 600 }}>
                                                        <bdi>{hidden ? signedDays(x.draft.deductionDays - x.current.deductionDays) : signed((x.draft.deductionMinor ?? 0) - (x.current.deductionMinor ?? 0))}</bdi>
                                                        {!hidden && x.current.overtimeMinor !== x.draft.overtimeMinor && (
                                                            <div style={{ color: 'var(--text-soft)', fontSize: '0.75rem', fontWeight: 400 }}>{t('sim_overtime').replace('{diff}', signed((x.draft.overtimeMinor ?? 0) - (x.current.overtimeMinor ?? 0)))}</div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                </>
            )}
        </fieldset>
    )
}
