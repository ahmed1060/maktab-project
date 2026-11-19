'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { ArrowClockwiseIcon, HourglassIcon, TrashIcon, UserPlusIcon, UsersIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, ConfirmDialog, EmptyState, Person, Row, RowMenu, Rows, Section, StatusBadge, type MenuItem } from '@/components/ui'
import { formatMoment } from '@/components/records/types'
import { fetcher } from '@/lib/swr-fetcher'
import type { ClientPeople as People, ClientPerson } from '@/lib/client-accounts'
import { clientPeopleUrl, personActions, personRefusal, personStatus, type PersonChange } from '@/lib/client-people'
import { waitText } from '@/lib/login-errors'
import AddClientPerson from './AddClientPerson'

/**
 * People who can sign in, on a client's page (CLIENT_PORTAL_PLAN.md §5.2,
 * step 6c-1, PR 326; DESIGN.md §5.5, People who can sign in): the client's
 * people who sign in to the client portal, for whoever may manage them.
 * Each says when they last signed in, or that they're invited; Add person
 * invites one, and each row's menu sends their invitation again or removes
 * them. An archived client's people are listed, to be removed, and none is
 * added, as they can't sign in (§5.3).
 *
 * Every change goes through the routes 6a and 6b made, which ask for the
 * step-up confirmation where the company asks for it: the code's dialog
 * comes up by itself (StepUpInterceptor), and the change is sent again once
 * it's given.
 */
export default function ClientPeople({ clientId, archived }: { clientId: string; archived: boolean }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data, error, isValidating, mutate } = useSWR<{ data: People }>(clientPeopleUrl(clientId), fetcher)
    const [adding, setAdding] = useState(false)
    const [removing, setRemoving] = useState<ClientPerson | null>(null)
    const people = data?.data

    // When they were invited or last signed in: a moment, on the reader's calendar.
    const day = (iso: string) => formatMoment(iso, locale)

    /**
     * A refused change, said in a toast in the page's language (personRefusal).
     * The list is read again, as what refused it, such as a password set or
     * a person removed meanwhile, may be what changed.
     */
    const refused = (res: Response, answer: { code?: unknown; wait?: unknown; error?: unknown } | null, change: PersonChange, person: ClientPerson) => {
        const refusal = personRefusal(res.status, answer, change)
        // The code prompt, turned down: it said what it needed.
        if (refusal === 'quiet') return
        void mutate()
        if (!refusal) {
            showToast(typeof answer?.error === 'string' && answer.error ? answer.error : t('error_generic'), 'error')
            return
        }
        const said = t(refusal.key).replace('{name}', person.name)
        showToast(refusal.wait ? said.replace('{time}', waitText(refusal.wait * 1000, locale)) : said, 'error')
    }

    const resend = async (person: ClientPerson) => {
        try {
            const res = await fetch(`/api/client-accounts/${encodeURIComponent(person.id)}/invitation`, { method: 'POST' })
            const answer = await res.json().catch(() => null)
            if (!res.ok) return refused(res, answer, 'resend', person)
            showToast(t('client_people_resent').replace('{email}', person.email), 'success')
            void mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        }
    }

    // Returned, so the confirmation shows it working until it's done.
    const remove = async () => {
        if (!removing) return
        const person = removing
        try {
            const res = await fetch(`/api/client-accounts/${encodeURIComponent(person.id)}`, { method: 'DELETE' })
            const answer = await res.json().catch(() => null)
            if (!res.ok) return refused(res, answer, 'remove', person)
            showToast(t('client_people_removed').replace('{name}', person.name), 'success')
            void mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setRemoving(null)
        }
    }

    const menu = (person: ClientPerson): MenuItem[] => personActions(person).map(action => action === 'resend'
        ? { key: 'resend', label: t('client_people_resend'), icon: ArrowClockwiseIcon, onSelect: () => { void resend(person) } }
        : { key: 'remove', label: t('client_people_remove'), icon: TrashIcon, danger: true, onSelect: () => setRemoving(person) })

    const end = (person: ClientPerson) => {
        const status = personStatus(person)
        return (
            <span className="ui-row-actions">
                {status.kind === 'invited'
                    ? <StatusBadge tone="waiting">{t('client_people_invited')}</StatusBadge>
                    : <span className="ui-item-detail">{status.kind === 'last' ? t('client_people_last').replace('{day}', day(status.at)) : t('client_people_never')}</span>}
                <RowMenu label={t('ui_more_actions_for').replace('{name}', person.name)} tooltip={t('ui_more_actions')} items={menu(person)} />
            </span>
        )
    }

    return (
        <Section
            title={t('client_people_title')}
            action={!archived && people && <Button size="sm" icon={UserPlusIcon} onClick={() => setAdding(true)}>{t('client_people_add')}</Button>}
        >
            <p className="ui-hint">{t('client_people_line')}</p>
            {!people
                ? error
                    ? <div className="ui-panel"><EmptyState icon={WarningCircleIcon} title={t('client_people_failed')} action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} /></div>
                    : <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('client_people_loading')} /></div>
                : people.people.length === 0
                    ? <div className="ui-panel"><EmptyState icon={UsersIcon} title={t('client_people_none')} detail={archived ? undefined : t('client_people_none_detail')} /></div>
                    : (
                        <Rows label={t('client_people_title')}>
                            {people.people.map(person => {
                                const status = personStatus(person)
                                return (
                                    <Row
                                        key={person.id}
                                        title={<Person names={[person.name]} />}
                                        detail={<bdi dir="ltr">{person.email}</bdi>}
                                        note={status.kind === 'invited' ? t('client_people_invited_on').replace('{day}', day(status.since)) : undefined}
                                        end={end(person)}
                                    />
                                )
                            })}
                        </Rows>
                    )}

            {people && (
                <AddClientPerson
                    open={adding}
                    client={people.client}
                    onClose={() => setAdding(false)}
                    onAdded={person => {
                        setAdding(false)
                        showToast(t('client_person_sent').replace('{email}', person.email), 'success')
                        void mutate()
                    }}
                />
            )}

            <ConfirmDialog
                open={!!removing}
                danger
                title={t('client_people_remove_title').replace('{name}', removing?.name ?? '')}
                body={t('client_people_remove_body')}
                confirmLabel={t('client_people_remove')}
                onConfirm={remove}
                onCancel={() => setRemoving(null)}
            />
        </Section>
    )
}
