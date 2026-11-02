'use client'

import { Fragment, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, Card, Dialog, DialogActions, Field, TextInput } from '@/components/ui'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useReportUnsaved } from '@/lib/useUnsavedChanges'
import type { TranslationKey } from '@/lib/translations'
import {
    MAX_MODULE_LABEL_LENGTH,
    MODULES,
    MODULE_KEYS,
    isModuleKey,
    isValidModuleIcon,
    modulesFrom,
    parseModuleIcons,
    parseModuleOverrides,
    sameOverrides,
    type ModuleKey,
    type ModuleOverrides,
} from '@/lib/modules'
import { COMPANY_GROUPS } from '@/lib/side-bar'

/**
 * What a company calls each module, and its icon, in the Super Admin's
 * settings for it: renamed everywhere they appear, with the side bar as it
 * would be, before saving.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 4a): a
 * field per module, named for it, its icon a button that opens a dialog.
 */

/**
 * A palette, not an emoji keyboard.
 *
 * Rendering all ~3,800 emoji would need a searchable index, skin-tone and
 * variation handling, and a virtualised grid — a component in its own right,
 * for a setting that gets touched once when a company is onboarded. These are
 * the ones a business module plausibly wants; anything else is one paste away
 * in the field underneath, which accepts any emoji at all.
 */
const PALETTE = [
    '📊', '📈', '📉', '🗂️', '📋', '📁', '🗃️', '📅', '🗓️', '⏰',
    '✅', '☑️', '📌', '📍', '🎯', '🏁', '🚩', '⭐', '🔖', '🏷️',
    '📩', '📨', '✉️', '📬', '📣', '🔔', '💬', '📝', '🖊️', '📑',
    '🤝', '👥', '👤', '🧑‍💼', '👔', '🏢', '🏬', '🏭', '🗄️', '🔑',
    '💰', '💵', '💳', '🧾', '🏦', '📦', '🚚', '🛒', '🔧', '⚙️',
    '🌴', '🏖️', '🛫', '🩺', '🧰', '🔍', '🛡️', '📡', '🧭', '💡',
]

/** What's wrong with an icon pasted in, said under its field; null when it will do. */
export function iconError(text: string): TranslationKey | null {
    const icon = text.trim()
    if (!icon) return 'module_icon_required'
    return isValidModuleIcon(icon) ? null : 'module_icon_invalid'
}

/**
 * The icon to store for a module: none when it's the module's own, so
 * picking that from the palette is the same as Use the default icon
 * (audit on part 4a), as a blank name is no name.
 */
export function overrideFor(key: ModuleKey, icon: string | null): string | null {
    return icon && icon !== MODULES[key].icon ? icon : null
}

type Props = {
    companyId: string
    /** As stored on the company row — not on the viewer's session: a Super Admin
     *  is editing somebody else's naming, not their own. */
    moduleLabels: unknown
    moduleIcons: unknown
    /** Hands the saved maps back so the page's copy of the company stays true. */
    onSaved: (labels: ModuleOverrides | null, icons: ModuleOverrides | null) => void
}

