'use client'

import { useId } from 'react'
import { PlusIcon } from '@phosphor-icons/react/ssr'
import { Button, Field, Select, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { bandStarts, type RuleForm } from './policy-form'

const FRACTIONS = [0.25, 0.5, 0.75, 1]

/**
 * Lateness or early leave (ATTENDANCE_PLAN.md §6.3): a grace period, then
 * bands or a charge per minute, free occurrences, a monthly cap, and more for
 * repeats. Each band is named by where it starts, which follows from the
 * grace and the band before; the last runs on.
 */
export default function RuleFields({ name, rule, errorOf, fraction, number, onChange }: {
    name: 'lateness' | 'earlyLeave'
    rule: RuleForm
    errorOf: (path: string) => string | undefined
    fraction: (f: number) => string
    number: (n: number) => string
    /** The rule as changed, and the fields whose errors the change answers. */
    onChange: (rule: RuleForm, fields: string[]) => void
}) {
    const { t } = useLanguage()
    const id = useId()
    const starts = bandStarts(rule)
    const path = (field: string) => `${name}.${field}`
    const set = (patch: Partial<RuleForm>, ...fields: string[]) => onChange({ ...rule, ...patch }, fields.map(path))
    const setBands = (bands: RuleForm['bands']) => set({ bands }, 'bands')
    // A band saved with a cost not on the list keeps it as a choice.
    const fractions = [...new Set([...FRACTIONS, ...rule.bands.map(b => b.dayFraction)])].sort((a, b) => a - b)

    const addBand = () => {
        // The open band closes 30 minutes on, and a new open band follows it.
        const last = rule.bands.length - 1
        if (last < 0) return setBands([{ toMinutes: null, dayFraction: 0.25 }])
        const from = starts[last] ?? 1
        setBands([...rule.bands.map((b, i) => i === last ? { ...b, toMinutes: String(from + 29) } : b), { toMinutes: null, dayFraction: 1 }])
    }
    const removeBand = (i: number) => {
        const next = rule.bands.filter((_, j) => j !== i)
        next[next.length - 1] = { ...next[next.length - 1], toMinutes: null }
        setBands(next)
    }

    return (
        <fieldset className="ui-fieldset">
            <legend className="ui-subsection-title">{name === 'lateness' ? t('attendance_lateness') : t('attendance_early_leave')}</legend>
            <div className="ui-field-group">
                <label className="ui-choice">
                    <input type="checkbox" className="ui-check" checked={rule.enabled} onChange={e => set({ enabled: e.target.checked }, 'enabled')} />
                    {t('attendance_rule_on')}
                </label>
                {rule.enabled && (
                    <>
                        <div className="ui-field-row">
                            <Field label={t('attendance_grace_minutes')} error={errorOf(path('graceMinutes'))}>{p => (
                                <TextInput {...p} type="number" inputMode="numeric" autoComplete="off" min={0} max={24 * 60} name={path('graceMinutes')} value={rule.graceMinutes}
                                    // The bands start from the grace, so their errors go with it.
                                    onChange={e => set({ graceMinutes: e.target.value }, 'graceMinutes', 'bands')} />
                            )}</Field>
                            <Field label={t('attendance_charge')}>{p => (
                                <Select {...p} value={rule.mode}
                                    options={[{ value: 'BANDS', label: t('attendance_bands') }, { value: 'PER_MINUTE', label: t('attendance_per_minute') }]}
                                    onChange={e => {
                                        const mode = e.target.value as RuleForm['mode']
                                        set({ mode, bands: mode === 'BANDS' && rule.bands.length === 0 ? [{ toMinutes: null, dayFraction: 0.25 }] : rule.bands }, 'bands')
                                    }} />
                            )}</Field>
                        </div>

                        {rule.mode === 'BANDS' && (
                            <fieldset className="ui-fieldset">
                                <legend className="ui-label">{t('attendance_bands_legend')}</legend>
                                <div className="ui-bands">
                                    {rule.bands.map((b, i) => {
                                        const from = starts[i] === null ? '–' : number(starts[i]!)
                                        const error = errorOf(path(`bands.${i}`))
                                        const errorId = `${id}-band-${i}`
                                        return (
                                            <div key={i} className="ui-field">
                                                {/* Where it starts, with Remove; under it, its end and its cost side by side. */}
                                                <div className="ui-band">
                                                    <div className="ui-band-head">
                                                        <span className="ui-band-from">{t('attendance_from_minute').replace('{n}', from)}</span>
                                                        {rule.bands.length > 1 && (
                                                            <Button size="sm" variant="quiet" aria-label={t('attendance_band_remove').replace('{n}', from)} onClick={() => removeBand(i)}>
                                                                {t('remove')}
                                                            </Button>
                                                        )}
                                                    </div>
                                                    <div className="ui-band-fields">
                                                        {b.toMinutes === null ? <span className="ui-band-open">{t('attendance_and_over')}</span> : (
                                                            <TextInput type="number" inputMode="numeric" autoComplete="off" min={starts[i] ?? 0} max={24 * 60} name={path(`bands.${i}`)} value={b.toMinutes}
                                                                aria-label={t('attendance_band_end_label').replace('{n}', from)}
                                                                aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
                                                                onChange={e => setBands(rule.bands.map((x, j) => j === i ? { ...x, toMinutes: e.target.value } : x))} />
                                                        )}
                                                        <Select aria-label={t('attendance_band_cost_label').replace('{n}', from)} value={String(b.dayFraction)}
                                                            options={fractions.map(f => ({ value: String(f), label: fraction(f) }))}
                                                            onChange={e => setBands(rule.bands.map((x, j) => j === i ? { ...x, dayFraction: Number(e.target.value) } : x))} />
                                                    </div>
                                                </div>
                                                {error && <span id={errorId} className="ui-error">{error}</span>}
                                            </div>
                                        )
                                    })}
                                    <div>
                                        <Button size="sm" icon={PlusIcon} onClick={addBand}>{t('attendance_add_band')}</Button>
                                    </div>
                                </div>
                            </fieldset>
                        )}

                        <div className="ui-field-row">
                            <Field label={t('attendance_free_per_month')} error={errorOf(path('freePerMonth'))}>{p => (
                                <TextInput {...p} type="number" inputMode="numeric" autoComplete="off" min={0} max={31} name={path('freePerMonth')} value={rule.freePerMonth}
                                    onChange={e => set({ freePerMonth: e.target.value }, 'freePerMonth')} />
                            )}</Field>
                            <Field label={t('attendance_cap_days')} hint={t('attendance_no_cap_hint')} error={errorOf(path('monthlyCapDays'))}>{p => (
                                <TextInput {...p} type="number" inputMode="decimal" autoComplete="off" min={0} max={31} step={0.25} name={path('monthlyCapDays')} value={rule.monthlyCapDays}
                                    onChange={e => set({ monthlyCapDays: e.target.value }, 'monthlyCapDays')} />
                            )}</Field>
                        </div>

                        <label className="ui-choice">
                            <input type="checkbox" className="ui-check" checked={!!rule.escalation}
                                onChange={e => set({ escalation: e.target.checked ? { fromOccurrence: '3', multiplier: '2' } : null }, 'escalation.fromOccurrence', 'escalation.multiplier')} />
                            {t('attendance_escalation')}
                        </label>
                        {rule.escalation && (
                            <div className="ui-field-row">
                                <Field label={t('attendance_escalation_from')} error={errorOf(path('escalation.fromOccurrence'))}>{p => (
                                    <TextInput {...p} type="number" inputMode="numeric" autoComplete="off" min={1} max={31} name={path('escalation.fromOccurrence')} value={rule.escalation!.fromOccurrence}
                                        onChange={e => set({ escalation: { ...rule.escalation!, fromOccurrence: e.target.value } }, 'escalation.fromOccurrence')} />
                                )}</Field>
                                <Field label={t('attendance_escalation_times')} error={errorOf(path('escalation.multiplier'))}>{p => (
                                    <TextInput {...p} type="number" inputMode="decimal" autoComplete="off" min={1} max={5} step={0.5} name={path('escalation.multiplier')} value={rule.escalation!.multiplier}
                                        onChange={e => set({ escalation: { ...rule.escalation!, multiplier: e.target.value } }, 'escalation.multiplier')} />
                                )}</Field>
                            </div>
                        )}
                    </>
                )}
            </div>
        </fieldset>
    )
}
