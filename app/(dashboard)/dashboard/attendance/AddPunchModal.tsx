'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import Modal from '@/components/Modal'
import { send, json } from './send'

type Person = { id: string; name: string; teamLeaderId: string | null }

/** A punch added by hand, for somebody else, with a reason (ATTENDANCE_PLAN.md §14). */
export default function AddPunchModal({ companyId, today, people, initial, onClose, onAdded }: {
    companyId: string | null
    today: string
    people: Person[]
    /** Where to start: the person and day a missing punch is for. */
    initial?: { userId?: string; date?: string; direction?: 'IN' | 'OUT' }
    onClose: () => void
    onAdded: () => void
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [userId, setUserId] = useState(initial?.userId ?? '')
    const [date, setDate] = useState(initial?.date ?? today)
    const [time, setTime] = useState('')
    const [direction, setDirection] = useState<'' | 'IN' | 'OUT'>(initial?.direction ?? '')
    const [note, setNote] = useState('')
    const [busy, setBusy] = useState(false)

    const save = async () => {
        setBusy(true)
        try {
            const r = await send('/api/attendance/punches', json('POST', {
                ...(companyId ? { companyId } : {}), userId, at: `${date}T${time}`, direction: direction || null, note,
            }), t('punch_failed'))
            if (!r.ok) return showToast(r.error, 'error')
            showToast(t('punch_added'), 'success')
            onAdded()
        } finally { setBusy(false) }
    }

    return (
        <Modal isOpen onClose={onClose} title={t('punch_add')}>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
                <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span className="label">{t('punch_person')}</span>
                    <select className="input" value={userId} onChange={e => setUserId(e.target.value)}>
                        <option value="">{t('punch_choose_person')}</option>
                        {people.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                </label>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('punch_date')}</span>
                        <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('punch_time')}</span>
                        <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('punch_direction')}</span>
                        <select className="input" value={direction} onChange={e => setDirection(e.target.value as '' | 'IN' | 'OUT')}>
                            <option value="">{t('punch_direction_unknown')}</option>
                            <option value="IN">{t('punch_in')}</option>
                            <option value="OUT">{t('punch_out')}</option>
                        </select>
                    </label>
                </div>
                <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span className="label">{t('punch_reason')}</span>
                    <textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={t('punch_reason_example')} />
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
                    <button className="btn btn-primary" disabled={busy || !userId || !date || !time || !note.trim()} onClick={save}>{t('punch_add')}</button>
                </div>
            </div>
        </Modal>
    )
}
