'use client'

import { useRef, useState } from 'react'
import { UploadSimpleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, ConfirmDialog, Dialog } from '@/components/ui'
import { countOf } from '@/lib/plural'
import { asOfFor, checkTaxFile, readClaimsNow, saveUpload, uploadOf } from '@/lib/tax-check'
import { fileAtFault } from '@/lib/tax-export-page'
import { TAX_FILE_MAX_BYTES, TAX_FILE_MAX_ROWS, type TaxClaimsNow, type TaxFile } from '@/lib/tax-file'
import type { TaxFileRefusal } from '@/lib/tax-file-read'
import TaxExportLink from './TaxExportLink'
import TaxUploadCheck from './TaxUploadCheck'

/** Why a file isn't checked: the file itself, or the client's claims couldn't be read to check it against. */
type Refusal = TaxFileRefusal | { problem: 'unchecked'; code: string | null }
type Stage =
    | { at: 'idle' }
    | { at: 'refused'; refusal: Refusal }
    | { at: 'check'; fileName: string; file: TaxFile; now: TaxClaimsNow; asOf: string }

/**
 * Upload from the tax portal, on a client's Tax position (CLIENT_PORTAL_PLAN.md
 * §4.1; DESIGN.md §5.5, Uploading the tax portal's file): picks the Excel
 * file the export button makes, reads it in the browser, and shows what it
 * would change before anything is saved. Each upload replaces the client's
 * claims, so a row with a problem stops the save, and a file that names
 * another company is asked about first.
 *
 * Nothing of the file leaves the browser but its open claims, when they're
 * saved. The server checks every one of them again.
 *
 * Where it's the file that's at fault, How to get the portal's file opens
 * the export button's page in a new tab (§10, step 4c, PR 320).
 */
