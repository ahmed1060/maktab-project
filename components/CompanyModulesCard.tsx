'use client'

import { Fragment, useMemo, useState, type FormEvent } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, Card, Dialog, DialogActions, Field, Icon, TextInput } from '@/components/ui'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useReportUnsaved } from '@/lib/useUnsavedChanges'
import {
    MAX_MODULE_LABEL_LENGTH,
    MODULES,
    MODULE_ICON_NAMES,
    MODULE_KEYS,
    isModuleKey,
    modulesFrom,
    parseModuleIcons,
    parseModuleOverrides,
    sameOverrides,
    type ModuleIconName,
    type ModuleKey,
    type ModuleOverrides,
} from '@/lib/modules'
import { MODULE_ICONS } from '@/lib/module-icons'
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
 * The icon to keep for a module: the one picked, or none for the module's
 * own, picked from the list or with Use the default icon, as a blank name is
 * no name. The module's own then follows it, should it ever change.
 */
export function overrideFor(key: ModuleKey, icon: ModuleIconName | null): ModuleIconName | null {
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
    // sidebar uses, and its icons, so the preview cannot drift from the thing it previews.
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

    const setIcon = (key: ModuleKey, picked: ModuleIconName | null) => {
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
                            <Button className="ui-module-icon-button" aria-label={t('module_icon_choose_for').replace('{name}', nameOf(key))}
                                title={t('module_icon_choose')} aria-haspopup="dialog" disabled={saving} onClick={() => setPickerFor(key)}>
                                <Icon icon={MODULE_ICONS[preview.icon(key)].glyph} size={20} />
                            </Button>
                            <TextInput {...p} name={`label-${key}`} autoComplete="off" maxLength={MAX_MODULE_LABEL_LENGTH}
                                value={labels[key] || ''} onChange={e => setLabel(key, e.target.value)} disabled={saving} />
                        </span>
                    )}</Field>
                ))}

                {/* The side bar's groups, with only the modules in them, in the
                    side bar's own look: the names and icons here are the
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
                                        return (
                                            <span key={key} className="ui-sidebar-preview-item">
                                                <Icon icon={MODULE_ICONS[entry.icon].glyph} />
                                                <bdi>{entry.label}</bdi>
                                            </span>
                                        )
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
                <IconDialog name={nameOf(pickerFor)} current={preview.icon(pickerFor)} own={MODULES[pickerFor].icon}
                    onPick={icon => setIcon(pickerFor, icon)} onClose={() => setPickerFor(null)} />
            )}
        </Card>
    )
}

/**
 * A module's icon (DESIGN.md §6): one of the 48 at a press, or back to the
 * module's own. Picked into the form, and saved with it.
 */
export function IconDialog({ name, current, own, onPick, onClose }: {
    name: string
    /** The icon in use: the company's own, or the module's while it has none. */
    current: ModuleIconName
    /** The module's own: the side bar's (lib/side-bar-icons.ts). */
    own: ModuleIconName
    onPick: (icon: ModuleIconName | null) => void
    onClose: () => void
}) {
    const { t } = useLanguage()
    return (
        <Dialog open onClose={onClose} title={t('module_icon_title').replace('{name}', name)}>
            {/* Each a button named for what it draws, the one in use filled
                and heard as pressed, and focus starting on it. */}
            <div className="ui-icon-grid">
                {MODULE_ICON_NAMES.map(icon => {
                    const chosen = icon === current
                    return (
                        <button key={icon} type="button" className="ui-icon-choice" aria-label={t(MODULE_ICONS[icon].labelKey)}
                            aria-pressed={chosen} autoFocus={chosen} onClick={() => onPick(icon)}>
                            <Icon icon={MODULE_ICONS[icon].glyph} size={24} weight={chosen ? 'fill' : 'regular'} />
                        </button>
                    )
                })}
            </div>
            {/* A choice like the list's, so under it: among the dialog's
                buttons it pushed Use this emoji onto a line of its own (audit
                on part 4a). */}
            <p><Button icon={MODULE_ICONS[own].glyph} onClick={() => onPick(null)}>{t('module_icon_reset')}</Button></p>
            <DialogActions>
                <Button onClick={onClose}>{t('cancel')}</Button>
            </DialogActions>
        </Dialog>
    )
}