export default function CompanyModulesCard({ companyId, moduleLabels, moduleIcons, onSaved }: Props) {
    const { t } = useLanguage()
    const { showToast } = useToast()

    const savedLabels = useMemo(() => parseModuleOverrides(moduleLabels), [moduleLabels])
    const savedIcons = useMemo(() => parseModuleIcons(moduleIcons), [moduleIcons])

    const [labels, setLabels] = useState<ModuleOverrides>(savedLabels)
    const [icons, setIcons] = useState<ModuleOverrides>(savedIcons)
    const [saving, setSaving] = useState(false)
    const [pickerFor, setPickerFor] = useState<ModuleKey | null>(null)

    // Re-seeds the form when the fetch resolves, and only then — keyed on the
    // saved values rather than running every render, so it cannot stomp on what
    // the admin is in the middle of typing.
    useAdjustOnChange([savedLabels, savedIcons], () => {
        setLabels(savedLabels)
        setIcons(savedIcons)
    })

    // What the sidebar would say if this were saved. The same resolver the real
    // sidebar uses, so the preview cannot drift from the thing it previews.
    const preview = modulesFrom({ moduleLabels: labels, moduleIcons: icons }, t)

    const isDirty = !sameOverrides(savedLabels, labels) || !sameOverrides(savedIcons, icons)
    useReportUnsaved('modules', isDirty)

    const nameOf = (key: ModuleKey) => t(MODULES[key].labelKey)

    const setLabel = (key: ModuleKey, value: string) => {
        setLabels(prev => {
            const next = { ...prev }
            // Blank is the absence of an override, not an override to nothing.
            if (value.trim()) next[key] = value
            else delete next[key]
            return next
        })
    }

    const setIcon = (key: ModuleKey, picked: string | null) => {
        const value = overrideFor(key, picked)
        setIcons(prev => {
            const next = { ...prev }
            if (value) next[key] = value
            else delete next[key]
            return next
        })
        setPickerFor(null)
    }

    const handleSave = async (e: FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const res = await fetch('/api/companies', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                // Trimmed on the way out so a label saved with stray spaces
                // does not read as dirty forever against its parsed self.
                body: JSON.stringify({
                    id: companyId,
                    moduleLabels: Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, v.trim()])),
                    moduleIcons: icons,
                }),
            })
            if (res.ok) {
                const nextLabels = parseModuleOverrides(labels)
                const nextIcons = parseModuleIcons(icons)
                onSaved(
                    Object.keys(nextLabels).length ? nextLabels : null,
                    Object.keys(nextIcons).length ? nextIcons : null
                )
                showToast(t('settings_saved_success'), 'success')
            } else {
                const data = await res.json().catch(() => ({}))
                showToast(data.error || t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    const nothingSet = Object.keys(labels).length === 0 && Object.keys(icons).length === 0

    return (
        <Card title={t('module_names_setting')}>
            <p className="ui-card-note">{t('module_names_setting_hint')}</p>
            <form className="ui-card-form" noValidate onSubmit={handleSave}>
                {/* Each field is named for the module it renames, and left
                    blank keeps that name. */}
                {MODULE_KEYS.map(key => (
                    <Field key={key} label={nameOf(key)}>{p => (
                        <span className="ui-module-name">
                            <Button className="ui-emoji-button" aria-label={t('module_icon_choose_for').replace('{name}', nameOf(key))}
                                title={t('module_icon_choose')} aria-haspopup="dialog" disabled={saving} onClick={() => setPickerFor(key)}>
                                {icons[key] || MODULES[key].icon}
                            </Button>
                            <TextInput {...p} name={`label-${key}`} autoComplete="off" maxLength={MAX_MODULE_LABEL_LENGTH}
                                value={labels[key] || ''} onChange={e => setLabel(key, e.target.value)} disabled={saving} />
                        </span>
                    )}</Field>
                ))}

                {/* The side bar's groups, with only the modules in them, on the
                    side bar's own ground: the names and icons here are the
                    company's to choose (lib/side-bar.ts). */}
                <div className="ui-field">
                    <p className="ui-label">{t('module_names_preview')}</p>
                    <div className="ui-sidebar-preview">
                        {COMPANY_GROUPS.map(group => {
                            const keys = group.items.filter(isModuleKey)
                            return keys.length > 0 && (
                                <Fragment key={group.key}>
                                    {group.labelKey && <p className="ui-sidebar-preview-group">{t(group.labelKey)}</p>}
                                    {keys.map(key => {
                                        const entry = preview.entry(key)
                                        return <span key={key} className="ui-sidebar-preview-item"><span aria-hidden="true">{entry.icon}</span><bdi>{entry.label}</bdi></span>
                                    })}
                                </Fragment>
                            )
                        })}
                    </div>
                </div>

                <div className="ui-card-actions">
                    <Button disabled={saving || nothingSet} onClick={() => { setLabels({}); setIcons({}) }}>{t('module_reset_all')}</Button>
                    <Button type="submit" variant="primary" busy={saving} disabled={!isDirty}>{t('save')}</Button>
                </div>
            </form>

            {pickerFor && (
                <IconDialog name={nameOf(pickerFor)} current={icons[pickerFor] || MODULES[pickerFor].icon} fallback={MODULES[pickerFor].icon}
                    onPick={icon => setIcon(pickerFor, icon)} onClose={() => setPickerFor(null)} />
            )}
        </Card>
    )
}

/**
 * A module's icon: one from the palette at a press, any emoji pasted in, or
 * back to the module's own. Picked into the form; saved with it.
 */
export function IconDialog({ name, current, fallback, onPick, onClose }: {
    name: string
    /** The icon in use: the company's own choice, or the module's. */
    current: string
    fallback: string
    onPick: (icon: string | null) => void
    onClose: () => void
}) {
    const { t } = useLanguage()
    const formRef = useRef<HTMLFormElement>(null)
    const [pasted, setPasted] = useState('')
    const [wrong, setWrong] = useState<TranslationKey | null>(null)

    const submit = (e: FormEvent) => {
        e.preventDefault()
        const found = iconError(pasted)
        setWrong(found)
        if (found) { focusFirstWrong(formRef.current); return }
        onPick(pasted.trim())
    }

    return (
        <Dialog open onClose={onClose} title={t('module_icon_title').replace('{name}', name)}>
            <div className="ui-emoji-grid">
                {PALETTE.map(emoji => (
                    <button key={emoji} type="button" className="ui-emoji" aria-pressed={current === emoji} onClick={() => onPick(emoji)}>{emoji}</button>
                ))}
            </div>
            {/* A choice like the palette's, so beside it: among the dialog's
                buttons it pushed Use this emoji onto a line of its own (audit
                on part 4a). */}
            <p><Button onClick={() => onPick(null)}>{`${t('module_icon_reset')} (${fallback})`}</Button></p>
            <form ref={formRef} className="ui-form" noValidate onSubmit={submit}>
                <Field label={t('module_icon_custom')} error={wrong ? t(wrong) : undefined}>{p => (
                    <TextInput {...p} name="icon" autoComplete="off" maxLength={16} value={pasted}
                        onChange={e => { setPasted(e.target.value); setWrong(null) }} />
                )}</Field>
                <DialogActions>
                    <Button onClick={onClose}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary">{t('module_icon_use')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
