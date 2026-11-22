'use client'

import { useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Field, Select, type SelectOption } from '@/components/ui'
import { fetcher } from '@/lib/swr-fetcher'
import type { AccountantCandidate, ClientAccountant } from '@/lib/client-accountant'

type Picker = {
    /** Who may be picked, or null while they load. */
    people: AccountantCandidate[] | null
    /** The one picked, '' for no one. */
    value: string
    busy: boolean
    onPick: (id: string) => void
}

/** A sentence with a person's name in it, the name kept apart from the words around it. */
function named(sentence: string, name: string): ReactNode {
    const [before, after = ''] = sentence.split('{name}')
    return <>{before}<bdi>{name}</bdi>{after}</>
}

/**
 * The responsible accountant at the foot of a client's Tax position
 * (CLIENT_PORTAL_PLAN.md §7, §12 step 9b; DESIGN.md §5.5; PR 343), as the
 * owner's mockup draws it: who it is, a select for whoever may pick one, and
 * beside it the accountant's WhatsApp number, or why the client's people
 * can't write to anyone, with the way to fix it.
 *
 * What's beside the select is read out when a pick changes it.
 */
export function AccountantPanel({ accountant, picker, editsProfile }: {
    accountant: ClientAccountant
    /** Null for whoever may only see it, and on an archived client. */
    picker: Picker | null
    /** Whether the viewer may edit the accountant's profile, where their number is changed. */
    editsProfile: boolean
}) {
    const { t } = useLanguage()
    const { person, reach } = accountant
    const profile = person && editsProfile ? `/dashboard/employees/${person.id}` : null

    // One whose contract has ended stays shown, greyed, until another is picked.
    const kept: SelectOption[] = person && picker && !picker.people?.some(p => p.id === person.id)
        ? [{ value: person.id, label: person.name, disabled: person.ended }]
        : []
    const options: SelectOption[] = [
        { value: '', label: t('client_accountant_no_one') },
        ...kept,
        ...(picker?.people ?? []).map(p => ({ value: p.id, label: p.name })),
    ]

    const note = (text: ReactNode, link?: ReactNode) => <p className="ui-accountant-note">{text}{link && <> {link}</>}</p>

    return (
        <div className="ui-panel ui-accountant">
            <div className="ui-accountant-pick">
                {picker ? (
                    <Field label={t('client_accountant_label')} hint={t('client_accountant_hint')}>
                        {control => (
                            <Select
                                {...control}
                                options={options}
                                value={picker.value}
                                disabled={picker.busy || !picker.people}
                                onChange={event => picker.onPick(event.target.value)}
                            />
                        )}
                    </Field>
                ) : (
                    <dl className="ui-accountant-fact">
                        <dt className="ui-label">{t('client_accountant_label')}</dt>
                        <dd>{person ? <bdi>{person.name}</bdi> : t('client_accountant_no_one')}</dd>
                    </dl>
                )}
            </div>
            <div className="ui-accountant-reach" data-reach={reach} aria-live="polite">
                {reach === 'whatsapp' && person && (
                    <>
                        <dl className="ui-accountant-fact">
                            <dt className="ui-label">{named(t('client_accountant_number'), person.name)}</dt>
                            <dd><bdi dir="ltr" className="ui-num">{person.whatsappNumber}</bdi></dd>
                        </dl>
                        {profile && <a className="ui-text-link" href={profile}>{t('client_accountant_change_number')}</a>}
                    </>
                )}
                {reach === 'none' && note(t('client_accountant_none'))}
                {reach === 'no_number' && person && note(
                    named(t('client_accountant_no_number'), person.name),
                    profile && <a className="ui-text-link" href={profile}>{t('client_accountant_add_number')}</a>,
                )}
                {reach === 'ended' && person && note(named(t('client_accountant_ended'), person.name))}
            </div>
        </div>
    )
}

/**
 * The panel on a client's page. For whoever picks, on a client that isn't
 * archived, it lists who may be picked and saves each pick as it's made;
 * for anyone else it's what's kept, as text.
 */
export default function ResponsibleAccountant({ clientId, accountant, archived, picks, editsProfile, onSaved }: {
    clientId: string
    accountant: ClientAccountant
    archived: boolean
    /** Whether the viewer may edit clients, and so pick one. */
    picks: boolean
    /** Whether the viewer may edit a person's profile, where their number is changed (lib/profile-access.ts). */
    editsProfile: (person: { id: string; role: string }) => boolean
    /** Reads the section again, which brings the new accountant. */
    onSaved: () => Promise<unknown>
}) {
    const edits = !!accountant.person && editsProfile(accountant.person)
    if (picks && !archived) return <AccountantPicker clientId={clientId} accountant={accountant} editsProfile={edits} onSaved={onSaved} />
    return <AccountantPanel accountant={accountant} picker={null} editsProfile={edits} />
}

/** The select, with who may be picked, saving each pick as it's made. */
function AccountantPicker({ clientId, accountant, editsProfile, onSaved }: {
    clientId: string
    accountant: ClientAccountant
    editsProfile: boolean
    onSaved: () => Promise<unknown>
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [pending, setPending] = useState<string | null>(null)
    const { data } = useSWR<{ data: { people: AccountantCandidate[] } }>(`/api/clients/accountant?clientId=${encodeURIComponent(clientId)}`, fetcher)

    const pick = async (id: string) => {
        setPending(id)
        try {
            const res = await fetch('/api/clients/accountant', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, userId: id || null }),
            })
            if (!res.ok) {
                showToast(t('client_accountant_failed'), 'error')
                return
            }
            showToast(t(id ? 'client_accountant_saved' : 'client_accountant_removed'), 'success')
            // The pick stays shown until the section has read itself again, so the select doesn't flick back.
            await onSaved()
        } catch {
            showToast(t('client_accountant_failed'), 'error')
        } finally {
            // What's kept shows again: the new pick, or the old one where it wasn't saved.
            setPending(null)
        }
    }

    const picker = { people: data?.data.people ?? null, value: pending ?? accountant.person?.id ?? '', busy: pending !== null, onPick: (id: string) => { void pick(id) } }
    return <AccountantPanel accountant={accountant} picker={picker} editsProfile={editsProfile} />
}
