'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import Modal from '@/components/Modal'
import ConfirmModal from '@/components/ConfirmModal'
import PointPicker from '@/components/PointPicker'
import { apiErrorText } from '@/lib/api-error-text'
import { googleMapsLink, parsePoint } from '@/lib/attendance/geo'

/**
 * Where people check in with the app (ATTENDANCE_PLAN.md §8.5, §9.4), on the
 * Attendance tab of a company holding the Mobile App add-on: a circle on the
 * map, optionally the office's public IPs, and who may check in there.
 */

type Location = {
    id: string; name: string; latitude: number; longitude: number; radiusMeters: number
    officeIpRanges: string[]; everyone: boolean; archivedAt: string | null; userIds: string[]
}
type Person = { id: string; name: string }
type Draft = { id: string | null; name: string; point: string; radius: string; ips: string; everyone: boolean }

const mapLink = (l: Pick<Location, 'latitude' | 'longitude'>) => googleMapsLink(l.latitude, l.longitude)

export default function AttendanceLocationsPanel({ companyId, readOnly }: { companyId: string; readOnly: boolean }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const { data: body, error, mutate } = useSWR(`/api/attendance/locations?companyId=${encodeURIComponent(companyId)}`, fetcher)
    const [draft, setDraft] = useState<Draft | null>(null)
    const [staffing, setStaffing] = useState<{ location: Location; chosen: Set<string>; search: string } | null>(null)
    const [archiving, setArchiving] = useState<Location | null>(null)
    const [busy, setBusy] = useState(false)

    // Not sold to this company, or not this person's to see: nothing here.
    // Anything else is a failure to load, and says so rather than vanishing.
    if (error && (error.status === 403 || error.status === 404)) return null
    if (error) {
        return (
            <section className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.88rem' }}>{t('att_loc_title')}: {t('error_generic')}</span>
                <button className="btn btn-secondary" onClick={() => mutate()}>{t('att_loc_retry')}</button>
            </section>
        )
    }
    if (!body?.data) return null
    const locations: Location[] = body.data.locations
    const people: Person[] = body.data.people
    const nameOf = new Map(people.map(p => [p.id, p.name]))

    const send = async (url: string, init: RequestInit, done: string, then?: () => void) => {
        setBusy(true)
        try {
            const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
            const text = await res.text()
            if (!res.ok) return showToast(apiErrorText(text, t('error_generic')), 'error')
            showToast(t(done as any), 'success')
            then?.()
            mutate()
        } catch {
            // The connection dropped: nothing was confirmed, and the form stays open to try again.
            showToast(t('error_generic'), 'error')
        } finally { setBusy(false) }
    }

    const point = draft ? parsePoint(draft.point) : null
    const save = () => {
        if (!draft || !point) return
        const input = {
            name: draft.name, ...point, radiusMeters: Number(draft.radius),
            officeIpRanges: draft.ips.split(/[\n,]/).map(s => s.trim()).filter(Boolean), everyone: draft.everyone,
        }
        if (draft.id) send(`/api/attendance/locations/${draft.id}`, { method: 'PATCH', body: JSON.stringify(input) }, 'att_loc_saved', () => setDraft(null))
        else send('/api/attendance/locations', { method: 'POST', body: JSON.stringify({ companyId, ...input }) }, 'att_loc_added', () => setDraft(null))
    }
    const edit = (l: Location) => setDraft({ id: l.id, name: l.name, point: `${l.latitude}, ${l.longitude}`, radius: String(l.radiusMeters), ips: l.officeIpRanges.join('\n'), everyone: l.everyone })

    const who = (l: Location) => l.everyone ? t('att_loc_everyone_short')
        : l.userIds.length === 0 ? t('att_loc_nobody')
        : l.userIds.length <= 3 ? l.userIds.map(id => nameOf.get(id) ?? '…').join(', ')
        : t('att_loc_people_n').replace('{n}', String(l.userIds.length))

    const shownPeople = staffing ? people.filter(p => p.name.toLowerCase().includes(staffing.search.trim().toLowerCase())) : []

    return (
        <section className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', display: 'grid', gap: '1rem' }} aria-labelledby="attendance-locations">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: '1 1 18rem' }}>
                    <h3 id="attendance-locations" style={{ margin: 0, fontSize: '1rem' }}>{t('att_loc_title')}</h3>
                    <p style={{ margin: '0.3rem 0 0', fontSize: '0.84rem', color: 'var(--text-soft)' }}>{t('att_loc_hint')}</p>
                </div>
                {!readOnly && <button className="btn btn-primary" disabled={busy} onClick={() => setDraft({ id: null, name: '', point: '', radius: '150', ips: '', everyone: false })}>{t('att_loc_add')}</button>}
            </div>

            {locations.length === 0 && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-soft)' }}>{t('att_loc_none')}</p>}
            {locations.map(l => (
                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '0.5rem', opacity: l.archivedAt ? 0.65 : 1 }}>
                    <div style={{ minWidth: 0, display: 'grid', gap: '0.2rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <strong>{l.name}</strong>
                            {l.archivedAt && <span style={{ background: 'var(--surface-sunk)', color: 'var(--text-soft)', fontSize: '0.72rem', fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: '999px' }}>{t('att_loc_archived_badge')}</span>}
                        </div>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-soft)' }}>
                            {[t('att_loc_radius_m').replace('{n}', String(l.radiusMeters)), l.officeIpRanges.length > 0 && t('att_loc_ip_n').replace('{n}', String(l.officeIpRanges.length)), who(l)].filter(Boolean).join(' · ')}
                            {' · '}
                            <a href={mapLink(l)} target="_blank" rel="noopener noreferrer">{t('att_loc_map')}</a>
                        </span>
                    </div>
                    {!readOnly && (
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            {!l.archivedAt && <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} disabled={busy} onClick={() => edit(l)}>{t('att_loc_edit')}</button>}
                            {!l.archivedAt && !l.everyone && <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} disabled={busy} onClick={() => setStaffing({ location: l, chosen: new Set(l.userIds), search: '' })}>{t('att_loc_choose_people')}</button>}
                            {!l.archivedAt && <button className="btn btn-secondary" style={{ fontSize: '0.8rem', color: 'var(--danger-fg)' }} disabled={busy} onClick={() => setArchiving(l)}>{t('att_loc_archive')}</button>}
                            {l.archivedAt && <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} disabled={busy} onClick={() => send(`/api/attendance/locations/${l.id}/restore`, { method: 'POST' }, 'att_loc_restored')}>{t('att_loc_restore')}</button>}
                        </div>
                    )}
                </div>
            ))}

            <Modal isOpen={!!draft} onClose={() => setDraft(null)} title={draft?.id ? t('att_loc_edit') : t('att_loc_add')}>
                {draft && (
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                        <label style={{ display: 'grid', gap: '0.25rem' }}>
                            <span className="label">{t('att_loc_name')}</span>
                            <input className="input" autoFocus maxLength={80} value={draft.name} placeholder={t('att_loc_name_placeholder')} onChange={e => setDraft({ ...draft, name: e.target.value })} />
                        </label>
                        <label style={{ display: 'grid', gap: '0.25rem' }}>
                            <span className="label">{t('att_loc_point')}</span>
                            <input className="input" dir="ltr" inputMode="decimal" value={draft.point} placeholder="30.0444, 31.2357" onChange={e => setDraft({ ...draft, point: e.target.value })} aria-invalid={draft.point.trim() !== '' && !point} />
                            <span style={{ fontSize: '0.75rem', color: draft.point.trim() && !point ? 'var(--danger-fg)' : 'var(--text-soft)' }}>{draft.point.trim() && !point ? t('att_loc_point_invalid') : t('att_loc_point_hint')}</span>
                            {point && <a href={mapLink(point)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.78rem' }}>{t('att_loc_map')} ↗</a>}
                        </label>
                        <PointPicker value={draft.point} radius={Number(draft.radius) || 0} onChange={text => setDraft(d => d && { ...d, point: text })} />
                        <label style={{ display: 'grid', gap: '0.25rem' }}>
                            <span className="label">{t('att_loc_radius')}</span>
                            <input className="input" type="number" min={20} max={5000} step={10} value={draft.radius} onChange={e => setDraft({ ...draft, radius: e.target.value })} style={{ maxWidth: '10rem' }} />
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>{t('att_loc_radius_hint')}</span>
                        </label>
                        <label style={{ display: 'grid', gap: '0.25rem' }}>
                            <span className="label">{t('att_loc_ips')}</span>
                            <textarea className="input" dir="ltr" rows={3} value={draft.ips} placeholder="203.0.113.7" onChange={e => setDraft({ ...draft, ips: e.target.value })} />
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>{t('att_loc_ips_hint')}</span>
                        </label>
                        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <input type="checkbox" checked={draft.everyone} onChange={e => setDraft({ ...draft, everyone: e.target.checked })} />
                            <span>{t('att_loc_everyone')}</span>
                        </label>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                            <button className="btn btn-secondary" onClick={() => setDraft(null)}>{t('cancel')}</button>
                            <button className="btn btn-primary" disabled={busy || !draft.name.trim() || !point || !draft.radius} onClick={save}>{t('save')}</button>
                        </div>
                    </div>
                )}
            </Modal>

            <Modal isOpen={!!staffing} onClose={() => setStaffing(null)} title={`${t('att_loc_people')}: ${staffing?.location.name ?? ''}`}>
                {staffing && (
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                        <input className="input" value={staffing.search} placeholder={t('att_loc_search')} onChange={e => setStaffing({ ...staffing, search: e.target.value })} />
                        <div style={{ maxHeight: '18rem', overflowY: 'auto', display: 'grid', gap: '0.25rem' }}>
                            {shownPeople.map(p => (
                                <label key={p.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.88rem' }}>
                                    <input
                                        type="checkbox"
                                        checked={staffing.chosen.has(p.id)}
                                        onChange={e => {
                                            const chosen = new Set(staffing.chosen)
                                            if (e.target.checked) chosen.add(p.id)
                                            else chosen.delete(p.id)
                                            setStaffing({ ...staffing, chosen })
                                        }}
                                    />
                                    <span>{p.name}</span>
                                </label>
                            ))}
                        </div>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-soft)' }}>{t('att_loc_people_n').replace('{n}', String(staffing.chosen.size))}</span>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                            <button className="btn btn-secondary" onClick={() => setStaffing(null)}>{t('cancel')}</button>
                            <button className="btn btn-primary" disabled={busy} onClick={() => send(`/api/attendance/locations/${staffing.location.id}/people`, { method: 'PUT', body: JSON.stringify({ userIds: [...staffing.chosen] }) }, 'att_loc_saved', () => setStaffing(null))}>{t('save')}</button>
                        </div>
                    </div>
                )}
            </Modal>

            <ConfirmModal
                isOpen={!!archiving}
                title={t('att_loc_archive')}
                message={t('att_loc_archive_confirm').replace('{name}', archiving?.name ?? '')}
                confirmText={t('att_loc_archive')}
                onConfirm={() => { const l = archiving; setArchiving(null); if (l) send(`/api/attendance/locations/${l.id}`, { method: 'DELETE' }, 'att_loc_archived') }}
                onCancel={() => setArchiving(null)}
            />
        </section>
    )
}
