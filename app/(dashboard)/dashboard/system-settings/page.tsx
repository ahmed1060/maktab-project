'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import BrandColourCard from '@/components/BrandColourCard'
import FaceSystemSwitch from '@/components/FaceSystemSwitch'
import { CalendarCard, LocationCard, SignatureCard, StepUpCard, type StoredSettings } from '@/components/SystemSettingsCards'
import { Button, Columns, Dialog, EmptyState, Page, PageHeader, Section } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { DEFAULT_BRAND } from '@/lib/brand-colour'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useViewer } from '@/lib/useCan'
import { UnsavedChangesProvider, useGuardLinks, useUnsavedState } from '@/lib/useUnsavedChanges'

/**
 * System settings (UI_PLAN.md §5 step 5, Operations part 4a): the
 * platform's defaults, in three sections. Defaults: how far from a task's
 * place a location is approved by itself, and the calendar of anybody with
 * no company. Security: how long a high-risk action's code lasts, and face
 * checks. Branding: the "Powered by" signature and the default brand colour.
 *
 * It was one grid of forms of its own making, with its title set in the old
 * top bar, sizes and colours typed in, and, when the settings didn't load,
 * a toast over forms left empty. The face checks switch follows in part 4b.
 */
export default function SystemSettingsPage() {
    const { t } = useLanguage()
    const router = useRouter()
    // Who is looking comes from the layout on the first paint, so a Super
    // Admin never sees "Access restricted" while the session loads. It asked
    // for the settings for whoever opened its address.
    const viewer = useViewer()
    const isSuperAdmin = viewer?.role === 'SUPER_ADMIN'
    const { data, error, isValidating, mutate } = useSWR(isSuperAdmin ? '/api/system-settings' : null, fetcher)
    const stored: StoredSettings | null = data?.success ? data.data : null

    // Edits not yet saved in any card are asked about before leaving the
    // page, as company settings' are.
    const { dirty, setDirty } = useUnsavedState()
    const [leaving, setLeaving] = useState<{ href: string } | { go: () => void } | null>(null)
    useGuardLinks(dirty, href => setLeaving({ href }))

    if (!isSuperAdmin) return <AccessDenied />

    // The server's copy, as each card saves: every card's saved value is it.
    const saved = (next: StoredSettings) => { void mutate({ success: true, data: next }, { revalidate: false }) }
    const leave = () => {
        const next = leaving
        setLeaving(null)
        if (!next) return
        if ('go' in next) return next.go()
        setDirty(false)
        router.push(next.href)
    }

    return (
        <Page>
            <PageHeader title={t('system_settings')} subtitle={t('system_settings_subtitle')} />

            {!stored ? (
                error ? (
                    <div className="ui-panel">
                        <EmptyState icon={WarningCircleIcon} title={t('sys_load_failed')} detail={(error as SWRError).info?.error}
                            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    </div>
                ) : (
                    <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                )
            ) : (
                <UnsavedChangesProvider onChange={setDirty} onLeave={go => setLeaving({ go })}>
                    <Section title={t('sys_section_defaults')}>
                        <Columns>
                            <LocationCard stored={stored} onSaved={saved} />
                            <CalendarCard stored={stored} onSaved={saved} />
                        </Columns>
                    </Section>

                    <Section title={t('sys_section_security')}>
                        <Columns>
                            <StepUpCard stored={stored} onSaved={saved} />
                            <FaceSystemSwitch />
                        </Columns>
                    </Section>

                    <Section title={t('branding_settings')}>
                        <Columns>
                            <SignatureCard stored={stored} onSaved={saved} />
                            {/* The default brand colour (UI_PLAN.md §4.6), beside the "Powered by" signature. */}
                            <BrandColourCard
                                saved={stored.brandColour ?? DEFAULT_BRAND}
                                hint={t('brand_colour_system_hint')}
                                onSave={async brandColour => {
                                    if (!brandColour) return false
                                    const res = await fetch('/api/system-settings', {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ brandColour }),
                                    }).catch(() => null)
                                    if (!res?.ok) return false
                                    const result = await res.json().catch(() => null)
                                    if (result?.data) saved(result.data)
                                    return true
                                }}
                            />
                        </Columns>
                    </Section>
                </UnsavedChangesProvider>
            )}

            <Dialog
                open={!!leaving}
                onClose={() => setLeaving(null)}
                title={t('settings_unsaved_title')}
                actions={<>
                    <Button onClick={() => setLeaving(null)}>{t('cancel')}</Button>
                    <Button variant="danger" onClick={leave}>{t('settings_unsaved_discard')}</Button>
                </>}
            >
                <p>{t('sys_unsaved_message')}</p>
            </Dialog>
        </Page>
    )
}
