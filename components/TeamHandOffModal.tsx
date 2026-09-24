'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '@/context/LanguageContext'

type Person = { id: string; firstName: string; lastName: string }

/**
 * "Move their team first" — asked whenever something would take a Team Leader
 * away from the people who report to them: a demotion, an archive or a company
 * move on the edit form, and ending their contract.
 *
 * One component for all of them, so the question reads the same wherever it
 * is asked and the answer is sent the same way: an id to move them, null to
 * leave them unassigned. Never an empty string — that is none of the three
 * states the server understands, and would fail validation.
 */
export default function TeamHandOffModal({
    leaderId,
    leaderName,
    reports,
    leaders,
    busy,
    onCancel,
    onConfirm,
}: {
    /** The leader who is going; never offered as the destination. */
    leaderId: string
    leaderName: string
    /** Who still reports to them, as the server named them. */
    reports: Person[]
    /** Team leaders in the company, any of whom could take them. */
    leaders: Person[]
    busy: boolean
    onCancel: () => void
    onConfirm: (reassignTo: string | null) => void
}) {
    const { t, locale } = useLanguage()
    const [handoffTo, setHandoffTo] = useState('')
    const rtl = locale === 'ar'

    return createPortal(
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '460px', width: '90%' }}>
                <div className="modal-header">
                    <h3 className="modal-title">{t('handoff_title')}</h3>
                    <button className="modal-close" onClick={onCancel}>&times;</button>
                </div>
                <div className="modal-body" style={{ textAlign: rtl ? 'right' : 'left' }}>
                    <p style={{ marginTop: 0 }}>
                        {t('handoff_body')
                            .replace('{name}', leaderName)
                            .replace('{count}', String(reports.length))}
                    </p>

                    {/* Named, not counted. "7 people" is a number to accept; a
                        list is a decision an Admin can actually make. */}
                    <ul style={{ margin: '0 0 1rem', [rtl ? 'paddingRight' : 'paddingLeft']: '1.25rem', color: 'var(--text-soft)' }}>
                        {reports.map(r => <li key={r.id}>{r.firstName} {r.lastName}</li>)}
                    </ul>

                    <label htmlFor="handoff-to" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>{t('handoff_move_to')}</label>
                    <select
                        id="handoff-to"
                        className="input"
                        value={handoffTo}
                        onChange={e => setHandoffTo(e.target.value)}
                        style={{ textAlign: rtl ? 'right' : 'left' }}
                    >
                        <option value="">{t('handoff_unassign')}</option>
                        {leaders.filter(l => l.id !== leaderId).map(l => (
                            <option key={l.id} value={l.id}>{l.firstName} {l.lastName}</option>
                        ))}
                    </select>
                    {handoffTo === '' && (
                        <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--warn-fg)' }}>
                            {t('handoff_unassign_note')}
                        </p>
                    )}
                </div>
                <div className="modal-footer" style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn" onClick={onCancel} disabled={busy}>
                        {t('handoff_cancel')}
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        // The empty option means unassign, so it goes as null.
                        onClick={() => onConfirm(handoffTo || null)}
                    >
                        {busy ? t('saving') : t('handoff_confirm')}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    )
}
