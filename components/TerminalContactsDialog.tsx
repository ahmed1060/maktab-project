'use client'

import { Fragment, useState } from 'react'
import useSWR from 'swr'
import { WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Dialog, DisclosureRow, EmptyState } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { refusalWords } from '@/lib/attendance/terminal-connections'
import { CodeBox } from '@/components/TerminalSetupGuide'
import type { TranslationKey } from '@/lib/translations'

/**
 * A terminal's first contacts, for the Super Admin (ATTENDANCE_PLAN.md
 * §17.8, PR 294; DESIGN.md §5.5, Dialog): what a terminal straight to Nizmo
 * sent in its first requests, in the order they came, to compare with what
 * Nizmo expects. Each is a row that opens (§5.5, Rows): it says what Nizmo
 * made of the request and when it came, and opens onto what it sent, in
 * boxes left to right and never translated. Several can be open at once, to
 * set two requests side by side. It changes nothing: Close is its only
 * button.
 */

type Contact = {
    id: string; receivedAt: string; method: string; path: string
    headers: Record<string, string>; otherHeaders: string[]; body: string; kind: string; outcome: string[]
}
type Kept = { name: string; firstContactAt: string | null; keptUntil: string | null; keeping: boolean; contacts: Contact[] }

/** How often the list is asked for again while the dialog is open. */
const REFRESH_MS = 10_000

const OUTCOME: Record<string, TranslationKey> = {
    STORED: 'att_term_contact_STORED', ALREADY: 'att_term_contact_ALREADY', SKIPPED: 'att_term_contact_SKIPPED',
    NOTHING: 'att_term_contact_NOTHING', UNREADABLE: 'att_term_contact_UNREADABLE', EMPTY: 'att_term_contact_EMPTY',
}

export function TerminalContactsDialog({ deviceId, name, onClose }: { deviceId: string; name: string; onClose: () => void }) {
    const { t, locale } = useLanguage()
    // Asked again while it's open: someone trying a terminal watches its requests arrive, each added at the end.
    const { data, error, isValidating, mutate } = useSWR(`/api/attendance/devices/${deviceId}/first-contacts`, fetcher, { refreshInterval: REFRESH_MS })
    const kept: Kept | undefined = data?.data
    const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
    const toggle = (id: string) => setOpen(was => {
        const next = new Set(was)
        if (!next.delete(id)) next.add(id)
        return next
    })
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    // To the second: a terminal's requests come seconds apart.
    const when = (iso: string) => new Date(iso).toLocaleString(intl, { dateStyle: 'medium', timeStyle: 'medium' })

    /** What Nizmo made of a request, in words; a reason with none yet is shown as it was kept. */
    const made = (code: string): string => {
        if (code.startsWith('REFUSED:')) {
            const reason = code.slice('REFUSED:'.length)
            const words = refusalWords(reason)
            return t('att_term_contact_REFUSED').replace('{reason}', words ? t(words.key).replace('{type}', words.type ?? '') : reason)
        }
        const key = OUTCOME[code]
        return key ? t(key) : code
    }
    /** A request's first line and its headers, a line each, as they are written. */
    const headersOf = (c: Contact) => [`${c.method} ${c.path}`, ...Object.keys(c.headers).sort().map(name => `${name}: ${c.headers[name]}`)].join('\n')

    // Whether more are still kept is the server's to say: it is its clock that decides.
    const state = !kept ? null
        : !kept.firstContactAt || !kept.keptUntil ? t('att_term_contacts_none')
            : !kept.keeping ? t('att_term_contacts_over')
                : t('att_term_contacts_until').replace('{when}', when(kept.keptUntil))

    return (
        <Dialog open onClose={onClose} title={t('att_term_contacts_title').replace('{name}', name)} actions={<Button variant="primary" onClick={onClose}>{t('close')}</Button>}>
            <div className="ui-contacts">
                <p className="ui-hint">{t('att_term_contacts_intro')}</p>
                {!kept ? (
                    error
                        ? <EmptyState icon={WarningCircleIcon} title={t('att_term_contacts_failed')} detail={(error as SWRError).info?.error}
                            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                        : <p className="ui-card-note" role="status">{t('loading')}</p>
                ) : <>
                    <p className="ui-card-note">{state}</p>
                    {kept.contacts.length > 0 && (
                        <ol className="ui-rows ui-rows-flush" aria-label={t('att_term_contacts')}>
                            {kept.contacts.map(c => (
                                <DisclosureRow
                                    key={c.id}
                                    open={open.has(c.id)}
                                    onToggle={() => toggle(c.id)}
                                    // Each outcome in a run of its own, so two can't swap places in Arabic.
                                    title={c.outcome.map((code, i) => <Fragment key={code}>{i > 0 && t('list_separator')}<bdi>{made(code)}</bdi></Fragment>)}
                                    // One piece: a row's detail sets its pieces apart, which would split the line around its comma.
                                    // Its kind is the event's own type and codes: as the terminal writes them.
                                    detail={<span><bdi>{when(c.receivedAt)}</bdi>{t('list_separator')}<bdi dir="ltr" translate="no">{c.kind}</bdi></span>}
                                    label={t('att_term_contact_sent')}
                                >
                                    <dl className="ui-device-settings">
                                        <div>
                                            <dt>{t('att_term_contact_headers')}</dt>
                                            <dd><CodeBox scrolls code={headersOf(c)} /></dd>
                                        </div>
                                        {c.otherHeaders.length > 0 && (
                                            <div>
                                                <dt>{t('att_term_contact_other_headers')}</dt>
                                                <dd><CodeBox scrolls code={c.otherHeaders.join('\n')} /></dd>
                                            </div>
                                        )}
                                        <div>
                                            <dt>{t('att_term_contact_body')}</dt>
                                            <dd>{c.body ? <CodeBox scrolls code={c.body} /> : t('att_term_contact_no_body')}</dd>
                                        </div>
                                    </dl>
                                </DisclosureRow>
                            ))}
                        </ol>
                    )}
                </>}
            </div>
        </Dialog>
    )
}
