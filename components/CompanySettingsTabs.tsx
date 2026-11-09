'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import CompanyGeneralCard from '@/components/CompanyGeneralCard'
import CompanyLogoCard from '@/components/CompanyLogoCard'
import BrandColourCard from '@/components/BrandColourCard'
import CompanyPayrollCard from '@/components/CompanyPayrollCard'
import CompanyAttendanceCard from '@/components/CompanyAttendanceCard'
import CompanyRolesCard from '@/components/CompanyRolesCard'
import CompanyModulesCard from '@/components/CompanyModulesCard'
import CompanySettingsAccessCard from '@/components/CompanySettingsAccessCard'
import CashAdvancesCard from '@/components/cash-advances/CashAdvancesCard'
import CostNamesCard from '@/components/lists/CostNamesCard'
import { Button, Dialog, Tabs } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { COMPANY_SETTINGS_TABS, type CompanySettingsTabKey } from '@/lib/company-settings-tabs'
import { UnsavedChangesProvider, useGuardLinks, useUnsavedState } from '@/lib/useUnsavedChanges'
import type { ModuleOverrides } from '@/lib/modules'
import type { TranslationKey } from '@/lib/translations'

/**
 * A company's settings, one tab per category (ATTENDANCE_PLAN.md §5.1). The
 * tabs come from lib/company-settings-tabs.ts; the open one is in the URL
 * (?tab=payroll), so a link or a reload lands on it. Leaving a tab, or the
 * page by a link or a reload, with unsaved edits asks first.
 *
 * One set of tabs, two entry points (§5.2): the Super Admin's, from the
 * company list, with every tab; and a company's own, at /dashboard/settings,
 * with the tabs the Super Admin shows it. The server decides both.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 1):
 * the building blocks' tabs, the cards in one column at a width that reads,
 * and leaving with unsaved edits asked in a dialog.
 */

export type CompanySettings = {
    id: string
    name: string
    autoVerifyLocation: boolean
    /** Cash advances' switches, and what's held (CLIENTS_PLAN.md §7.6). */
    cashAdvancesAllowed?: boolean
    cashAdvancesOn?: boolean
    cashAdvancesHeld?: number
    /**
     * Cost names only from the saved list (CLIENTS_PLAN.md §6.9): offered to
     * a company with the Costs module, with how many names its list holds.
     */
    costNamesFromListOnly?: boolean
    costNamesOffered?: boolean
    costNamesSaved?: number
    moduleLabels: unknown
    moduleIcons: unknown
    logoUrl: string | null
    /** The company's own brand colour, null for the default (UI_PLAN.md §4.6). */
    brandColour?: string | null
    /** The system's default, which "Use the default" goes back to. */
    defaultBrandColour?: string
    payrollDay: number
    payslipsVisible: boolean
    timezone: string
    debtRecoveryPercent: number
    adminSettingsEnabled?: boolean
    adminSettingsTabs?: string[]
}

