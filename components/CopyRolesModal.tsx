'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Modal from '@/components/Modal'
import { refusalOf } from '@/components/CompanyRolesCard'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'

/**
 * "Copy roles from…" (ROLES_PLAN.md §6.7): another company's roles, brought
 * over as independent copies. The Super Admin's; the roles card offers it.
 */
export default function CopyRolesModal({ companyId, isOpen, onClose, onCopied }: {
    companyId: string
    isOpen: boolean
    onClose: () => void
    onCopied: () => void
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [source, setSource] = useState('')
    const [includeBuiltIn, setIncludeBuiltIn] = useState(false)
    const [copying, setCopying] = useState(false)
    const { data } = useSWR(isOpen ? '/api/companies?limit=100' : null, fetcher)
    const companies: { id: string; name: string }[] = (data?.data?.data || data?.data || []).filter((c: { id: string }) => c.id !== companyId)

    const copy = async () => {
        setCopying(true)
        try {
            const res = await fetch('/api/roles/copy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetCompanyId: companyId, sourceCompanyId: source, includeBuiltIn }),
            })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            const { data: result } = await res.json()
            const list = (names: string[]) => names.length ? names.join(', ') : '—'
            showToast(t('roles_copy_done').replace('{copied}', list(result.copied)).replace('{skipped}', list(result.skipped)), 'success')
            onCopied()
            onClose()
        } finally {
            setCopying(false)
        }
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('roles_copy_title')}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-soft)', marginTop: 0 }}>{t('roles_copy_hint')}</p>
            <select className="input" value={source} onChange={e => setSource(e.target.value)} aria-label={t('who_can_company')}>
                <option value="">—</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={includeBuiltIn} onChange={e => setIncludeBuiltIn(e.target.checked)} />
                {t('roles_copy_include_built_in')}
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button type="button" className="btn" style={{ background: 'var(--border)', color: 'var(--text-strong)' }} onClick={onClose}>{t('roles_cancel')}</button>
                <button type="button" className="btn btn-primary" onClick={copy} disabled={!source || copying}>{t('roles_copy_confirm')}</button>
            </div>
        </Modal>
    )
}
