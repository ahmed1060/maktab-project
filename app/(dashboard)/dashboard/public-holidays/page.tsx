'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarBlankIcon, HourglassIcon, PencilSimpleIcon, PlusIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import DatePickerSingle from '@/components/DatePickerSingle'
import { Button, Card, Dialog, DialogActions, EmptyState, Field, Page, PageHeader, PeriodBar, Row, RowMenu, Select, TextInput, type MenuItem } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'
import { useBusyAction } from '@/lib/useBusyAction'
import { countOf } from '@/lib/plural'
import { addressWithYear, yearFromAddress, yearsAround } from '@/lib/period-address'

/**
 * The central calendar of public holidays (ATTENDANCE_PLAN.md §7.2), for the
 * Super Admin. Every company with attendance observes these unless it opts a
 * day out. Moving a day here — Egyptian holidays are sometimes moved by
 * decree — moves it for every company that observes it.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, PR 146): the year it's about
 * is picked under the header and kept in the address (DESIGN.md §5.3), and a
 * holiday is added, edited and removed in the building blocks' dialog.
 */

type Holiday = { id: string; date: string; name: string; nameAr: string | null; companiesSkipping: number }
type Draft = { id: string | null; date: string; name: string; nameAr: string }
type Errors = { date?: string; name?: string }

const NAME_MAX = 120

