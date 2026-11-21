'use client'

import { Fragment, useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { PrinterIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import { Button, Choice, Field, Page, PageHeader, Select } from '@/components/ui'
import { SetupGuideSteps, Sentence, WayChoice, type GuideBrand, type Way } from '@/components/TerminalSetupGuide'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useHydrated } from '@/lib/useHydrated'
import { COMMAND_SHELLS, SHELL_NAMES, type CommandShell } from '@/lib/attendance/setup-guide'
import { useGuideShell } from '@/lib/attendance/guide-shell'

/**
 * How to set up a fingerprint terminal, on a page of its own
 * (ATTENDANCE_PLAN.md §17.7; DESIGN.md §5.5, A guide's page; PR 356), as the
 * owner approved in the Fingerprint terminal setup guide canvas. Opened from
 * the round "i" on Fingerprint terminals: the company's people's own at
 * /dashboard/settings/terminal-guide, a company's for the Super Admin under
 * the company (`companyId`). It changes nothing.
 *
 * Under its header, what the steps depend on: the model, from the brands the
 * terminals list offers, how a ZKTeco model's scans reach the agent, and the
 * program the commands are typed in, Command Prompt or PowerShell, kept in
 * the browser (lib/attendance/guide-shell.ts). Then the steps, every command
 * written for that program; Print prints them alone.
 *
 * For whoever may set the company's terminals up: the list answers anyone
 * else 403 or 404 (§17.10), and the page then refuses them, as the card
 * hides itself from them.
 */
export default function TerminalGuidePage({ companyId }: { companyId?: string }) {
    const { t } = useLanguage()
    const { data: session } = useSession()
    const superAdmin = session?.user?.role === 'SUPER_ADMIN'
    const q = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''
    const { data, error } = useSWR(`/api/attendance/devices${q}`, fetcher)
    const [brandId, setBrandId] = useState('')
    const [way, setWay] = useState<Way>('READ')
    const [shell, setShell] = useGuideShell()

    const status = (error as SWRError | undefined)?.status
    if (status === 403 || status === 404) return <AccessDenied />

    const loaded = data?.data
    // null until the list, which offers them, has loaded.
    const brands: GuideBrand[] | null = loaded ? loaded.brands ?? [] : null
    const loadFailed = !!error && !loaded
    const brand = brands?.find(b => b.id === brandId) ?? null
    const options = brands === null
        ? [{ value: '', label: t('loading') }]
        : [{ value: '', label: t('att_guide_model_pick') }, ...brands.map(b => ({ value: b.id, label: b.name }))]
    const back = companyId ? `/dashboard/companies/${encodeURIComponent(companyId)}/settings?tab=attendance` : '/dashboard/settings?tab=attendance'

    return (
        <Page>
            <PageHeader
                back={{ href: back, label: t('att_term_title') }}
                title={t('att_guide_button')}
                subtitle={t('att_guide_subtitle')}
                action={<Button icon={PrinterIcon} onClick={() => window.print()}>{t('doc_print')}</Button>}
            />
            {/* What the steps depend on; the page's own heading names it. */}
            <div className="ui-panel ui-card ui-guide-picks">
                {loadFailed ? <p className="ui-card-note" role="status">{t('att_term_load_failed')}</p>
                : brands?.length === 0 ? <p className="ui-card-note">{t('att_guide_no_models')}</p> : <>
                    <Field label={t('att_guide_model')}>{p => (
                        // Another model starts again from the agent reading its scans (PR 306).
                        <Select {...p} name="model" value={brandId} disabled={brands === null} onChange={e => { setBrandId(e.target.value); setWay('READ') }} options={options} />
                    )}</Field>
                    {brands !== null && !brand && <p className="ui-card-note">{t('att_guide_pick_first')}</p>}
                </>}
                {brand && <WayChoice brand={brand} way={way} onChange={setWay} />}
                <Choice legend={t('att_guide_shell')} name="shell" value={shell} onChange={setShell}
                    options={COMMAND_SHELLS.map(s => ({ value: s, label: <span translate="no">{SHELL_NAMES[s]}</span> }))} />
                <p className="ui-hint"><Sentence text={t(`att_guide_shell_${shell}_hint`)} /></p>
            </div>
            {brand && <GuideSteps brand={brand} superAdmin={superAdmin} directAllowed={loaded?.directAllowed ?? false}
                server={window.location.origin} shell={shell} pushes={brand.protocol === 'ZKTECO' && way === 'PUSH'} />}
        </Page>
    )
}

/** A name as it's printed, never machine-translated, in its slot. */
function slotted(text: string, slots: Record<string, ReactNode>): ReactNode {
    return text.split(/(\{[a-z]+\})/).map((part, i) => {
        const slot = /^\{([a-z]+)\}$/.exec(part)
        return slot && slot[1] in slots ? <Fragment key={i}>{slots[slot[1]]}</Fragment> : part
    })
}

/**
 * The steps for the model and the program picked: the only part of the page
 * that prints (`print-document`), under a line naming them and the day it's
 * printed, which only paper shows.
 */
export function GuideSteps({ brand, superAdmin, directAllowed, server, shell, pushes }: {
    brand: GuideBrand
    superAdmin: boolean
    directAllowed: boolean
    server: string
    shell: CommandShell
    pushes: boolean
}) {
    const { t, locale } = useLanguage()
    // The day it's printed, where it's printed: the server's day may be another.
    const hydrated = useHydrated()
    const today = hydrated ? new Date().toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
    return (
        <div className="print-document ui-guide-page">
            <div className="ui-doc-print-only">
                <p className="ui-guide-print-title">{t('att_guide_button')}</p>
                <p>{slotted(t('att_guide_printed'), {
                    model: <bdi translate="no">{brand.name}</bdi>,
                    program: <span translate="no">{SHELL_NAMES[shell]}</span>,
                    date: today,
                })}</p>
            </div>
            <SetupGuideSteps brand={brand} superAdmin={superAdmin} directAllowed={directAllowed} server={server} pushes={pushes} shell={shell} />
        </div>
    )
}
