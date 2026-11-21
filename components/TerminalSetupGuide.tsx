'use client'

import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { forShell, inlineCode, setupGuide, type CommandShell, type GuideLine, type TerminalProtocol } from '@/lib/attendance/setup-guide'
import { mayConnect } from '@/lib/attendance/terminal-connections'
import { Button, Choice } from '@/components/ui'

/**
 * How to set up a fingerprint terminal (ATTENDANCE_PLAN.md §17.7, PR 282):
 * its pieces, shared by the guide's page (components/TerminalGuidePage.tsx,
 * PR 356) and Add a terminal. The steps follow the protocol of the model
 * picked from the Super Admin's brands not retired, with the model's notes
 * where its address is found, every command written for the program picked
 * (Command Prompt or PowerShell, PR 356).
 *
 * A model Nizmo doesn't read through the agent has no steps here. Where the
 * company may connect it straight to Nizmo (§17.8), the guide points to Add
 * a terminal, which shows what to set on it (PR 292).
 *
 * For a ZKTeco model, how its scans reach the agent is asked: the agent
 * reads them, or the terminal sends them to the agent (§17.12, PR 306).
 */

/** A brand the terminals list offers, with the Super Admin's notes on it. */
export type GuideBrand = { id: string; name: string; protocol: TerminalProtocol; notesEn: string | null; notesAr: string | null }

/** A name kept as it's printed, never machine-translated, where a sentence has its slot. */
function named(text: string, slot: string, name: string): ReactNode {
    const at = text.indexOf(slot)
    if (at < 0) return text
    return <>{text.slice(0, at)}<bdi translate="no">{name}</bdi>{text.slice(at + slot.length)}</>
}

/**
 * A sentence, what's typed in it left to right and untranslated, and the
 * model's name in its slot. A command named in it is written for the program
 * picked, as the boxes are (PR 356).
 */
export function Sentence({ text, brand, shell = 'CMD' }: { text: string; brand?: string; shell?: CommandShell }) {
    return <>{inlineCode(text).map((part, i) => 'code' in part
        ? <code key={i} className="ui-guide-inline" dir="ltr" translate="no">{forShell(part.code, shell)}</code>
        : <Fragment key={i}>{brand === undefined ? part.text : named(part.text, '{brand}', brand)}</Fragment>)}</>
}

/** The model's notes, the Super Admin's, in the page's language, or else the other's, marked as that language; null when it has none. */
export function ModelNotes({ brand }: { brand: Pick<GuideBrand, 'name' | 'notesEn' | 'notesAr'> }) {
    const { t, locale } = useLanguage()
    const own = locale === 'ar' ? brand.notesAr : brand.notesEn
    const other = locale === 'ar' ? brand.notesEn : brand.notesAr
    if (own) return <>{named(`${t('att_guide_model_notes')} `, '{model}', brand.name)}<bdi>{own}</bdi></>
    if (other) return <>{named(`${t('att_guide_model_notes_other')} `, '{model}', brand.name)}<bdi lang={locale === 'ar' ? 'en' : 'ar'}>{other}</bdi></>
    return null
}

/** How a ZKTeco terminal's scans reach the agent (§17.12): read by it, as most are, or sent to it. */
export const WAYS = ['READ', 'PUSH'] as const
export type Way = typeof WAYS[number]

/**
 * For a ZKTeco model, how its scans reach the agent, the agent reading them
 * picked to start with, and a line on which terminals the way picked is for
 * (DESIGN.md §5.5, A guide's page; PR 306). A Hikvision model is always read
 * (§17.12), so it isn't asked.
 */
export function WayChoice({ brand, way, onChange }: { brand: GuideBrand; way: Way; onChange: (way: Way) => void }) {
    const { t } = useLanguage()
    if (brand.protocol !== 'ZKTECO') return null
    return (<>
        <Choice legend={t('att_guide_way')} name="way" value={way} onChange={onChange} options={WAYS.map(w => ({ value: w, label: t(`att_guide_way_${w}`) }))} />
        <p className="ui-hint"><Sentence text={t(`att_guide_way_${way}_hint`)} /></p>
    </>)
}

