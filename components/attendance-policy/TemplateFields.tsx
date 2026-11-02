'use client'

import { Field, TextArea, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'

export type TemplateDraft = { name: string; nameAr: string; description: string }

/**
 * A policy template's own fields (ATTENDANCE_PLAN.md §6.8), above its rules in
 * the policy dialog: its name, which it needs, its name in Arabic and what
 * it's for. A missing name is said under the field.
 */
export default function TemplateFields({ value, error, onChange }: {
    value: TemplateDraft
    error?: string
    onChange: (value: TemplateDraft) => void
}) {
    const { t } = useLanguage()
    return (
        <>
            <p className="ui-hint">{t('ptpl_copied_hint')}</p>
            <Field label={t('ptpl_name')} error={error}>{p => (
                <TextInput {...p} name="name" autoComplete="off" maxLength={80} value={value.name}
                    onChange={e => onChange({ ...value, name: e.target.value })} />
            )}</Field>
            <Field label={t('ptpl_name_ar')}>{p => (
                <TextInput {...p} name="nameAr" dir="rtl" lang="ar" autoComplete="off" maxLength={80} value={value.nameAr}
                    onChange={e => onChange({ ...value, nameAr: e.target.value })} />
            )}</Field>
            <Field label={t('ptpl_description')}>{p => (
                <TextArea {...p} name="description" rows={2} maxLength={500} value={value.description}
                    onChange={e => onChange({ ...value, description: e.target.value })} />
            )}</Field>
        </>
    )
}
