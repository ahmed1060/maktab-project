'use client'

import { useRef, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { refusalOf } from '@/components/CompanyRolesCard'
import { Button, Dialog, DialogActions, Field, Select } from '@/components/ui'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'
import type { TranslationKey } from '@/lib/translations'

/**
 * "Copy roles from…" (ROLES_PLAN.md §6.7): another company's roles, brought
 * over as independent copies. The Super Admin's; the roles card offers it.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 4b).
 */

/** What's wrong with the company to copy from, said under its field; null when there's one. */
export function sourceError(source: string): TranslationKey | null {
    return source ? null : 'roles_copy_source_required'
}

export default function CopyRolesModal({ companyId, isOpen, onClose, onCopied }: {
    companyId: string
    isOpen: boolean
    onClose: () => void
    onCopied: () => void
}) {
    if (!isOpen) return null
    // Mounted afresh each time it opens, so it starts with nothing chosen.
    return <CopyRolesDialog companyId={companyId} onClose={onClose} onCopied={onCopied} />
}

function CopyRolesDialog({ companyId, onClose, onCopied }: { companyId: string; onClose: () => void; onCopied: () => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const formRef = useRef<HTMLFormElement>(null)
    const [source, setSource] = useState('')
    const [wrong, setWrong] = useState<TranslationKey | null>(null)
    const [includeBuiltIn, setIncludeBuiltIn] = useState(false)
    const [copying, setCopying] = useState(false)
    const { data, error, isValidating, mutate } = useSWR('/api/companies?limit=100', fetcher)
    const companies: { id: string; name: string }[] = (data?.data?.data || data?.data || []).filter((c: { id: string }) => c.id !== companyId)

    const copy = async (e: FormEvent) => {
        e.preventDefault()
        const found = sourceError(source)
        setWrong(found)
        if (found) { focusFirstWrong(formRef.current); return }
        setCopying(true)
        try {
            const res = await fetch('/api/roles/copy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetCompanyId: companyId, sourceCompanyId: source, includeBuiltIn }),
            })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            const { data: result } = await res.json()
            const list = (names: string[]) => names.length ? names.join(t('list_separator')) : '—'
            showToast(t('roles_copy_done').replace('{copied}', list(result.copied)).replace('{skipped}', list(result.skipped)), 'success')
            onCopied()
            onClose()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setCopying(false)
        }
    }

    return (
        <Dialog open onClose={() => { if (!copying) onClose() }} title={t('roles_copy_title')}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={copy}>
                <p>{t('roles_copy_hint')}</p>
                <Field label={t('roles_copy_source')} error={error ? t('roles_copy_companies_failed') : wrong ? t(wrong) : undefined}>{p => (
                    <Select {...p} name="source" value={source} onChange={e => { setSource(e.target.value); setWrong(null) }}
                        options={[{ value: '', label: t('roles_copy_choose') }, ...companies.map(c => ({ value: c.id, label: c.name }))]} />
                )}</Field>
                {error && <p><Button size="sm" busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button></p>}
                <label className="ui-choice">
                    <input type="checkbox" className="ui-check" name="includeBuiltIn" checked={includeBuiltIn} onChange={e => setIncludeBuiltIn(e.target.checked)} />
                    {t('roles_copy_include_built_in')}
                </label>
                <DialogActions>
                    <Button onClick={onClose} disabled={copying}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={copying}>{t('roles_copy_confirm')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