export default function TaxUpload({ clientId, onSaved }: { clientId: string; onSaved: () => void }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const input = useRef<HTMLInputElement>(null)
    const [stage, setStage] = useState<Stage>({ at: 'idle' })
    const [reading, setReading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [asking, setAsking] = useState(false)
    // What couldn't be saved, above the buttons.
    const [said, setSaid] = useState<string>()
    // Which reading of a file is the one in hand: closing calls it off, so what's read after isn't shown.
    const reads = useRef(0)

    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const choose = () => input.current?.click()
    const close = () => {
        // What was sent can't be called off. A file still being read can.
        if (saving) return
        reads.current += 1
        setReading(false)
        setStage({ at: 'idle' })
        setAsking(false)
        setSaid(undefined)
    }

    /** What a file comes to: its check screen, or why it's refused whole. */
    const read = async (picked: File): Promise<Stage> => {
        if (picked.size > TAX_FILE_MAX_BYTES) return { at: 'refused', refusal: { problem: 'too_big' } }
        // Read once what it's checked against has loaded (DESIGN.md §5.5, Rows read from a file).
        const basis = await readClaimsNow(clientId)
        if ('refused' in basis) return { at: 'refused', refusal: { problem: 'unchecked', code: basis.refused.code } }
        // The file's reader comes when a file is picked, not with the page.
        const reader = await import('@/lib/tax-file-read').catch(() => null)
        if (!reader) return { at: 'refused', refusal: { problem: 'reader' } }
        const { readTaxFile } = reader
        const file = await readTaxFile(await picked.arrayBuffer())
        if ('problem' in file) return { at: 'refused', refusal: file }
        return { at: 'check', fileName: picked.name, file, now: basis.now, asOf: asOfFor(picked.name, basis.now.today) }
    }
    const pick = async (picked: File | undefined) => {
        if (!picked || reading || saving) return
        const mine = ++reads.current
        setReading(true)
        try {
            const next = await read(picked).catch((): Stage => ({ at: 'refused', refusal: { problem: 'unreadable' } }))
            // Closed while it was read: its check screen doesn't open after all.
            if (reads.current !== mine) return
            setStage(next)
            setAsking(false)
            setSaid(undefined)
        } finally {
            if (reads.current === mine) setReading(false)
        }
    }

    const save = async (confirmed: boolean) => {
        if (stage.at !== 'check' || saving) return
        const check = checkTaxFile(stage.file, stage.now)
        if (check.problems.length > 0 || !stage.asOf) return
        // One client's file isn't saved for another without being asked.
        if (!check.namesClient && !confirmed) {
            setAsking(true)
            return
        }
        // Whether the question is still open once this is done.
        let ask = false
        setSaving(true)
        setSaid(undefined)
        try {
            const result = await saveUpload(uploadOf(stage.now, stage.file, check, { asOf: stage.asOf, fileName: stage.fileName, confirmed }))
            if ('saved' in result) {
                const { claims } = result.saved
                showToast(claims > 0 ? t('tax_upload_saved').replace('{claims}', countOf(t, locale, claims, 'claims')) : t('tax_upload_saved_none'), 'success')
                setStage({ at: 'idle' })
                onSaved()
                return
            }
            const { code, message } = result.refused
            if (code === 'TAX_CLAIMS_CHANGED' || code === 'TAX_FILE_OTHER_COMPANY') {
                // Another file was saved meanwhile: this one is checked again, against the claims as they are now.
                const again = await readClaimsNow(clientId)
                if ('refused' in again) setSaid(t('tax_upload_failed'))
                else {
                    setStage({ ...stage, now: again.now })
                    if (code === 'TAX_CLAIMS_CHANGED') setSaid(t('tax_upload_changed_meanwhile'))
                    // The name the client's last file gave is no longer this file's: asked about, as any other name is.
                    else ask = true
                }
            } else if (code === 'TAX_DAY_AFTER_TODAY') setSaid(t('tax_upload_day_after_today'))
            else if (code === 'CLIENT_ARCHIVED') setSaid(t('tax_upload_archived'))
            else if (code === 'TAX_UPLOAD_INVALID' || code === 'TAX_TOO_MANY_CLAIMS') setSaid(t('tax_upload_invalid'))
            else setSaid(message ?? t('tax_upload_failed'))
        } finally {
            setSaving(false)
            setAsking(ask)
        }
    }

    const refusal = stage.at === 'refused' ? stage.refusal : null
    /** Why a file is refused, with the columns it hasn't or the companies it names. */
    const why = (refused: Refusal): { reason: string; names?: string[]; hint?: string } => {
        switch (refused.problem) {
            case 'too_big': return { reason: t('tax_upload_too_big') }
            case 'unreadable': return { reason: t('tax_upload_unreadable') }
            case 'reader': return { reason: t('tax_upload_reader') }
            case 'empty': return { reason: t('tax_upload_empty') }
            case 'too_many': return { reason: t('tax_upload_too_many').replace('{rows}', countOf(t, locale, refused.rows, 'rows')).replace('{max}', TAX_FILE_MAX_ROWS.toLocaleString(intl)) }
            case 'columns': return { reason: t('tax_upload_columns'), names: refused.missing }
            case 'companies': return { reason: t('tax_upload_companies'), names: refused.names, hint: t('tax_upload_companies_hint') }
            // In the reader's own language, whatever the server's words were.
            case 'unchecked': return { reason: t(refused.code === 'CLIENT_ARCHIVED' ? 'tax_upload_archived' : 'tax_upload_unchecked') }
        }
    }
    const refused = refusal && why(refusal)

    const check = stage.at === 'check' ? checkTaxFile(stage.file, stage.now) : null
    const stopped = !check || check.problems.length > 0
    const saveLabel = stopped
        ? t('save')
        : check.claims.length > 0 ? t('tax_upload_save').replace('{claims}', countOf(t, locale, check.claims.length, 'claims')) : t('tax_upload_save_none')

    // The file's company and the client's are names: each kept apart from the words around it.
    const named = (words: string, names: Record<string, string>) => words.split(/(\{[a-z]+\})/).map((part, i) => {
        const name = /^\{([a-z]+)\}$/.exec(part)?.[1]
        return name && names[name] !== undefined ? <bdi key={i}>{names[name]}</bdi> : part
    })
    const question = stage.at === 'check' && check ? (
        <>
            {named(t(check.company ? 'tax_upload_confirm_named' : 'tax_upload_confirm_unnamed'), { company: check.company ?? '', client: stage.now.client.name })}
            {' '}{t('tax_upload_confirm_replaces')} {t('tax_upload_confirm_kept')}
        </>
    ) : null

    return (
        <>
            <Button icon={UploadSimpleIcon} busy={reading} onClick={choose}>{t('tax_upload')}</Button>
            <input
                ref={input}
                type="file"
                accept=".xlsx"
                className="ui-visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
                onChange={event => {
                    const picked = event.target.files?.[0]
                    // Emptied, so the same file can be picked again once it's fixed.
                    event.target.value = ''
                    void pick(picked)
                }}
            />

            <Dialog open={!!refused} onClose={close} title={t('tax_upload_refused_title')} actions={<>
                {/* The focus is here as it opens, as it was before the link above was there: not on a link that opens a tab. */}
                <Button autoFocus onClick={close}>{t('close')}</Button>
                <Button variant="primary" busy={reading} onClick={choose}>{t('tax_upload_choose_another')}</Button>
            </>}>
                {refused && (
                    <div className="ui-tax-refused">
                        <p>{refused.reason}</p>
                        {refused.names && <ul className="ui-dialog-list">{refused.names.map(name => <li key={name}><bdi>{name}</bdi></li>)}</ul>}
                        {refused.hint && <p className="ui-hint">{refused.hint}</p>}
                        {refusal && fileAtFault(refusal.problem) && <p><TaxExportLink newTab /></p>}
                    </div>
                )}
            </Dialog>

            <Dialog open={stage.at === 'check'} onClose={close} title={t('tax_upload_check_title')} actions={<>
                <Button onClick={close} disabled={saving}>{t('cancel')}</Button>
                <Button variant="primary" busy={saving} disabled={stopped || reading || (stage.at === 'check' && !stage.asOf)} onClick={() => { void save(false) }}>{saveLabel}</Button>
            </>}>
                {stage.at === 'check' && check && (
                    <>
                        <TaxUploadCheck
                            fileName={stage.fileName}
                            rows={stage.file.rows.length + stage.file.leftOut}
                            check={check}
                            asOf={stage.asOf}
                            today={stage.now.today}
                            busy={saving || reading}
                            onAsOf={asOf => setStage({ ...stage, asOf })}
                            onAnother={choose}
                        />
                        {!stopped && <p className="ui-hint ui-tax-replaces">{t('tax_upload_replaces')}</p>}
                        {said !== undefined && <p className="ui-error" role="alert">{said}</p>}
                    </>
                )}
            </Dialog>

            <ConfirmDialog
                open={asking && stage.at === 'check'}
                danger
                title={t('tax_upload_confirm_title')}
                confirmLabel={t('tax_upload_confirm_yes')}
                body={question}
                onConfirm={() => save(true)}
                onCancel={() => setAsking(false)}
            />
        </>
    )
}
