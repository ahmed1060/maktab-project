'use client'
import { useId, useState } from 'react'
import useSWR from 'swr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import { DownloadSimpleIcon } from '@phosphor-icons/react/ssr'
import { Button, ButtonLink, Dialog, FileChip, FileChips, FilePicker } from '@/components/ui'
import { fetcher } from '@/lib/swr-fetcher'
import { useHydrated } from '@/lib/useHydrated'
import { dateTimeText } from '@/lib/calendar-text'
import { companyTemplateUrl, isWorkbook, rawTemplateUrl, uploadTemplate, type TemplateLocale } from '@/lib/bulk-templates'

type Status = { exists: boolean; updatedAt: string | null }

interface ManageTemplatesModalProps {
    isOpen: boolean
    onClose: () => void
}

/**
 * The templates for the bulk upload of tasks, which the Super Admin keeps
 * (DESIGN.md §5.5, "A file that replaces one"): the English and the Arabic,
 * each a section of its own, and the company's own template to download.
 * It was a window of its own making, with a national flag beside each, a
 * folder emoji on its picker, its words in English, and Cancel, its primary
 * button, to close it (PR 211).
 */
export default function ManageTemplatesModal({ isOpen, onClose }: ManageTemplatesModalProps) {
    const { t, locale } = useLanguage()
    const { selectedCompanyId } = useCompany()

    // The ones there now are the same whichever company is picked, so they're
    // shown in the All companies view alone, apart from the company's own
    // template, which is made from them and downloaded below.
    const allCompanies = isOpen && !selectedCompanyId
    const { data, mutate } = useSWR<{ data?: Partial<Record<TemplateLocale, Status>> }>(allCompanies ? '/api/templates/status' : null, fetcher)
    const status = data?.data ?? {}
    // The one uploaded is the one there now at once, then as the store says:
    // the browser flows found it left as it was, the status not always asked
    // for again after an upload.
    const uploaded = (locale: TemplateLocale) =>
        void mutate(current => ({ data: { ...current?.data, [locale]: { exists: true, updatedAt: new Date().toISOString() } } }), { revalidate: true })

    return (
        <Dialog
            open={isOpen}
            onClose={onClose}
            title={t('manage_templates')}
            actions={(
                <>
                    {selectedCompanyId && (
                        <ButtonLink href={companyTemplateUrl(locale, selectedCompanyId)} target="_blank" prefetch={false} icon={DownloadSimpleIcon}>
                            {t('download_current_template')}
                        </ButtonLink>
                    )}
                    <Button onClick={onClose}>{t('close')}</Button>
                </>
            )}
        >
            <TemplateSection locale="en" status={allCompanies ? status.en ?? null : undefined} onUploaded={() => uploaded('en')} />
            <TemplateSection locale="ar" status={allCompanies ? status.ar ?? null : undefined} onUploaded={() => uploaded('ar')} />
            {!allCompanies && <p className="ui-hint">{t('template_view_all_companies_only')}</p>}
        </Dialog>
    )
}

/**
 * One language's template: the one there now, where it's known, then the
 * picker for one workbook, and once one is picked, its chip and Upload.
 * Nothing is replaced until Upload is pressed.
 */
function TemplateSection({ locale, status, onUploaded }: {
    locale: TemplateLocale
    /** The one there now; null while it isn't known yet, undefined where it isn't shown. */
    status: Status | null | undefined
    onUploaded: () => void
}) {
    const { t, locale: pageLocale } = useLanguage()
    const { showToast } = useToast()
    const hydrated = useHydrated()
    const headingId = useId()
    const [file, setFile] = useState<File | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [sending, setSending] = useState(false)

    const pick = (files: File[]) => {
        const picked = files[0]
        setError(null)
        if (!picked) return
        if (!isWorkbook(picked.name)) return setError(t('template_not_xlsx'))
        setFile(picked)
    }

    const upload = async () => {
        if (!file || sending) return
        setSending(true)
        setError(null)
        const taken = await uploadTemplate(file, locale)
        setSending(false)
        if (!taken) return setError(t('template_upload_failed'))
        setFile(null)
        showToast(t(locale === 'en' ? 'template_en_updated' : 'template_ar_updated'), 'success')
        onUploaded()
    }

    // Said once in the browser, as the date fields' days are: the server's
    // Intl can write it otherwise.
    const updated = status?.exists && status.updatedAt && hydrated ? dateTimeText(status.updatedAt, pageLocale) : null

    return (
        <section aria-labelledby={headingId} className="ui-template">
            <h3 id={headingId} className="ui-template-title">{t(locale === 'en' ? 'template_en_title' : 'template_ar_title')}</h3>
            {status?.exists && (
                <FileChips label={t(locale === 'en' ? 'template_en_title' : 'template_ar_title')}>
                    <FileChip name={`template_${locale}.xlsx`} href={rawTemplateUrl(locale)} />
                </FileChips>
            )}
            {status && (
                <p className="ui-hint">{status.exists ? updated && t('template_last_updated').replace('{date}', updated) : t('template_not_uploaded_yet')}</p>
            )}
            <FilePicker label={t('template_choose')} hint={t('template_hint')} accept=".xlsx" multiple={false} onFiles={pick} disabled={sending} />
            {file && (
                <div className="ui-template-picked">
                    <FileChips label={t('template_choose')}>
                        <FileChip name={file.name} size={file.size} onRemove={sending ? undefined : () => setFile(null)} />
                    </FileChips>
                    <Button variant="primary" size="sm" busy={sending} onClick={upload}>{t('template_upload')}</Button>
                </div>
            )}
            {sending && <p className="ui-hint" role="status">{t('template_uploading')}</p>}
            {error && <p className="ui-error" role="alert">{error}</p>}
        </section>
    )
}
