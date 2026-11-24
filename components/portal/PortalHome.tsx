'use client'

import { useState } from 'react'
import { ChatIcon, FileArrowDownIcon, ReceiptIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { BarsByPart, Button, ButtonExternal, Card, Columns, EmptyState, Icon, LargeFigure, Page, PageHeader, ShareBar, StatusBadge } from '@/components/ui'
import { ContactWhatsApp } from '@/components/portal/ContactWhatsApp'
import { PortalClaims } from '@/components/portal/PortalClaims'
import { formatDay } from '@/components/records/types'
import { useLanguage } from '@/context/LanguageContext'
import type { PortalAccountant } from '@/lib/client-accountant'
import type { ClientMessages } from '@/lib/client-message-template'
import { claimMessage, contactMessage, type ClaimAsked, type PageAsking, type Words } from '@/lib/contact-message'
import { countOf } from '@/lib/plural'
import { nameIn } from '@/lib/names'
import { paidShare, shortItemName, type PortalTaxPosition } from '@/lib/portal-tax'
import type { TranslationKey } from '@/lib/translations'

/**
 * The client's area's first page: the client's tax position
 * (CLIENT_PORTAL_PLAN.md §6, §12 step 8c; DESIGN.md §5.5, A client's tax
 * position; PRs 338 and 339). The client's name above Tax position, where
 * the figures come from and their day, what's owed, two cards of bars, by
 * item and by how late, and the claims by item, with a note at the end, as
 * the owner's mockup draws them (the Client tax position canvas). Before the
 * first upload, and with nothing open in the file, an empty state says so.
 *
 * Its client and figures are the session's, read on the server (page.tsx),
 * as is who its people can write to: the responsible accountant is named in
 * the subtitle, and where they have a WhatsApp number, Contact the accountant
 * opens Contact on WhatsApp with its message (step 9c; PR 344), as each
 * claim's Ask about this claim opens it with the claim's (step 9d; PR 345),
 * from the company's templates, else Nizmo's (step 10a; PR 346). Where no
 * one can be written to, there's neither, and the note says to contact the
 * office.
 *
 * Once the portal's file has been uploaded, Download the statement opens the
 * tax position statement in a tab of its own (step 12a; PR 352).
 */
/**
 * What Contact on WhatsApp opens with: from the page's header, its title and
 * the page's message; from a claim, Ask about a claim and that claim's, each
 * from its text in the page's language.
 */
export function askingOf(t: Words, locale: string, messages: ClientMessages, page: PageAsking, about: ClaimAsked | null): { title: string; message: string } {
    const language = locale === 'ar' ? 'ar' : 'en'
    return about
        ? { title: t('contact_about_claim'), message: claimMessage(locale, messages.claim[language], { ...page, ...about }) }
        : { title: t('portal_contact_accountant'), message: contactMessage(locale, messages.contact[language], page) }
}

export function PortalHome({ client, person, position, accountant, messages }: {
    client: string
    /** The client account's own name, which the message is from. */
    person: string
    position: PortalTaxPosition
    /** Who the client's people can write to (lib/client-accountant.ts). */
    accountant: PortalAccountant
    /** The texts its messages are filled from (lib/client-message-template.ts). */
    messages: ClientMessages
}) {
    const { t, locale } = useLanguage()
    const [contacting, setContacting] = useState(false)
    // What it was opened from: the header (null) or a claim. Kept while it
    // closes, so its words don't change as it goes.
    const [about, setAbout] = useState<ClaimAsked | null>(null)
    const open = (from: ClaimAsked | null) => {
        setAbout(from)
        setContacting(true)
    }
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const money = (n: number) => n.toLocaleString(intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const percent = (n: number) => n.toLocaleString(intl, { style: 'percent', maximumFractionDigits: 0 })
    // A day, and a name, kept on one line.
    const day = (d: string) => formatDay(d, locale).replace(/ /g, '\u00a0')
    const { asOf, totals } = position

    // Its name in the page's language (PR 418).
    const accountantName = accountant ? nameIn(locale, { en: accountant.name, ar: accountant.nameAr }) : ''
    const reachable = accountant?.whatsappNumber ? { name: accountantName, whatsappNumber: accountant.whatsappNumber } : null
    const from = asOf ? t('portal_tax_from').replace('{date}', day(asOf)) : null
    const [before, after = ''] = t('portal_tax_accountant').split('{name}')
    const who = accountant && <>{before}<bdi>{accountantName.replace(/ /g, '\u00a0')}</bdi>{after}</>
    const subtitle = from && who ? <>{from} {who}</> : from ?? who ?? undefined
    const header = (
        <PageHeader
            overline={client}
            title={t('tax_position')}
            subtitle={subtitle}
            action={reachable || asOf ? (
                <>
                    {reachable && <Button variant="primary" icon={ChatIcon} aria-haspopup="dialog" onClick={() => open(null)}>{t('portal_contact_accountant')}</Button>}
                    {/* Once there's something to put on it (step 12a; PR 352): the statement, in a tab of its own. */}
                    {asOf && <ButtonExternal icon={FileArrowDownIcon} href="/portal/statement">{t('tax_statement_download')}</ButtonExternal>}
                </>
            ) : undefined}
        />
    )
    const contact = reachable && (
        <ContactWhatsApp
            open={contacting}
            onClose={() => setContacting(false)}
            {...askingOf(t, locale, messages, { person, client, asOf }, about)}
            accountant={reachable}
            client={client}
        />
    )

    if (!asOf) {
        return (
            <Page>
                {header}
                <div className="ui-panel"><EmptyState icon={ReceiptIcon} title={t('portal_tax_none')} detail={t('portal_tax_none_detail')} /></div>
                {contact}
            </Page>
        )
    }

    if (totals.open === 0) {
        return (
            <Page>
                {header}
                <div className="ui-panel"><EmptyState icon={ReceiptIcon} title={t('tax_no_open_claims')} detail={t('tax_no_open_claims_detail').replace('{date}', day(asOf))} /></div>
                {contact}
            </Page>
        )
    }

    const claims = (n: number) => countOf(t, locale, n, 'claims')
    // "All open claims are late" is for more than one; one late claim of one is how many.
    const late = totals.late === 0 ? null
        : totals.late === totals.open && totals.open > 1 ? t('portal_tax_all_late')
            : t('portal_tax_some_late').replace('{count}', claims(totals.late))
    const share = paidShare(totals.paid, totals.original)

    return (
        <Page>
            {header}
            {/* Headed by its label, not a card's title, as the owner's mockup draws it. */}
            <section className="ui-panel ui-portal-owed" aria-labelledby="portal-tax-owed">
                <div className="ui-portal-owed-figure">
                    <h2 id="portal-tax-owed" className="ui-portal-owed-label">{t('portal_tax_owed')}</h2>
                    <LargeFigure value={money(totals.remaining)} unit={t('egp')} />
                    {late && <p className="ui-portal-owed-late"><StatusBadge tone="problem"><Icon icon={WarningCircleIcon} size={15} />{late}</StatusBadge></p>}
                </div>
                <div className="ui-portal-owed-paid">
                    <ShareBar
                        share={share}
                        line={t('portal_tax_share_paid').replace('{share}', percent(share))}
                        amounts={t('portal_tax_paid_of').replace('{paid}', money(totals.paid)).replace('{original}', money(totals.original)).replace('{currency}', t('egp'))}
                    />
                    <dl className="ui-portal-facts">
                        <div className="ui-portal-fact"><dt>{t('portal_tax_open_claims')}</dt><dd className="ui-num">{totals.open.toLocaleString(intl)}</dd></div>
                        <div className="ui-portal-fact"><dt>{t('tax_paid')}</dt><dd className="ui-num">{money(totals.paid)} <span className="ui-portal-fact-unit">{t('egp')}</span></dd></div>
                        <div className="ui-portal-fact">
                            <dt>{t('portal_tax_oldest_delay')}</dt>
                            {/* The days kept with their number. */}
                            <dd className="ui-num">{totals.oldestDelay > 0 ? countOf(t, locale, totals.oldestDelay, 'days').replace(/ /g, '\u00a0') : t('portal_tax_no_delay')}</dd>
                        </div>
                    </dl>
                </div>
            </section>
            <Columns>
                <Card title={t('portal_tax_by_item')} subtitle={t('portal_tax_by_item_hint')}>
                    {/* The largest first: byItem's order, ties by name, which the bars keep. */}
                    <BarsByPart label={t('portal_tax_by_item')} parts={position.items.map(item => ({
                        key: item.item,
                        name: item.item,
                        short: shortItemName(item.item),
                        value: item.remaining,
                        amount: money(item.remaining),
                        note: t('portal_tax_item_note').replace('{share}', percent(item.remaining / totals.remaining)).replace('{claims}', claims(item.claims.length)),
                    }))} />
                </Card>
                <Card title={t('portal_tax_how_late')} subtitle={t('portal_tax_how_late_hint')}>
                    <BarsByPart label={t('portal_tax_how_late')} ordered parts={position.late.map(row => ({
                        key: row.group,
                        name: t(`portal_tax_late_${row.group}` as TranslationKey),
                        value: row.remaining,
                        amount: money(row.remaining),
                        note: row.count > 0 ? claims(row.count) : t('portal_tax_no_claims'),
                    }))} />
                </Card>
            </Columns>
            <PortalClaims items={position.items} totals={totals} onAsk={reachable ? open : undefined} />
            {/* Where there's a button on each claim, the note points to it: in its row on computers, its card on phones, as the mockup says. */}
            <p className="ui-portal-note">
                {reachable ? (
                    <>
                        {t('portal_tax_note_figures').replace('{date}', day(asOf))}{' '}
                        <span className="ui-portal-note-row">{t('portal_tax_note_ask_row')}</span>
                        <span className="ui-portal-note-card">{t('portal_tax_note_ask_card')}</span>
                    </>
                ) : t('portal_tax_note').replace('{date}', day(asOf))}
            </p>
            {contact}
        </Page>
    )
}
