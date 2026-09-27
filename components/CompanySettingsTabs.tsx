'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import ConfirmModal from '@/components/ConfirmModal'
import SegmentedToggle from '@/components/SegmentedToggle'
import CompanyGeneralCard from '@/components/CompanyGeneralCard'
import CompanyLogoCard from '@/components/CompanyLogoCard'
import CompanyPayrollCard from '@/components/CompanyPayrollCard'
import CompanyRolesCard from '@/components/CompanyRolesCard'
import CompanyModulesCard from '@/components/CompanyModulesCard'
import { useLanguage } from '@/context/LanguageContext'
import { COMPANY_SETTINGS_TABS, DEFAULT_SETTINGS_TAB, type CompanySettingsTabKey } from '@/lib/company-settings-tabs'
import { UnsavedChangesProvider, useUnsavedState } from '@/lib/useUnsavedChanges'
import type { ModuleOverrides } from '@/lib/modules'

/**
 * A company's settings, one tab per category (ATTENDANCE_PLAN.md §5.1). The
 * tabs come from lib/company-settings-tabs.ts; the open one is in the URL
 * (?tab=payroll), so a link or a reload lands on it. Leaving a tab, or the
 * page, with unsaved edits asks first.
 */

export type CompanySettings = {
    id: string
    name: string
    autoVerifyLocation: boolean
    moduleLabels: unknown
    moduleIcons: unknown
    logoUrl: string | null
    payrollDay: number
    payslipsVisible: boolean
    timezone: string
    debtRecoveryPercent: number
}

export default function CompanySettingsTabs({ company, onSaved }: {
    company: CompanySettings
    /** What a tab saved, merged into the page's copy without asking the server again. */
    onSaved: (next: Partial<CompanySettings>) => void
}) {
    const { t } = useLanguage()
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const { dirty, setDirty } = useUnsavedState()
    const [leavingFor, setLeavingFor] = useState<CompanySettingsTabKey | null>(null)

    const tabs = COMPANY_SETTINGS_TABS
    const asked = searchParams.get('tab')
    const tab: CompanySettingsTabKey = tabs.find(x => x.key === asked)?.key ?? DEFAULT_SETTINGS_TAB

    const open = (next: CompanySettingsTabKey) => {
        const query = new URLSearchParams(searchParams.toString())
        query.set('tab', next)
        router.replace(`${pathname}?${query.toString()}`, { scroll: false })
    }
    const choose = (next: CompanySettingsTabKey) => {
        if (next === tab) return
        if (dirty) setLeavingFor(next)
        else open(next)
    }

    const companyId = company.id
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '40rem' }}>
            <SegmentedToggle
                value={tab}
                onChange={choose}
                ariaLabel={t('company_settings_title')}
                options={tabs.map(x => ({ value: x.key, label: t(x.labelKey as any) }))}
            />

            <UnsavedChangesProvider onChange={setDirty}>
                {tab === 'general' && (
                    <CompanyGeneralCard companyId={companyId} autoVerifyLocation={company.autoVerifyLocation} onSaved={onSaved} />
                )}

                {tab === 'branding' && (
                    <CompanyLogoCard
                        companyId={companyId}
                        companyName={company.name}
                        logoUrl={company.logoUrl}
                        onChanged={(logoUrl: string | null) => onSaved({ logoUrl })}
                    />
                )}

                {tab === 'payroll' && (
                    <CompanyPayrollCard
                        companyId={companyId}
                        payrollDay={company.payrollDay}
                        payslipsVisible={company.payslipsVisible}
                        timezone={company.timezone}
                        debtRecoveryPercent={company.debtRecoveryPercent}
                        onSaved={onSaved}
                    />
                )}

                {/* Who may do what here (ROLES_PLAN.md §6.2). */}
                {tab === 'roles' && <CompanyRolesCard companyId={companyId} />}

                {/* Replaces the Vendors-only rename this screen used to
                    carry: every module can be renamed now, and Vendors is
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
            </UnsavedChangesProvider>

            <ConfirmModal
                isOpen={!!leavingFor}
                title={t('settings_unsaved_title')}
                message={t('settings_unsaved_message')}
                confirmText={t('settings_unsaved_discard')}
                variant="warning"
                onConfirm={() => { const next = leavingFor; setLeavingFor(null); if (next) { setDirty(false); open(next) } }}
                onCancel={() => setLeavingFor(null)}
            />
        </div>
    )
}