/**
 * The steps for the model picked, numbered in the page's digits, through
 * the office agent, which reads it or, for a ZKTeco terminal, which it
 * sends to (`pushes`, PR 306); above them, where the company may connect
 * it straight to Nizmo, that it can be added that way too. One that sends
 * only plain HTTP can't be: Nizmo takes HTTPS alone (§17.1).
 */
export function SetupGuideSteps({ brand, superAdmin, directAllowed = false, server, pushes = false, shell = 'CMD' }: { brand: GuideBrand; superAdmin: boolean; directAllowed?: boolean; server: string; pushes?: boolean; shell?: CommandShell }) {
    const { t, locale } = useLanguage()
    const steps = setupGuide(brand.protocol, { superAdmin, server, pushes, shell })
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const notes = (brand.notesEn || brand.notesAr) ? <ModelNotes brand={brand} /> : null

    const line = (l: GuideLine) => {
        if (l.notes) return notes && <li key={l.text}><p className="ui-guide-notes">{notes}</p></li>
        return (
            <li key={l.text}>
                <p><Sentence text={t(l.text)} brand={l.brand ? brand.name : undefined} shell={shell} /></p>
                {/* A box that scrolls sideways takes focus, to be scrolled from the keyboard. */}
                {l.code && <CodeBox code={l.code} scrolls={l.wide} />}
            </li>
        )
    }
    // role="list": Safari stops reading a list as one once its markers are gone.
    return (<>
        {/* A model the agent reads that can be added straight to Nizmo too, where that's on (PR 297). */}
        {!pushes && mayConnect(brand.protocol, 'DIRECT', directAllowed) && <p className="ui-card-note">{t('att_guide_direct_too')}</p>}
        <ol className="ui-guide-steps" role="list">
            {steps.map((step, i) => (
                <li key={step.key} className="ui-guide-step">
                    <span className="ui-guide-number" aria-hidden="true">{(i + 1).toLocaleString(intl)}</span>
                    <div className="ui-guide-body">
                        <h3 className="ui-guide-title">{t(step.title)}</h3>
                        <p className="ui-guide-who">{t(step.who)}</p>
                        <ul className="ui-guide-lines">{step.lines.map(line)}</ul>
                    </div>
                </li>
            ))}
        </ol>
    </>)
}

/**
 * What's typed, in a box of its own, left to right and never translated,
 * with Copy beside it, which says what it copies. Without the clipboard, the
 * box is chosen whole instead, ready to copy by hand.
 */
export function CodeBox({ code, scrolls = false }: {
    code: string
    /** Its box scrolls, up and down as a long body does (PR 294), or sideways as a long command does (PR 306): the keyboard reaches it then, to scroll it. */
    scrolls?: boolean
}) {
    const { t } = useLanguage()
    const id = useId()
    const box = useRef<HTMLPreElement>(null)
    const [copied, setCopied] = useState(false)
    useEffect(() => {
        if (!copied) return
        const back = setTimeout(() => setCopied(false), 2000)
        return () => clearTimeout(back)
    }, [copied])
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
        } catch {
            const selection = window.getSelection()
            if (box.current && selection) selection.selectAllChildren(box.current)
        }
    }
    return (
        <div className="ui-guide-code">
            <pre ref={box} id={id} dir="ltr" translate="no" tabIndex={scrolls ? 0 : undefined}><code>{code}</code></pre>
            <Button size="sm" icon={copied ? CheckIcon : CopyIcon} aria-describedby={id} onClick={() => { void copy() }}>
                {copied ? t('att_guide_copied') : t('att_guide_copy')}
            </Button>
            <span className="ui-visually-hidden" role="status">{copied ? t('att_guide_copied') : ''}</span>
        </div>
    )
}