export default function PublicHolidaysPage() {
    const { t, locale } = useLanguage()
    const isRtl = locale === 'ar'
    const { showToast } = useToast()
    const { data: session, status } = useSession()

    // The year the page is about, kept in its address (DESIGN.md §5.3), so a
    // reload or a link opens on it; picking one replaces the address.
    const now = new Date()
    const params = useSearchParams()
    const pathname = usePathname()
    const router = useRouter()
    const year = yearFromAddress(params, now)
    const setYear = (y: number) => router.replace(addressWithYear(pathname, params.toString(), y), { scroll: false })

    // null: closed; an id of null: adding; a holiday's id: editing it.
    const [draft, setDraft] = useState<Draft | null>(null)
    const [errors, setErrors] = useState<Errors>({})
    const [removing, setRemoving] = useState<Holiday | null>(null)
    const action = useBusyAction()

    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'
    const { data: body, error, isValidating, mutate: load } = useSWR(isSuperAdmin ? `/api/public-holidays?year=${year}` : null, fetcher)
    const holidays: Holiday[] | null = body && !error ? body.data?.holidays ?? [] : null

    if (status === 'loading') return null
    if (!isSuperAdmin) return <AccessDenied superAdmins />

    const digits = isRtl ? 'ar-EG' : 'en-GB'
    const years = yearsAround(now.getFullYear(), year).map(y => ({ value: String(y), label: y.toLocaleString(digits, { useGrouping: false }) }))
    const yearLabel = year.toLocaleString(digits, { useGrouping: false })
    const dateText = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(digits, { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' })
    const nameOf = (h: Holiday) => (isRtl && h.nameAr ? h.nameAr : h.name)
    const listTitle = t('public_holidays_in_year').replace('{year}', yearLabel)

    const openAdd = () => { setErrors({}); setDraft({ id: null, date: '', name: '', nameAr: '' }) }
    const openEdit = (h: Holiday) => { setErrors({}); setDraft({ id: h.id, date: h.date, name: h.name, nameAr: h.nameAr ?? '' }) }
    // Not while it works: closing then would hide the answer.
    const closeDraft = () => { if (!action.running) setDraft(null) }
    const closeRemoving = () => { if (!action.running) setRemoving(null) }

    const save = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (!draft) return
        const form = e.currentTarget
        const found: Errors = {
            date: !draft.date ? t('public_holidays_date_required') : undefined,
            name: !draft.name.trim() ? t('public_holidays_name_required') : undefined,
        }
        setErrors(found)
        if (found.date || found.name) {
            // To the first field that needs fixing, once it's marked: the day's picker is a button.
            requestAnimationFrame(() => form.querySelector<HTMLElement>(found.date ? '.ui-date-trigger' : '[aria-invalid="true"]')?.focus())
            return
        }
        void action.run('save', async () => {
            try {
                const res = await fetch(draft.id ? `/api/public-holidays/${draft.id}` : '/api/public-holidays', {
                    method: draft.id ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ date: draft.date, name: draft.name.trim(), nameAr: draft.nameAr.trim() || null }),
                })
                // Refused, it stays open with what was typed, to try again.
                if (!res.ok) {
                    showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
                    return
                }
                showToast(t('public_holidays_saved'), 'success')
                setDraft(null)
                // Saved into another year: the page goes there, to show it.
                const savedYear = Number(draft.date.slice(0, 4))
                if (savedYear !== year) setYear(savedYear)
                else await load()
            } catch {
                showToast(t('error_generic'), 'error')
            }
        })
    }

    const remove = (target: Holiday) => action.run('remove', async () => {
        try {
            const res = await fetch(`/api/public-holidays/${target.id}`, { method: 'DELETE' })
            if (!res.ok) {
                showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
                return
            }
            showToast(t('public_holidays_removed'), 'success')
            setRemoving(null)
            await load()
        } catch {
            showToast(t('error_generic'), 'error')
        }
    })

    const menu = (h: Holiday): MenuItem[] => [
        { key: 'edit', label: t('edit'), icon: PencilSimpleIcon, onSelect: () => openEdit(h) },
        { key: 'delete', label: t('delete'), icon: TrashIcon, danger: true, onSelect: () => setRemoving(h) },
    ]
    return (
        <Page>
            <PageHeader title={t('public_holidays_title')} subtitle={t('public_holidays_hint')} action={<Button variant="primary" icon={PlusIcon} onClick={openAdd}>{t('public_holidays_add')}</Button>} />

            <PeriodBar>
                <Field label={t('year')}>{p => (
                    <Select {...p} value={String(year)} onChange={e => setYear(Number(e.target.value))} options={years} />
                )}</Field>
            </PeriodBar>

            {error ? (
                <div className="ui-panel">
                    <EmptyState
                        icon={WarningCircleIcon}
                        title={t('public_holidays_load_failed')}
                        detail={(error as SWRError).info?.error}
                        action={<Button busy={isValidating} onClick={() => { void load() }}>{t('try_again')}</Button>}
                    />
                </div>
            ) : !holidays ? (
                <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
            ) : (
                <Card title={listTitle}>
                    {holidays.length === 0 ? (
                        // Add is the header's, right above: offered once, as on the Tasks list.
                        <EmptyState icon={CalendarBlankIcon} title={t('attendance_no_holidays')} />
                    ) : (
                        <ul className="ui-rows" aria-label={listTitle}>
                            {holidays.map(h => (
                                <Row
                                    key={h.id}
                                    title={<bdi>{nameOf(h)}</bdi>}
                                    detail={[
                                        dateText(h.date),
                                        h.companiesSkipping > 0 ? t('public_holidays_skipping').replace('{count}', countOf(t, locale, h.companiesSkipping, 'companies')) : null,
                                    ].filter(Boolean).join(' · ')}
                                    end={<RowMenu label={t('ui_more_actions_for').replace('{name}', nameOf(h))} tooltip={t('ui_more_actions')} items={menu(h)} />}
                                />
                            ))}
                        </ul>
                    )}
                </Card>
            )}

            {/* Adding and editing: the day, and its name in each language. */}
            <Dialog open={draft !== null} onClose={closeDraft} title={draft?.id ? t('public_holidays_edit') : t('public_holidays_add')}>
                {draft && (
                    <form className="ui-form" noValidate onSubmit={save}>
                        {/* Moving a holiday says what it moves. */}
                        <DatePickerSingle asField label={t('date')} value={draft.date} error={errors.date} disabled={action.running}
                            hint={draft.id ? t('public_holidays_move_hint') : undefined}
                            onChange={day => { setDraft({ ...draft, date: day }); setErrors(x => ({ ...x, date: undefined })) }} />
                        <Field label={t('public_holidays_name_en')} error={errors.name}>{p => (
                            <TextInput {...p} name="name" dir="ltr" autoComplete="off" maxLength={NAME_MAX} value={draft.name} disabled={action.running}
                                onChange={e => { setDraft({ ...draft, name: e.target.value }); setErrors(x => ({ ...x, name: undefined })) }} />
                        )}</Field>
                        <Field label={t('public_holidays_name_ar')}>{p => (
                            <TextInput {...p} name="nameAr" dir="rtl" lang="ar" autoComplete="off" maxLength={NAME_MAX} value={draft.nameAr} disabled={action.running}
                                onChange={e => setDraft({ ...draft, nameAr: e.target.value })} />
                        )}</Field>
                        <DialogActions>
                            <Button onClick={closeDraft} disabled={action.running}>{t('cancel')}</Button>
                            <Button type="submit" variant="primary" disabled={action.running} busy={action.is('save')}>{t('save')}</Button>
                        </DialogActions>
                    </form>
                )}
            </Dialog>

            {/* Removing can't be undone: it asks first, and stays open while it works. */}
            <Dialog
                open={removing !== null}
                onClose={closeRemoving}
                title={t('public_holidays_delete_title')}
                actions={<>
                    <Button onClick={closeRemoving} disabled={action.running}>{t('cancel')}</Button>
                    <Button variant="danger" onClick={() => { if (removing) void remove(removing) }} disabled={action.running} busy={action.is('remove')}>
                        {t('delete')}
                    </Button>
                </>}
            >
                <p>{t('public_holidays_delete_confirm').replace('{name}', removing ? nameOf(removing) : '')}</p>
            </Dialog>
        </Page>
    )
}