export default function CompanySettingsTabs({ company, onSaved, tabs: shown, readOnly = false, superAdmin }: {
    company: CompanySettings
    /** What a tab saved, merged into the page's copy without asking the server again. */
    onSaved: (next: Partial<CompanySettings>) => void
    /** The tabs this viewer sees, as the server says. */
    tabs: readonly CompanySettingsTabKey[]
    /** Holds settings.view without settings.edit. */
    readOnly?: boolean
    superAdmin: boolean
}) {
    const { t } = useLanguage()
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const { dirty, setDirty } = useUnsavedState()
    // Where unsaved edits were about to be left for: another tab, a page, or
    // a card's own way out (the Roles tab's Preview).
    const [leavingFor, setLeavingFor] = useState<{ tab: CompanySettingsTabKey } | { href: string } | { go: () => void } | null>(null)
    useGuardLinks(dirty, href => setLeavingFor({ href }))

    const tabs = COMPANY_SETTINGS_TABS.filter(x => shown.includes(x.key))
    // A row of tabs holding one says nothing a heading doesn't: a company
    // that shows its people General alone just has its cards (company
    // settings part 1).
    const tabbed = tabs.length > 1
    const asked = searchParams.get('tab')
    const tab: CompanySettingsTabKey | undefined = tabs.find(x => x.key === asked)?.key ?? tabs[0]?.key

    const open = (next: CompanySettingsTabKey) => {
        const query = new URLSearchParams(searchParams.toString())
        query.set('tab', next)
        router.replace(`${pathname}?${query.toString()}`, { scroll: false })
    }
    const choose = (next: CompanySettingsTabKey) => {
        if (next === tab) return
        if (dirty) setLeavingFor({ tab: next })
        else open(next)
    }

    const companyId = company.id
    const leave = () => {
        const next = leavingFor
        setLeavingFor(null)
        if (!next) return
        // A card's own way out keeps the edits guarded until it
        // has gone: it may wait on the server, or fail and stay,
        // with the edits still on screen (review on #49).
        if ('go' in next) return next.go()
        setDirty(false)
        if ('tab' in next) open(next.tab)
        else router.push(next.href)
    }
    return (
        <>
            {tab && tabbed && <Tabs
                label={t('company_settings_title')}
                idPrefix="settings-tab"
                value={tab}
                onChange={choose}
                items={tabs.map(x => ({ value: x.key, label: t(x.labelKey as TranslationKey), controls: 'settings-panel' }))}
            />}

            <div role={tabbed ? 'tabpanel' : undefined} id="settings-panel" className="ui-tab-panel ui-settings" aria-labelledby={tab && tabbed ? `settings-tab-${tab}` : undefined}>
            <UnsavedChangesProvider onChange={setDirty} onLeave={go => setLeavingFor({ go })}>
                {tab === 'general' && (
                    <>
                        <CompanyGeneralCard companyId={companyId} autoVerifyLocation={company.autoVerifyLocation} onSaved={onSaved} readOnly={readOnly} />
                        {/* The company's Admin sees them once the Super Admin allows them. */}
                        {(superAdmin || company.cashAdvancesAllowed) && (
                            <CashAdvancesCard
                                companyId={companyId}
                                allowed={!!company.cashAdvancesAllowed}
                                on={company.cashAdvancesOn ?? true}
                                held={company.cashAdvancesHeld ?? 0}
                                superAdmin={superAdmin}
                                readOnly={readOnly}
                                onSaved={onSaved}
                            />
                        )}
                        {company.costNamesOffered && (
                            <CostNamesCard
                                companyId={companyId}
                                on={!!company.costNamesFromListOnly}
                                saved={company.costNamesSaved ?? 0}
                                superAdmin={superAdmin}
                                readOnly={readOnly}
                                onSaved={onSaved}
                            />
                        )}
                    </>
                )}

                {tab === 'branding' && (
                    <>
                        <CompanyLogoCard
                            companyId={companyId}
                            companyName={company.name}
                            logoUrl={company.logoUrl}
                            onChanged={(logoUrl: string | null) => onSaved({ logoUrl })}
                            readOnly={readOnly}
                        />
                        <BrandColourCard
                            saved={company.brandColour ?? null}
                            defaultColour={company.defaultBrandColour}
                            hint={t('brand_colour_company_hint')}
                            readOnly={readOnly}
                            onSave={async brandColour => {
                                const res = await fetch('/api/company-settings', {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ companyId, tab: 'branding', brandColour }),
                                }).catch(() => null)
                                if (!res?.ok) return false
                                onSaved({ brandColour })
                                return true
                            }}
                        />
                    </>
                )}

                {tab === 'payroll' && (
                    <CompanyPayrollCard
                        companyId={companyId}
                        payrollDay={company.payrollDay}
                        payslipsVisible={company.payslipsVisible}
                        timezone={company.timezone}
                        debtRecoveryPercent={company.debtRecoveryPercent}
                        onSaved={onSaved}
                        readOnly={readOnly}
                        debtRecoveryEditable={superAdmin}
                    />
                )}

                {/* Schedules, seasonal hours, who works which, and holidays
                    (ATTENDANCE_PLAN.md §7). Saves each change as it is made. */}
                {tab === 'attendance' && <CompanyAttendanceCard companyId={companyId} readOnly={readOnly} />}

                {/* Who may do what here (ROLES_PLAN.md §6.2). */}
                {tab === 'roles' && <CompanyRolesCard companyId={companyId} />}

                {/* Replaces the Clients-only rename this screen used to
                    carry: every module can be renamed now, and Clients is
                    just one of the nine. */}
                {tab === 'modules' && (
                    <CompanyModulesCard
                        companyId={companyId}
                        moduleLabels={company.moduleLabels}
                        moduleIcons={company.moduleIcons}
                        onSaved={(labels: ModuleOverrides | null, icons: ModuleOverrides | null) =>
                            onSaved({ moduleLabels: labels, moduleIcons: icons })
                        }
                    />
                )}

                {tab === 'access' && (
                    <CompanySettingsAccessCard
                        companyId={companyId}
                        enabled={!!company.adminSettingsEnabled}
                        tabs={company.adminSettingsTabs ?? []}
                        onSaved={onSaved}
                    />
                )}
            </UnsavedChangesProvider>
            </div>

            <Dialog
                open={!!leavingFor}
                onClose={() => setLeavingFor(null)}
                title={t('settings_unsaved_title')}
                actions={<>
                    <Button onClick={() => setLeavingFor(null)}>{t('cancel')}</Button>
                    <Button variant="danger" onClick={leave}>{t('settings_unsaved_discard')}</Button>
                </>}
            >
                <p>{t('settings_unsaved_message')}</p>
            </Dialog>
        </>
    )
}
