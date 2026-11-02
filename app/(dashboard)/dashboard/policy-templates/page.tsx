'use client'

import { Fragment, useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { CalendarCheckIcon, CopyIcon, HourglassIcon, PencilSimpleIcon, PlusIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import DeleteTemplateDialog from '@/components/DeleteTemplateDialog'
import PolicyDialog from '@/components/attendance-policy/PolicyDialog'
import TemplateFields from '@/components/attendance-policy/TemplateFields'
import { Button, Card, EmptyState, Page, PageHeader, Row, RowMenu, type MenuItem } from '@/components/ui'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { apiErrorText } from '@/lib/api-error-text'
import { countOf } from '@/lib/plural'
import { STANDARD_OFFICE, type PolicyBody } from '@/lib/attendance/policy'

/**
 * Attendance policy templates (ATTENDANCE_PLAN.md §6.8): the Super Admin's
 * starting points — "Standard Egyptian office", "Six-day factory" — that a
 * company copies into its own policy. Applying one copies it, so editing or
 * removing a template here changes no company's policy.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, the Super Admin's pages part
 * 1): the page header with New template, the templates as rows with the
 * policy in words and what each is for, and a menu on each; deleting one
 * asks first. The template's dialog moved in company settings part 3b.
 */

type Template = { id: string; name: string; nameAr: string | null; description: string | null; body: PolicyBody }
type Editing = { id: string | null; name: string; nameAr: string; description: string; body: PolicyBody }

export default function PolicyTemplatesPage() {
    const { t, locale } = useLanguage()
    const isRtl = locale === 'ar'
    const intl = isRtl ? 'ar-EG' : 'en-GB'
    const { showToast } = useToast()
    const { data: session, status } = useSession()
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

    const { data, error, isValidating, mutate } = useSWR(isSuperAdmin ? '/api/policy-templates' : null, fetcher)
    const templates: Template[] | null = data ? data.data?.templates ?? [] : null
    const [editing, setEditing] = useState<Editing | null>(null)
    const [deleting, setDeleting] = useState<Template | null>(null)
    const [removing, setRemoving] = useState(false)
    // A template needs a name, said under its field (company settings part 3b).
    const [nameError, setNameError] = useState<string | undefined>()

    if (status === 'loading') return null
    if (!isSuperAdmin) return <AccessDenied />

    // Numbers and days in the page's language (DESIGN.md §3.3).
    const number = (n: number) => n.toLocaleString(intl, { maximumFractionDigits: 2 })
    const weekday = (d: number) => new Date(Date.UTC(2026, 2, 1 + d)).toLocaleDateString(intl, { weekday: 'short', timeZone: 'UTC' })
    const nameOf = (tpl: Template) => (isRtl && tpl.nameAr ? tpl.nameAr : tpl.name)
    /** Its name in the other language, where it has one, marked as that language. */
    const otherName = (tpl: Template) => isRtl
        ? (tpl.nameAr ? <bdi lang="en">{tpl.name}</bdi> : null)
        : (tpl.nameAr ? <bdi lang="ar">{tpl.nameAr}</bdi> : null)

    /** The policy in words, a fact each, kept apart so Arabic doesn't swap them (part 3c). */
    const summary = (tpl: Template) => {
        const b = tpl.body
        const items: ReactNode[] = [
            otherName(tpl),
            <bdi key="week">{b.workWeek.map(weekday).join(' ')}</bdi>,
            <bdi key="late">{b.lateness.enabled ? t('ptpl_lateness_line').replace('{n}', number(b.lateness.graceMinutes)) : t('ptpl_lateness_off')}</bdi>,
            <bdi key="absent">{b.absence.multiplier === 0
                ? t('attendance_absence_none_line')
                : t('attendance_absence_line').replace('{days}', countOf(t, locale, b.absence.multiplier, 'days'))}</bdi>,
            b.permissionHours.enabled
                ? <bdi key="permission">{t('ptpl_permission_line').replace('{hours}', countOf(t, locale, b.permissionHours.monthlyAllowanceMinutes / 60, 'hours'))}</bdi>
                : null,
        ].filter(Boolean)
        return <span>{items.map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}{x}</Fragment>)}</span>
    }

    const save = async (body: PolicyBody) => {
        if (!editing) return
        try {
            const res = await fetch(editing.id ? `/api/policy-templates/${editing.id}` : '/api/policy-templates', {
                method: editing.id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editing.name, nameAr: editing.nameAr || null, description: editing.description || null, body }),
            })
            if (!res.ok) return showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
        } catch {
            return showToast(t('error_generic'), 'error')
        }
        showToast(t('ptpl_saved'), 'success')
        setEditing(null)
        await mutate()
    }

    /** Deletes a template; the dialog stays open, its button busy, until it's done. */
    const remove = async (target: Template) => {
        setRemoving(true)
        try {
            const res = await fetch(`/api/policy-templates/${target.id}`, { method: 'DELETE' })
            if (!res.ok) return showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
            showToast(t('ptpl_deleted'), 'success')
            setDeleting(null)
            await mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setRemoving(false)
        }
    }

    const startNew = (from?: Template) => {
        setNameError(undefined)
        setEditing({
            id: null,
            name: from ? `${from.name} (copy)` : '',
            nameAr: from?.nameAr ? `${from.nameAr} (نسخة)` : '',
            description: from?.description ?? '',
            body: structuredClone(from?.body ?? STANDARD_OFFICE),
        })
    }
    const startEdit = (tpl: Template) => {
        setNameError(undefined)
        setEditing({ id: tpl.id, name: tpl.name, nameAr: tpl.nameAr ?? '', description: tpl.description ?? '', body: structuredClone(tpl.body) })
    }

    const menu = (tpl: Template): MenuItem[] => [
        { key: 'edit', label: t('edit'), icon: PencilSimpleIcon, onSelect: () => startEdit(tpl) },
        { key: 'copy', label: t('ptpl_copy'), icon: CopyIcon, onSelect: () => startNew(tpl) },
        { key: 'delete', label: t('delete'), icon: TrashIcon, danger: true, onSelect: () => setDeleting(tpl) },
    ]

    return (
        <Page>
            <PageHeader
                title={t('ptpl_title')}
                subtitle={t('ptpl_hint')}
                action={<Button variant="primary" icon={PlusIcon} onClick={() => startNew()}>{t('ptpl_new')}</Button>}
            />

            {!templates ? (
                error ? (
                    <div className="ui-panel">
                        <EmptyState icon={WarningCircleIcon} title={t('ptpl_load_failed')} detail={(error as SWRError).info?.error}
                            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    </div>
                ) : (
                    <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                )
            ) : templates.length === 0 ? (
                // New template is the header's, right above: offered once.
                <div className="ui-panel"><EmptyState icon={CalendarCheckIcon} title={t('ptpl_none')} /></div>
            ) : (
                <Card>
                    <ul className="ui-rows ui-rows-flush" aria-label={t('ptpl_title')}>
                        {templates.map(tpl => (
                            <Row
                                key={tpl.id}
                                title={<bdi>{nameOf(tpl)}</bdi>}
                                detail={summary(tpl)}
                                note={tpl.description}
                                end={<RowMenu label={t('ui_more_actions_for').replace('{name}', nameOf(tpl))} tooltip={t('ui_more_actions')} items={menu(tpl)} />}
                            />
                        ))}
                    </ul>
                </Card>
            )}

            {editing && (
                <PolicyDialog
                    start={editing.body}
                    weekdayName={weekday}
                    title={editing.id ? t('ptpl_edit') : t('ptpl_new')}
                    header={<TemplateFields value={editing} error={nameError} onChange={v => { setEditing({ ...editing, ...v }); setNameError(undefined) }} />}
                    checkHeader={() => {
                        const named = editing.name.trim().length > 0
                        setNameError(named ? undefined : t('attendance_template_name_required'))
                        return named
                    }}
                    onClose={() => { setEditing(null); setNameError(undefined) }}
                    onSave={async (_from, body) => { await save(body) }}
                />
            )}

            {deleting && (
                <DeleteTemplateDialog name={nameOf(deleting)} body={t('ptpl_delete_body')} busy={removing}
                    onCancel={() => setDeleting(null)} onConfirm={() => { void remove(deleting) }} />
            )}
        </Page>
    )
}
