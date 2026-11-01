'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { CheckCircleIcon, HashIcon, HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, DataList, Details, Dialog, EmptyState, Field, ItemTitle, ListCard, Row, Rows, Section, Select, TextInput, type Column } from '@/components/ui'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useBusyAction } from '@/lib/useBusyAction'
import { send, json } from './send'
import { useFigures } from './period'

/**
 * Employee numbers (ATTENDANCE_PLAN.md Phase 0): each terminal knows people
 * by a number. Saying who a number is gives them its punches already
 * imported; removing one saved against the wrong person gives their
 * imported punches in open months back to nobody.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Attendance part 6, PR 152):
 * the numbers waiting for a person as a list (DESIGN.md §5.4), each with whose
 * it is to pick and Save; saving a number by hand in a form; the numbers
 * saved as rows; and removing one in the building blocks' dialog.
 */

type Codes = { mapped: { id: string; code: string; userId: string; name: string }[]; unmatched: { code: string; punches: number; from: string; to: string }[] }
type Waiting = Codes['unmatched'][number]
type Mapped = Codes['mapped'][number]
type Person = { id: string; name: string; teamLeaderId: string | null }

export default function NumbersTab({ q, companyId }: { q: string; companyId: string | null }) {
    const { t } = useLanguage()
    const { num, date } = useFigures()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const me = session?.user?.id
    const { data: body, error, isValidating, mutate } = useSWR(`/api/attendance/codes?${q}`, fetcher)
    const { data: peopleBody } = useSWR(`/api/attendance/people?${q}`, fetcher)
    const codes: Codes | null = body?.data ?? null
    // Nobody saves their own number: their punches would be theirs to make count.
    const people: Person[] = (peopleBody?.data?.people ?? []).filter((x: Person) => x.id !== me)
    const [choice, setChoice] = useState<Record<string, string>>({})
    const [newCode, setNewCode] = useState('')
    const [newPerson, setNewPerson] = useState('')
    const [removing, setRemoving] = useState<Mapped | null>(null)
    const action = useBusyAction()

    const map = async (code: string, userId: string) => {
        const r = await send('/api/attendance/codes', json('POST', { ...(companyId ? { companyId } : {}), code, userId }), t('punch_failed'))
        if (!r.ok) return showToast(r.error, 'error')
        showToast(t('punch_number_mapped').replace('{n}', num(r.body?.filled ?? 0)), 'success')
        setNewCode(''); setNewPerson('')
        await mutate()
    }
    // Not while it works: closing then would hide the answer.
    const closeRemove = () => { if (!action.running) setRemoving(null) }
    const unmap = () => action.run('remove', async () => {
        if (!removing) return
        const r = await send(`/api/attendance/codes/${removing.id}`, { method: 'DELETE' }, t('punch_failed'))
        // Refused, it stays open, to try again.
        if (!r.ok) return showToast(r.error, 'error')
        showToast(t('punch_number_removed'), 'success')
        setRemoving(null)
        await mutate()
    })

    if (error && !codes) return (
        <div className="ui-panel">
            <EmptyState icon={WarningCircleIcon} title={t('punch_numbers_load_failed')} detail={(error as SWRError).info?.error}
                action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
        </div>
    )
    if (!codes) return <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>

    const personOptions = [{ value: '', label: t('punch_choose_person') }, ...people.map(x => ({ value: x.id, label: x.name }))]
    const seen = (u: Waiting) => t('punch_numbers_seen').replace('{n}', num(u.punches)).replace('{from}', date(u.from)).replace('{to}', date(u.to))
    // Whose a waiting number is, picked in its row, and Save.
    const whose = (u: Waiting) => (
        <Select aria-label={t('punch_person_for').replace('{code}', u.code)} value={choice[u.code] ?? ''} disabled={action.running}
            onChange={e => setChoice({ ...choice, [u.code]: e.target.value })} options={personOptions} />
    )
    const save = (u: Waiting) => (
        <Button variant="primary" size="sm" disabled={!choice[u.code] || action.running} busy={action.is(`map-${u.code}`)}
            onClick={() => { void action.run(`map-${u.code}`, () => map(u.code, choice[u.code])) }}>{t('punch_map')}</Button>
    )
    const columns: Column<Waiting>[] = [
        { key: 'code', header: t('punch_column_code'), cell: u => <ItemTitle title={<bdi>{u.code}</bdi>} detail={seen(u)} /> },
        { key: 'person', header: t('punch_person'), cell: whose },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell: save },
    ]

    return (
        <>
            <Section title={t('punch_numbers_waiting')}>
                <p className="ui-hint">{t('punch_numbers_waiting_hint')}</p>
                <DataList caption={t('punch_numbers_waiting')} columns={columns} rows={codes.unmatched} rowKey={u => u.code}
                    card={u => <ListCard title={<bdi>{u.code}</bdi>} details={[{ icon: HashIcon, text: seen(u) }]}
                        foot={<span className="ui-row-actions">{whose(u)}{save(u)}</span>} />}
                    empty={<EmptyState icon={CheckCircleIcon} title={t('punch_numbers_none_waiting')} />} />
            </Section>

            <Card title={t('punch_numbers_mapped')}>
                {/* A number saved by hand, before its punches come in. */}
                <form className="ui-field-row" noValidate onSubmit={e => {
                    e.preventDefault()
                    if (newCode.trim() && newPerson) void action.run('map-new', () => map(newCode.trim(), newPerson))
                }}>
                    <Field label={t('punch_column_code')}>{f => (
                        <TextInput {...f} name="code" dir="ltr" inputMode="numeric" autoComplete="off" value={newCode} disabled={action.running} onChange={e => setNewCode(e.target.value)} />
                    )}</Field>
                    <Field label={t('punch_person')}>{f => (
                        <Select {...f} value={newPerson} disabled={action.running} onChange={e => setNewPerson(e.target.value)} options={personOptions} />
                    )}</Field>
                    <Button type="submit" disabled={!newCode.trim() || !newPerson || action.running} busy={action.is('map-new')}>{t('punch_map')}</Button>
                </form>
                {codes.mapped.length === 0 ? (
                    <p className="ui-card-note">{t('punch_numbers_none_mapped')}</p>
                ) : (
                    <Rows label={t('punch_numbers_mapped')}>
                        {codes.mapped.map(m => (
                            <Row key={m.id} title={<bdi>{m.code}</bdi>} detail={m.name}
                                end={m.userId !== me ? <Button size="sm" disabled={action.running} onClick={() => setRemoving(m)}>{t('punch_number_remove')}</Button> : undefined} />
                        ))}
                    </Rows>
                )}
            </Card>

            {/* Removing a number gives its punches in open months back to nobody: it asks first. */}
            <Dialog
                open={removing !== null}
                onClose={closeRemove}
                title={t('punch_number_remove_title')}
                actions={<>
                    <Button onClick={closeRemove} disabled={action.running}>{t('cancel')}</Button>
                    <Button variant="danger" onClick={() => { void unmap() }} disabled={action.running} busy={action.is('remove')}>
                        {t('punch_number_remove')}
                    </Button>
                </>}
            >
                {removing && <Details items={[{ label: t('punch_column_code'), value: <bdi>{removing.code}</bdi> }, { label: t('punch_person'), value: removing.name }]} />}
                <p>{t('punch_number_remove_hint')}</p>
            </Dialog>
        </>
    )
}
