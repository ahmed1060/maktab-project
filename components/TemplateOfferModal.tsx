'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Modal from '@/components/Modal'
import { refusalOf } from '@/components/CompanyRolesCard'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'
import { isPermission } from '@/lib/permissions/catalogue'
import { permissionLabelKey, scopeLabelKey } from '@/lib/permissions/matrix'

/**
 * "Offer this change to companies using this template" (ROLES_PLAN.md §6.8):
 * the company roles copied from a template, what applying it would change in
 * each, and only the ones picked are changed.
 */
type Difference = { added: string[]; removed: string[]; rescoped: { permission: string; from: string; to: string }[] }
type Offer = { id: string; name: string; companyName: string; holders: number; difference: Difference }

export default function TemplateOfferModal({ templateId, onClose }: { templateId: string | null; onClose: () => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [picked, setPicked] = useState<string[]>([])
    const [applyNow, setApplyNow] = useState(false)
    const [applying, setApplying] = useState(false)
    const { data, mutate } = useSWR(templateId ? `/api/role-templates/push?id=${templateId}` : null, fetcher)
    const roles: Offer[] = data?.data?.roles ?? []

    const label = (p: string) => isPermission(p) ? t(permissionLabelKey(p)) : p
    const differs = (d: Difference) => d.added.length + d.removed.length + d.rescoped.length > 0

    const apply = async () => {
        setApplying(true)
        try {
            const res = await fetch('/api/role-templates/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templateId, roleIds: picked, applyNow }),
            })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(t('template_offer_applied'), 'success')
            setPicked([])
            mutate()
        } finally {
            setApplying(false)
        }
    }

    return (
        <Modal isOpen={!!templateId} onClose={onClose} title={t('template_offer_title')}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-soft)', marginTop: 0 }}>{t('template_offer_hint')}</p>
            {roles.length === 0 ? <p>{t('template_offer_none')}</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '50vh', overflowY: 'auto' }}>
                    {roles.map(r => (
                        <label key={r.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.6rem', border: '1px solid var(--veil-40)', borderRadius: '0.75rem', cursor: differs(r.difference) ? 'pointer' : 'default' }}>
                            <input type="checkbox" disabled={!differs(r.difference)} checked={picked.includes(r.id)}
                                onChange={e => setPicked(e.target.checked ? [...picked, r.id] : picked.filter(id => id !== r.id))} style={{ marginTop: '0.2rem' }} />
                            <div style={{ fontSize: '0.85rem' }}>
                                <strong>{r.companyName}</strong> · {r.name} · {t('roles_holders').replace('{count}', String(r.holders))}
                                {!differs(r.difference) && <div style={{ color: 'var(--text-soft)' }}>{t('template_offer_same')}</div>}
                                {r.difference.added.length > 0 && <div>{t('template_offer_added').replace('{list}', r.difference.added.map(label).join(', '))}</div>}
                                {r.difference.removed.length > 0 && <div>{t('template_offer_removed').replace('{list}', r.difference.removed.map(label).join(', '))}</div>}
                                {r.difference.rescoped.length > 0 && (
                                    <div>{t('template_offer_rescoped').replace('{list}', r.difference.rescoped.map(c => `${label(c.permission)} (${t(scopeLabelKey(c.from as any))} → ${t(scopeLabelKey(c.to as any))})`).join(', '))}</div>
                                )}
                            </div>
                        </label>
                    ))}
                </div>
            )}
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={applyNow} onChange={e => setApplyNow(e.target.checked)} />
                {t('roles_apply_now')}
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button type="button" className="btn" style={{ background: 'var(--border)', color: 'var(--text-strong)' }} onClick={onClose}>{t('roles_cancel')}</button>
                <button type="button" className="btn btn-primary" onClick={apply} disabled={picked.length === 0 || applying}>{t('template_offer_apply')}</button>
            </div>
        </Modal>
    )
}
