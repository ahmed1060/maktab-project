'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useReportUnsaved } from '@/lib/useUnsavedChanges'
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
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const isRtl = locale === 'ar'

    const savedLabels = useMemo(() => parseModuleOverrides(moduleLabels), [moduleLabels])
    const savedIcons = useMemo(() => parseModuleIcons(moduleIcons), [moduleIcons])

    const [labels, setLabels] = useState<ModuleOverrides>(savedLabels)
    const [icons, setIcons] = useState<ModuleOverrides>(savedIcons)
    const [saving, setSaving] = useState(false)
    const [pickerFor, setPickerFor] = useState<ModuleKey | null>(null)
    const [customIcon, setCustomIcon] = useState('')

    // Re-seeds the form when the fetch resolves, and only then — keyed on the
    // saved values rather than running every render, so it cannot stomp on what
    // the admin is in the middle of typing.
    useAdjustOnChange([savedLabels, savedIcons], () => {
        setLabels(savedLabels)
        setIcons(savedIcons)
    })

    const pickerRef = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
        if (!pickerFor) return
        const onDown = (e: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerFor(null)
        }
        const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerFor(null) }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onEsc)
        return () => {
            document.removeEventListener('mousedown', onDown)
            document.removeEventListener('keydown', onEsc)
        }
    }, [pickerFor])

    // What the sidebar would say if this were saved. The same resolver the real
    // sidebar uses, so the preview cannot drift from the thing it previews.
    const preview = modulesFrom({ moduleLabels: labels, moduleIcons: icons }, t)

    const isDirty = !sameOverrides(savedLabels, labels) || !sameOverrides(savedIcons, icons)
    useReportUnsaved('modules', isDirty)

    const setLabel = (key: ModuleKey, value: string) => {
        setLabels(prev => {
            const next = { ...prev }
            // Blank is the absence of an override, not an override to nothing.
            if (value.trim()) next[key] = value
            else delete next[key]
            return next
        })
    }

    const setIcon = (key: ModuleKey, value: string | null) => {
        setIcons(prev => {
            const next = { ...prev }
            if (value) next[key] = value
            else delete next[key]
            return next
        })
        setPickerFor(null)
        setCustomIcon('')
    }

    const applyCustomIcon = (key: ModuleKey) => {
        const candidate = customIcon.trim()
        if (!candidate) return
        if (!isValidModuleIcon(candidate)) {
            showToast(t('module_icon_invalid'), 'error')
            return
        }
        setIcon(key, candidate)
    }

    const handleSave = async () => {
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
                showToast(t('settings_saved_success') || 'Settings saved', 'success')
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

    const row = (key: ModuleKey) => {
        const def = MODULES[key]
        const open = pickerFor === key
        return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }}>
                <button
                    type="button"
                    onClick={() => { setPickerFor(open ? null : key); setCustomIcon('') }}
                    title={t('module_icon_choose')}
                    aria-expanded={open}
                    style={{
                        width: '2.75rem',
                        height: '2.75rem',
                        flexShrink: 0,
                        fontSize: '1.35rem',
                        lineHeight: 1,
                        cursor: 'pointer',
                        borderRadius: '0.6rem',
                        border: `1px solid ${open ? 'var(--brand-primary)' : 'var(--border)'}`,
                        background: 'var(--surface)',
                        color: 'var(--text-body)',
                    }}
                >
                    {icons[key] || def.icon}
                </button>
                <input
                    type="text"
                    className="input"
                    value={labels[key] || ''}
                    onChange={(e) => setLabel(key, e.target.value)}
                    placeholder={t(def.labelKey)}
                    maxLength={MAX_MODULE_LABEL_LENGTH}
                    disabled={saving}
                    style={{ flex: 1, minWidth: 0 }}
                />

                {open && (
                    <div
                        ref={pickerRef}
                        className="glass"
                        style={{
                            position: 'absolute',
                            top: 'calc(100% + 0.4rem)',
                            [isRtl ? 'right' : 'left']: 0,
                            zIndex: 30,
                            width: 'min(21rem, 80vw)',
                            padding: '0.75rem',
                            borderRadius: '0.85rem',
                            border: '1px solid var(--border)',
                            boxShadow: '0 12px 32px var(--shadow-mid)',
                            background: 'var(--panel-95)',
                        }}
                    >
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, minmax(0, 1fr))', gap: '0.15rem' }}>
                            {PALETTE.map(emoji => (
                                <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => setIcon(key, emoji)}
                                    style={{
                                        fontSize: '1.15rem',
                                        lineHeight: 1,
                                        padding: '0.3rem 0',
                                        cursor: 'pointer',
                                        border: 'none',
                                        borderRadius: '0.4rem',
                                        background: icons[key] === emoji ? 'var(--highlight-tint)' : 'transparent',
                                    }}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.65rem' }}>
                            <input
                                type="text"
                                className="input"
                                value={customIcon}
                                onChange={(e) => setCustomIcon(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCustomIcon(key) } }}
                                placeholder={t('module_icon_custom')}
                                maxLength={16}
                                style={{ flex: 1, minWidth: 0 }}
                            />
                            <button type="button" className="btn btn-primary" onClick={() => applyCustomIcon(key)}>
                                {t('save')}
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIcon(key, null)}
                            style={{
                                marginTop: '0.5rem',
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                fontSize: '0.8rem',
                                color: 'var(--text-soft)',
                                textDecoration: 'underline',
                            }}
                        >
                            {t('module_icon_reset')} ({def.icon})
                        </button>
                    </div>
                )}
            </div>
        )
    }

    // The side bar's groups, with only the modules in them: the names and
    // icons here are the company's to choose (lib/side-bar.ts).
    const previewGroup = (heading: string | null, keys: readonly ModuleKey[]) => (
        <>
            {heading ? (
                <p style={{
                    fontSize: '0.75rem', fontWeight: 600,
                    color: 'var(--text-faint)', margin: '0.75rem 0 0.25rem',
                }}>{heading}</p>
            ) : <div style={{ height: '0.5rem' }} />}
            {keys.map(key => {
                const entry = preview.entry(key)
                return (
                    <div key={key} style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.4rem 0.6rem', borderRadius: '0.6rem',
                        color: 'var(--sidebar-fg)', fontSize: '0.9rem', fontWeight: 500,
                    }}>
                        <span aria-hidden="true" style={{ fontSize: '1.2rem' }}>{entry.icon}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.label}</span>
                    </div>
                )
            })}
        </>
    )

    return (
        <div className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', textAlign: isRtl ? 'right' : 'left' }}>
            <div style={{ fontWeight: 500, marginBottom: '0.15rem' }}>{t('module_names_setting')}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginBottom: '1rem' }}>
                {t('module_names_setting_hint')}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {MODULE_KEYS.map(row)}
            </div>

            <div className="glass-dark" style={{ marginTop: '1.25rem', padding: '0.75rem 1rem', borderRadius: '0.85rem', border: '1px solid var(--veil-20)', direction: isRtl ? 'rtl' : 'ltr' }}>
                <p style={{ fontSize: '0.7rem', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-faint)', letterSpacing: '0.1em', margin: 0 }}>
                    {t('module_names_preview')}
                </p>
                {COMPANY_GROUPS.map(group => {
                    const keys = group.items.filter(isModuleKey)
                    return keys.length > 0 && <Fragment key={group.key}>{previewGroup(group.labelKey && t(group.labelKey), keys)}</Fragment>
                })}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: isRtl ? 'flex-start' : 'flex-end' }}>
                <button
                    type="button"
                    className="btn"
                    onClick={() => { setLabels({}); setIcons({}) }}
                    disabled={saving || (Object.keys(labels).length === 0 && Object.keys(icons).length === 0)}
                >
                    {t('module_reset_all')}
                </button>
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !isDirty}>
                    {saving ? t('saving') : t('save')}
                </button>
            </div>
        </div>
    )
}
