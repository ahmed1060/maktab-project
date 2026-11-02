'use client'

import { Fragment, useRef, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { ArchiveIcon, ArrowCounterClockwiseIcon, PencilSimpleIcon, PlusIcon, UsersThreeIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import PointPicker from '@/components/PointPicker'
import AssigneeChecklist from '@/components/forms/AssigneeChecklist'
import { apiErrorText } from '@/lib/api-error-text'
import { googleMapsLink, parsePoint } from '@/lib/attendance/geo'
import { countOf } from '@/lib/plural'
import type { TranslationKey } from '@/lib/translations'
import { Button, Card, Dialog, DialogActions, EmptyState, Field, Row, RowMenu, StatusBadge, TextArea, TextInput, type MenuItem } from '@/components/ui'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'

/**
 * Where people check in with the app (ATTENDANCE_PLAN.md §8.5, §9.4), on the
 * Attendance tab of a company holding the Mobile App add-on: a circle on the
 * map, optionally the office's public IPs, and who may check in there.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 3c): a
 * card listing each place as a row, what can be done to it in a menu named
 * for it, and each change in the building blocks' dialog.
 */

type Location = {
    id: string; name: string; latitude: number; longitude: number; radiusMeters: number
    officeIpRanges: string[]; everyone: boolean; archivedAt: string | null; userIds: string[]
}
type Person = { id: string; name: string }
export type Draft = { id: string | null; name: string; point: string; radius: string; ips: string; everyone: boolean }
type PlaceErrors = Partial<Record<'name' | 'point' | 'radius', TranslationKey>>

const mapLink = (l: Pick<Location, 'latitude' | 'longitude'>) => googleMapsLink(l.latitude, l.longitude)

/** What's wrong with a place before it's sent, each under its field. */
export function placeErrors(draft: Draft): PlaceErrors {
    const errors: PlaceErrors = {}
    if (!draft.name.trim()) errors.name = 'att_loc_name_required'
    if (!parsePoint(draft.point)) errors.point = 'att_loc_point_invalid'
    const radius = draft.radius.trim()
    if (!/^\d+$/.test(radius) || Number(radius) < 20 || Number(radius) > 5000) errors.radius = 'att_loc_radius_invalid'
    return errors
}

export default function AttendanceLocationsPanel({ companyId, readOnly }: { companyId: string; readOnly: boolean }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data: body, error, isValidating, mutate } = useSWR(`/api/attendance/locations?companyId=${encodeURIComponent(companyId)}`, fetcher)
    const [draft, setDraft] = useState<Draft | null>(null)
    const [staffing, setStaffing] = useState<Location | null>(null)
    const [archiving, setArchiving] = useState<Location | null>(null)
    const [busy, setBusy] = useState(false)

    // Not sold to this company, or not this person's to see: nothing here.
    // Anything else is a failure to load, and says so rather than vanishing.
    const status = (error as SWRError | undefined)?.status
    if (error && (status === 403 || status === 404)) return null
    if (error) return (
        <div className="ui-panel">
            <EmptyState icon={WarningCircleIcon} title={t('att_loc_load_failed')} detail={(error as SWRError).info?.error}
                action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
        </div>
    )
    if (!body?.data) return null
    const locations: Location[] = body.data.locations
    const people: Person[] = body.data.people
    const nameOf = new Map(people.map(p => [p.id, p.name]))
    const number = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')

    /** Sends one change, then reloads; the server's refusal is shown as it said it. */
    const send = async (url: string, init: RequestInit, done: TranslationKey, then?: () => void) => {
        setBusy(true)
        try {
            const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
            const text = await res.text()
            if (!res.ok) {
                showToast(apiErrorText(text, t('error_generic')), 'error')
                return
            }
            showToast(t(done), 'success')
            then?.()
            void mutate()
        } catch {
            // The connection dropped: nothing was confirmed, and the form stays open to try again.
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    /** Who may check in there: everyone, nobody, up to three by name, or how many. */
    const who = (l: Location): string[] => l.everyone ? [t('att_loc_everyone_short')]
        : l.userIds.length === 0 ? [t('att_loc_nobody')]
            : l.userIds.length <= 3 ? l.userIds.map(id => nameOf.get(id) ?? '–')
                : [countOf(t, locale, l.userIds.length, 'employees')]
    const edit = (l: Location) => setDraft({ id: l.id, name: l.name, point: `${l.latitude}, ${l.longitude}`, radius: String(l.radiusMeters), ips: l.officeIpRanges.join('\n'), everyone: l.everyone })
    const menu = (l: Location): MenuItem[] => l.archivedAt
        ? [{ key: 'restore', label: t('att_loc_restore'), icon: ArrowCounterClockwiseIcon, onSelect: () => { void send(`/api/attendance/locations/${l.id}/restore`, { method: 'POST' }, 'att_loc_restored') } }]
        : [
            { key: 'edit', label: t('att_loc_edit'), icon: PencilSimpleIcon, onSelect: () => edit(l) },
            ...(!l.everyone ? [{ key: 'people', label: t('att_loc_choose_people'), icon: UsersThreeIcon, onSelect: () => setStaffing(l) }] : []),
            { key: 'archive', label: t('att_loc_archive'), icon: ArchiveIcon, danger: true, onSelect: () => setArchiving(l) },
        ]

    return (
        <Card
            title={t('att_loc_title')}
            actions={!readOnly && (
                <Button variant="primary" icon={PlusIcon} disabled={busy} onClick={() => setDraft({ id: null, name: '', point: '', radius: '150', ips: '', everyone: false })}>{t('att_loc_add')}</Button>
            )}
        >
            <p className="ui-card-note">{t('att_loc_hint')}</p>
            {locations.length === 0 ? <p className="ui-card-note">{t('att_loc_none')}</p> : (
                <ul className="ui-rows ui-rows-flush" aria-label={t('att_loc_title')}>
                    {locations.map(l => (
                        <Row
                            key={l.id}
                            title={<>
                                <bdi>{l.name}</bdi>
                                {l.archivedAt && <>{' '}<StatusBadge tone="neutral">{t('att_loc_archived_badge')}</StatusBadge></>}
                            </>}
                            // Each fact kept apart from the next, a person's name among them (audit on part 3c),
                            // all in one span: the detail line puts a gap between its children.
                            detail={<span>
                                {[
                                    t('att_loc_radius_m').replace('{n}', number(l.radiusMeters)),
                                    ...(l.officeIpRanges.length > 0 ? [t('att_loc_ip_line').replace('{n}', number(l.officeIpRanges.length))] : []),
                                    ...who(l),
                                ].map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}
                                {t('list_separator')}
                                <a href={mapLink(l)} target="_blank" rel="noopener noreferrer">{t('att_loc_map')}</a>
                            </span>}
                            end={!readOnly && <RowMenu label={t('ui_more_actions_for').replace('{name}', l.name)} tooltip={t('ui_more_actions')} items={menu(l)} />}
                        />
                    ))}
                </ul>
            )}

            {draft && (
                <PlaceDialog draft={draft} busy={busy} onClose={() => setDraft(null)} onSubmit={async (d, point) => {
                    const input = {
                        name: d.name.trim(), ...point, radiusMeters: Number(d.radius),
                        officeIpRanges: d.ips.split(/[\n,]/).map(s => s.trim()).filter(Boolean), everyone: d.everyone,
                    }
                    if (d.id) await send(`/api/attendance/locations/${d.id}`, { method: 'PATCH', body: JSON.stringify(input) }, 'att_loc_saved', () => setDraft(null))
                    else await send('/api/attendance/locations', { method: 'POST', body: JSON.stringify({ companyId, ...input }) }, 'att_loc_added', () => setDraft(null))
                }} />
            )}

            {staffing && (
                <PeopleDialog location={staffing} people={people} busy={busy} onClose={() => setStaffing(null)} onSubmit={async userIds => {
                    await send(`/api/attendance/locations/${staffing.id}/people`, { method: 'PUT', body: JSON.stringify({ userIds }) }, 'att_loc_saved', () => setStaffing(null))
                }} />
            )}

            {/* Archiving stops check-ins there until it's restored: asked about first. */}
            <Dialog
                open={!!archiving}
                onClose={() => { if (!busy) setArchiving(null) }}
                title={t('att_loc_archive_title').replace('{name}', archiving?.name ?? '')}
                actions={<>
                    <Button onClick={() => setArchiving(null)} disabled={busy}>{t('cancel')}</Button>
                    <Button variant="danger" busy={busy} onClick={() => { if (archiving) void send(`/api/attendance/locations/${archiving.id}`, { method: 'DELETE' }, 'att_loc_archived', () => setArchiving(null)) }}>{t('att_loc_archive')}</Button>
                </>}
            >
                <p>{t('att_loc_archive_body')}</p>
            </Dialog>
        </Card>
    )
}

/**
 * A place: its name, the point (typed, or set on the map), how far around it
 * counts, the office's IPs, and whether everyone may check in there. What's
 * wrong is said under each field when it's saved.
 */
export function PlaceDialog({ draft: start, busy, onClose, onSubmit }: {
    draft: Draft
    busy: boolean
    onClose: () => void
    onSubmit: (draft: Draft, point: { latitude: number; longitude: number }) => Promise<void>
}) {
    const { t } = useLanguage()
    const formRef = useRef<HTMLFormElement>(null)
    const [draft, setDraft] = useState<Draft>(start)
    const [errors, setErrors] = useState<PlaceErrors>({})
    const point = parsePoint(draft.point)
    const edit = (change: Partial<Draft>, field?: keyof PlaceErrors) => {
        setDraft(d => ({ ...d, ...change }))
        if (field) setErrors(e => ({ ...e, [field]: undefined }))
    }
    const submit = async (e: FormEvent) => {
        e.preventDefault()
        const found = placeErrors(draft)
        setErrors(found)
        if (Object.keys(found).length > 0 || !point) { focusFirstWrong(formRef.current); return }
        await onSubmit(draft, point)
    }
    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={start.id ? t('att_loc_edit_title').replace('{name}', start.name) : t('att_loc_add')}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={submit}>
                <Field label={t('att_loc_name')} hint={t('att_loc_name_hint')} error={errors.name && t(errors.name)}>{p => (
                    <TextInput {...p} name="name" autoComplete="off" maxLength={80} value={draft.name} onChange={e => edit({ name: e.target.value }, 'name')} />
                )}</Field>
                <div className="ui-field">
                    <Field label={t('att_loc_point')} hint={t('att_loc_point_hint')} error={errors.point && t(errors.point)}>{p => (
                        // Not a decimal keypad: on a phone it has no comma or minus (audit on part 3c).
                        <TextInput {...p} name="point" dir="ltr" autoComplete="off" value={draft.point} onChange={e => edit({ point: e.target.value }, 'point')} />
                    )}</Field>
                    {point && <a className="ui-field-link" href={mapLink(point)} target="_blank" rel="noopener noreferrer">{t('att_loc_map')}</a>}
                </div>
                <PointPicker value={draft.point} radius={Number(draft.radius) || 0} onChange={text => edit({ point: text }, 'point')} />
                <Field label={t('att_loc_radius')} hint={t('att_loc_radius_hint')} error={errors.radius && t(errors.radius)}>{p => (
                    <TextInput {...p} name="radius" type="number" inputMode="numeric" autoComplete="off" min={20} max={5000} step={10} value={draft.radius} onChange={e => edit({ radius: e.target.value }, 'radius')} />
                )}</Field>
                <Field label={t('att_loc_ips')} hint={t('att_loc_ips_hint')}>{p => (
                    <TextArea {...p} name="ips" dir="ltr" rows={3} spellCheck={false} value={draft.ips} onChange={e => edit({ ips: e.target.value })} />
                )}</Field>
                <label className="ui-choice">
                    <input type="checkbox" className="ui-check" checked={draft.everyone} onChange={e => edit({ everyone: e.target.checked })} />
                    {t('att_loc_everyone')}
                </label>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('save')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/** Who may check in at a place, picked from a list that can be searched, as a task's assignees are. */
function PeopleDialog({ location, people, busy, onClose, onSubmit }: {
    location: Location
    people: Person[]
    busy: boolean
    onClose: () => void
    onSubmit: (userIds: string[]) => Promise<void>
}) {
    const { t } = useLanguage()
    const [chosen, setChosen] = useState<string[]>(location.userIds)
    return (
        <Dialog
            open
            onClose={() => { if (!busy) onClose() }}
            title={t('att_loc_people_title').replace('{name}', location.name)}
            actions={<>
                <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                <Button variant="primary" busy={busy} onClick={() => { void onSubmit(chosen) }}>{t('save')}</Button>
            </>}
        >
            <AssigneeChecklist
                legend={t('att_loc_people')}
                people={people.map(p => ({ id: p.id, firstName: p.name, lastName: '' }))}
                value={chosen}
                onChange={setChosen}
                onRetry={() => {}}
            />
        </Dialog>
    )
}
