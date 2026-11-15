'use client'

import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { inlineCode, setupGuide, type GuideLine, type TerminalProtocol } from '@/lib/attendance/setup-guide'
import { mayConnect } from '@/lib/attendance/terminal-connections'
import { Button, Dialog, Field, Select } from '@/components/ui'

/**
 * How to set up a fingerprint terminal (ATTENDANCE_PLAN.md §17.7, PR 282),
 * opened by the round "i" beside Fingerprint terminals' title (DESIGN.md
 * §5.2). A guide (§5.5, Dialog): up to 640px wide, changing nothing, Close
 * its only button. The model is picked at the top, from the Super Admin's
 * brands not retired, and the steps follow its protocol, with the model's
 * notes where its address is found.
 *
 * A model Nizmo doesn't read through the agent has no steps here. Where the
 * company may connect it straight to Nizmo (§17.8), the guide points to Add
 * a terminal, which shows what to set on it (PR 292).
 */

/** A brand the terminals list offers, with the Super Admin's notes on it. */
export type GuideBrand = { id: string; name: string; protocol: TerminalProtocol; notesEn: string | null; notesAr: string | null }

export default function TerminalSetupGuide({ brands, loadFailed = false, superAdmin, directAllowed = false, server, onClose }: {
    /** null until the terminals list, which offers them, has loaded. */
    brands: GuideBrand[] | null
    loadFailed?: boolean
    superAdmin: boolean
    /** Whether the company may connect terminals straight to Nizmo (§17.8). */
    directAllowed?: boolean
    /** This Nizmo's address, which the agent sends to. */
    server: string
    onClose: () => void
}) {
    const { t } = useLanguage()
    const [brandId, setBrandId] = useState('')
    const brand = brands?.find(b => b.id === brandId) ?? null
    // Opened before the list has loaded, the picker waits for it (found in the browser, PR 282).
    const options = brands === null
        ? [{ value: '', label: t('loading') }]
        : [{ value: '', label: t('att_guide_model_pick') }, ...brands.map(b => ({ value: b.id, label: b.name }))]
    return (
        <Dialog open onClose={onClose} title={t('att_guide_button')} actions={<Button variant="primary" onClick={onClose}>{t('close')}</Button>}>
            <div className="ui-guide">
                {brands === null && loadFailed ? <p className="ui-card-note" role="status">{t('att_term_load_failed')}</p>
                : brands?.length === 0 ? <p className="ui-card-note">{t('att_guide_no_models')}</p> : <>
                    <Field label={t('att_guide_model')}>{p => (
                        <Select {...p} name="model" value={brandId} disabled={brands === null} onChange={e => setBrandId(e.target.value)} options={options} />
                    )}</Field>
                    {brand ? <SetupGuideSteps brand={brand} superAdmin={superAdmin} directAllowed={directAllowed} server={server} /> : <p className="ui-card-note">{t('att_guide_pick_first')}</p>}
                </>}
            </div>
        </Dialog>
    )
}

/** A name kept as it's printed, never machine-translated, where a sentence has its slot. */
function named(text: string, slot: string, name: string): ReactNode {
    const at = text.indexOf(slot)
    if (at < 0) return text
    return <>{text.slice(0, at)}<bdi translate="no">{name}</bdi>{text.slice(at + slot.length)}</>
}

/** A sentence, what's typed in it left to right and untranslated, and the model's name in its slot. */
export function Sentence({ text, brand }: { text: string; brand?: string }) {
    return <>{inlineCode(text).map((part, i) => 'code' in part
        ? <code key={i} className="ui-guide-inline" dir="ltr" translate="no">{part.code}</code>
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

/**
 * The steps for the model picked, numbered in the page's digits; or, for one
 * with none, that Nizmo can't read it yet, or where it is added when the
 * company may connect it straight to Nizmo.
 */
export function SetupGuideSteps({ brand, superAdmin, directAllowed = false, server }: { brand: GuideBrand; superAdmin: boolean; directAllowed?: boolean; server: string }) {
    const { t, locale } = useLanguage()
    const steps = setupGuide(brand.protocol, { superAdmin, server })
    if (!steps) return <p className="ui-card-note">{t(mayConnect(brand.protocol, 'DIRECT', directAllowed) ? 'att_guide_direct' : 'att_guide_not_read')}</p>
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const notes = (brand.notesEn || brand.notesAr) ? <ModelNotes brand={brand} /> : null

    const line = (l: GuideLine) => {
        if (l.notes) return notes && <li key={l.text}><p className="ui-guide-notes">{notes}</p></li>
        return (
            <li key={l.text}>
                <p><Sentence text={t(l.text)} brand={l.brand ? brand.name : undefined} /></p>
                {l.code && <CodeBox code={l.code} />}
            </li>
        )
    }
    // role="list": Safari stops reading a list as one once its markers are gone.
    return (
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
    )
}

/**
 * What's typed, in a box of its own, left to right and never translated,
 * with Copy beside it, which says what it copies. Without the clipboard, the
 * box is chosen whole instead, ready to copy by hand.
 */
export function CodeBox({ code }: { code: string }) {
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
            <pre ref={box} id={id} dir="ltr" translate="no"><code>{code}</code></pre>
            <Button size="sm" icon={copied ? CheckIcon : CopyIcon} aria-describedby={id} onClick={() => { void copy() }}>
                {copied ? t('att_guide_copied') : t('att_guide_copy')}
            </Button>
            <span className="ui-visually-hidden" role="status">{copied ? t('att_guide_copied') : ''}</span>
        </div>
    )
}
