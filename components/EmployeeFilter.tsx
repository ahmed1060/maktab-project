'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useSession } from 'next-auth/react'
import { useCompany } from '@/context/CompanyContext'
import SearchableSelect from './SearchableSelect'
import DateRangePicker from './DateRangePicker'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useDialog } from '@/lib/useDialog'
import type { ExtraFilter } from '@/components/locations/usePlaceFilters'

interface SortOption {
    label: string
    value: string
}

interface EmployeeFilterProps {
    /** The filters applied, with each of `extraFilters` by its key. */
    onFilterChange: (filters: { employeeId: string; dateFrom: string; dateTo: string; status: string; search: string } & Record<string, string>) => void
    selectedEmployeeId: string
    dateFrom: string
    dateTo: string
    /** Left out while there's no count to give: still loading, or it didn't load. */
    totalCount?: number
    totalCost?: number
    /** What the total is called; "Total cost" unless said. */
    totalCostLabel?: string
    selectedStatus?: string
    searchQuery?: string
    placeholder?: string
    isEmployee?: boolean
    // New Props for Reorganization
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
    onSortChange?: (field: string, order: 'asc' | 'desc') => void
    sortOptions?: SortOption[]
    primaryAction?: React.ReactNode,
    // Visibility toggles
    hideEmployeeFilter?: boolean,
    hideStatusFilter?: boolean,
    hideDateFilter?: boolean,
    // Restricted options
    allowedStatuses?: string[],
    // Role filter support
    showRoleFilter?: boolean,
    selectedRole?: string,
    onRoleChange?: (role: string) => void,
    /** Team leaders to offer, plus the Unassigned bucket. Empty hides it. */
    teamOptions?: { id: string; firstName: string; lastName: string }[],
    selectedTeam?: string,
    onTeamChange?: (team: string) => void,
    hideFilterButton?: boolean,
    hideSearch?: boolean,
    statusOptions?: SortOption[],
    // Company filter support
    showCompanyFilter?: boolean,
    selectedCompanyId?: string,
    onCompanyChange?: (id: string) => void,
    companyOptions?: SortOption[],
    secondaryAction?: React.ReactNode,
    toolkitAction?: React.ReactNode,
    /** More selects in the panel, applied with the rest, such as a client and a location (CLIENTS_PLAN.md §3). */
    extraFilters?: ExtraFilter[]
}

// Define interface for Employee data locally since it's just for display
interface EmployeeType {
    id: string
    firstName: string
    lastName: string
    role: string
}

export default function EmployeeFilter({
    onFilterChange,
    selectedEmployeeId,
    dateFrom,
    dateTo,
    totalCount,
    totalCost,
    totalCostLabel,
    selectedStatus = '',
    searchQuery = '',
    placeholder,
    isEmployee = false,
    sortBy,
    sortOrder,
    onSortChange,
    sortOptions,
    primaryAction,
    hideEmployeeFilter,
    hideStatusFilter,
    hideDateFilter,
    allowedStatuses,
    showRoleFilter,
    selectedRole = '',
    onRoleChange,
    teamOptions,
    selectedTeam = '',
    onTeamChange,
    hideFilterButton,
    hideSearch,
    statusOptions,
    showCompanyFilter,
    selectedCompanyId = '',
    onCompanyChange,
    companyOptions,
    secondaryAction,
    toolkitAction,
    extraFilters = []
}: EmployeeFilterProps) {
    const [isPopupOpen, setIsPopupOpen] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    const { t, locale } = useLanguage()
    const filterDialog = useDialog(isPopupOpen, () => setIsPopupOpen(false), { label: t('filters') })
    const { data: session } = useSession()
    const { selectedCompanyId: globalCompanyId } = useCompany()

    const [localEmployeeId, setLocalEmployeeId] = useState(selectedEmployeeId)
    const [localDateFrom, setLocalDateFrom] = useState(dateFrom)
    const [localDateTo, setLocalDateTo] = useState(dateTo)
    const [localStatus, setLocalStatus] = useState(selectedStatus)
    const [localRole, setLocalRole] = useState(selectedRole)
    const [localTeam, setLocalTeam] = useState(selectedTeam)
    const [localCompanyId, setLocalCompanyId] = useState(selectedCompanyId)
    const [searchTerm, setSearchTerm] = useState(searchQuery)
    const [localSortBy, setLocalSortBy] = useState(sortBy || '')
    const [localSortOrder, setLocalSortOrder] = useState<'asc' | 'desc'>(sortOrder || 'asc')
    const appliedExtra = Object.fromEntries(extraFilters.map(f => [f.key, f.value]))
    const [localExtra, setLocalExtra] = useState<Record<string, string>>(appliedExtra)
    const optionsOf = (f: ExtraFilter, picked: Record<string, string>) => typeof f.options === 'function' ? f.options(picked) : f.options
    // One picked, and any that follows it and no longer offers its own pick
    // cleared. A hidden one offers none: it's kept until Reset.
    const pickExtra = (key: string, value: string) => {
        const next = { ...localExtra, [key]: value }
        for (const f of extraFilters) {
            if (!f.hidden && next[f.key] && !optionsOf(f, next).some(o => o.value === next[f.key])) next[f.key] = ''
        }
        setLocalExtra(next)
    }

    const handleApplyFilters = useCallback(() => {
        onFilterChange({
            employeeId: localEmployeeId,
            dateFrom: localDateFrom,
            dateTo: localDateTo,
            status: localStatus,
            search: searchTerm,
            ...localExtra
        })
        if (onSortChange && localSortBy) {
            onSortChange(localSortBy, localSortOrder)
        }
        if (onRoleChange && showRoleFilter) onRoleChange(localRole)
        if (onTeamChange) onTeamChange(localTeam)
        if (onCompanyChange && showCompanyFilter) onCompanyChange(localCompanyId)
        setIsPopupOpen(false)
    }, [onFilterChange, localEmployeeId, localDateFrom, localDateTo, localStatus, searchTerm, localExtra, onSortChange, localSortBy, localSortOrder, onRoleChange, showRoleFilter, localRole, onCompanyChange, showCompanyFilter, localCompanyId, onTeamChange, localTeam])

    // Follow the parent when it changes the applied filters (a reset, a URL
    // change), in the same render rather than one render late.
    useAdjustOnChange([selectedEmployeeId, selectedStatus, selectedRole, selectedCompanyId, dateFrom, dateTo, searchQuery, sortBy, sortOrder, selectedTeam, JSON.stringify(appliedExtra)], () => {
        setLocalExtra(appliedExtra)
        setLocalEmployeeId(selectedEmployeeId)
        setLocalStatus(selectedStatus)
        setLocalRole(selectedRole)
        setLocalTeam(selectedTeam)
        setLocalCompanyId(selectedCompanyId)
        setLocalDateFrom(dateFrom)
        setLocalDateTo(dateTo)
        setSearchTerm(searchQuery)
        setLocalSortBy(sortBy || '')
        setLocalSortOrder(sortOrder || 'asc')
    })

    // Auto-apply search with 500ms debounce
    useEffect(() => {
        if (searchTerm === searchQuery) return

        const timer = setTimeout(() => {
            handleApplyFilters()
        }, 500)

        return () => clearTimeout(timer)
    }, [searchTerm, searchQuery, handleApplyFilters]) // Added missing dependencies too

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768)
        }
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, []) // handleApplyFilters and searchQuery were not needed here, they were unused in this effect.

    // The people the employee picker offers. Keyed by the company a Super
    // Admin is looking at, so switching company cannot leave the previous
    // company's answer on screen if it arrives last. Waits for the session,
    // which decides whether that company applies.
    const wantsEmployees = !isEmployee && !hideEmployeeFilter
    const role = session?.user?.role as string | undefined
    const employeesKey = wantsEmployees && session
        ? `/api/users?limit=1000${role === 'SUPER_ADMIN' && globalCompanyId ? `&companyId=${globalCompanyId}` : ''}`
        : null
    const { data: employeesResult, error: employeesError, isLoading: employeesLoading } = useSWR(employeesKey, fetcher)
    const loading = wantsEmployees && (!session || employeesLoading)
    const error = employeesError ? t('failed_load_employees') : null
    const employees: EmployeeType[] = useMemo(() => {
        if (!employeesResult) return []
        // /api/users actually returns the double-nested envelope
        // { success, data: { data: [...], total, page } } — this
        // used to only unwrap one level, so `data` was that
        // pagination object (not an array), and .filter() below
        // threw on every call. Unwrap however deep it goes.
        const payload = employeesResult?.data ?? employeesResult
        const data: EmployeeType[] = Array.isArray(payload) ? payload : (payload?.data || [])
        const rolePriority: { [key: string]: number } = {
            'EMPLOYEE': 1,
            'TEAM_LEADER': 2,
            'ADMIN': 3,
            'SUPER_ADMIN': 4
        }
        return data
            .filter(emp => emp.role !== 'ADMIN' && emp.role !== 'SUPER_ADMIN')
            .sort((a, b) => {
                const priorityA = rolePriority[a.role] || 99
                const priorityB = rolePriority[b.role] || 99
                return priorityA !== priorityB ? priorityA - priorityB : a.firstName.localeCompare(b.firstName)
            })
    }, [employeesResult])

    // Removed auto-apply search effect to wait for "Show Results"


    const resetFilters = () => {
        setLocalEmployeeId('')
        setLocalStatus('')
        setLocalDateFrom('')
        setLocalDateTo('')
        setLocalRole('')
        setLocalCompanyId('')
        setSearchTerm('')
        const noExtra = Object.fromEntries(extraFilters.map(f => [f.key, '']))
        setLocalExtra(noExtra)
        onFilterChange({ employeeId: '', dateFrom: '', dateTo: '', status: '', search: '', ...noExtra })
        if (onSortChange && sortOptions?.[0]) {
            onSortChange(sortOptions[0].value, 'asc')
        }
        if (onRoleChange) onRoleChange('')
        setLocalTeam('')
        if (onTeamChange) onTeamChange('')
        if (onCompanyChange) onCompanyChange('')
    }

    const getRoleKey = (role: string) => {
        switch (role) {
            case 'EMPLOYEE': return 'role_employee'
            case 'TEAM_LEADER': return 'role_team_leader'
            case 'ADMIN': return 'role_admin'
            case 'SUPER_ADMIN': return 'role_super_admin'
            default: return 'role_employee'
        }
    }

    const handleSearchChange = (search: string) => {
        setSearchTerm(search)
    }

    const activeFilterCount = [
        (!hideEmployeeFilter && selectedEmployeeId) ? 1 : 0,
        (!hideStatusFilter && selectedStatus) ? 1 : 0,
        (!hideDateFilter && (dateFrom || dateTo)) ? 1 : 0,
        (showRoleFilter && selectedRole) ? 1 : 0,
        selectedTeam ? 1 : 0,
        (showCompanyFilter && selectedCompanyId) ? 1 : 0,
        ...extraFilters.map(f => (f.value ? 1 : 0))
    ].reduce((a, b) => a + b, 0)


    return (
        <div style={{
            marginBottom: '2rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            position: 'relative'
        }}>
            {/* Unified Toolbar Row */}
            <div style={{
                display: 'flex',
                gap: '1rem',
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: '0.75rem',
                position: 'relative',
                zIndex: 10
            }}>
                {/* Background Layer - Isolated from children to prevent rendering artifacts */}
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'var(--glass-bg)',
                    backdropFilter: 'blur(8px) saturate(150%)',
                    WebkitBackdropFilter: 'blur(8px) saturate(150%)',
                    borderRadius: '1.5rem',
                    border: '1px solid var(--veil-50)',
                    zIndex: -1,
                    pointerEvents: 'none'
                }} />
                {/* Secondary Action - At the start (e.g. Back Button) */}
                {secondaryAction && (
                    <div style={{ marginRight: locale === 'ar' ? '0' : '0.5rem', marginLeft: locale === 'ar' ? '0.5rem' : '0' }}>
                        {secondaryAction}
                    </div>
                )}

                {/* Spacer to push items to the right if search is hidden */}
                {hideSearch && <div style={{ flex: 1 }} />}

                {/* Search - Flexible width */}
                {!hideSearch && (
                    <div style={{ flex: '1 1 14rem', minWidth: 0, position: 'relative' }}>
                        <div style={{ position: 'absolute', [locale === 'ar' ? 'right' : 'left']: '1.25rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                        </div>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleApplyFilters()
                                }
                            }}
                            placeholder={placeholder || t('search_placeholder')}
                            className="input"
                            style={{
                                width: '100%',
                                padding: locale === 'ar' ? '0.625rem 3.5rem 0.625rem 1.25rem' : '0.625rem 1.25rem 0.625rem 3.5rem',
                                borderRadius: '1.25rem',
                                fontSize: '0.95rem',
                                border: '1px solid var(--border)',
                                textAlign: locale === 'ar' ? 'right' : 'left',
                                background: 'var(--surface)',
                                height: '48px',
                                minHeight: '48px'
                            }}
                        />
                    </div>
                )}

                {/* Toolkit Action (e.g. ID Button) */}
                {toolkitAction && (
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        {toolkitAction}
                    </div>
                )}

                {/* Filters Trigger */}
                {!isEmployee && !hideFilterButton && (
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => !loading && setIsPopupOpen(!isPopupOpen)}
                            disabled={loading}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                padding: '0 1.5rem',
                                borderRadius: '1.25rem',
                                background: loading ? 'var(--surface-sunk)' : (activeFilterCount > 0 ? 'var(--info-bg-subtle)' : 'var(--surface)'),
                                border: `2px solid ${loading ? 'var(--border)' : (activeFilterCount > 0 ? 'var(--info-solid)' : 'var(--border)')}`,
                                color: loading ? 'var(--text-faint)' : (activeFilterCount > 0 ? 'var(--info-solid-hover)' : 'var(--text-muted)'),
                                fontWeight: '700',
                                fontSize: '0.95rem',
                                cursor: loading ? 'default' : 'pointer',
                                transition: 'all 0.2s ease',
                                position: 'relative',
                                height: '48px',
                                opacity: loading ? 0.7 : 1,
                                animation: loading ? 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' : 'none'
                            }}
                        >
                            {loading ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid var(--border-firm)', borderTopColor: 'var(--text-faint)', animation: 'spin 1s linear infinite' }} />
                                    <span>{t('loading_filters')}</span>
                                </div>
                            ) : (
                                <>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                                    </svg>
                                    {t('filters')}
                                </>
                            )}
                            {activeFilterCount > 0 && (
                                <span style={{
                                    position: 'absolute',
                                    top: '-4px',
                                    [locale === 'ar' ? 'left' : 'right']: '-4px',
                                    background: 'var(--info-fill)',
                                    color: 'var(--text-on-accent)',
                                    width: '20px',
                                    height: '20px',
                                    borderRadius: '50%',
                                    fontSize: '0.7rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: '2px solid white'
                                }}>
                                    {activeFilterCount}
                                </span>
                            )}
                        </button>

                        {/* Popup / Modal */}
                        {isPopupOpen && (
                            <>
                                <div
                                    onClick={() => setIsPopupOpen(false)}
                                    style={{
                                        position: 'fixed',
                                        inset: 0,
                                        zIndex: 999,
                                        backgroundColor: isMobile ? 'var(--scrim)' : 'transparent',
                                        backdropFilter: isMobile ? 'blur(4px)' : 'none'
                                    }}
                                />
                                <div {...filterDialog.panelProps} style={{
                                    position: isMobile ? 'fixed' : 'absolute',
                                    top: isMobile ? '50%' : 'calc(100% + 0.75rem)',
                                    left: isMobile ? '50%' : (locale === 'ar' ? '0' : 'auto'),
                                    right: isMobile ? 'auto' : (locale === 'ar' ? 'auto' : '0'),
                                    transform: isMobile ? 'translate(-50%, -50%)' : 'none',
                                    width: isMobile ? 'min(calc(100vw - 3rem), 400px)' : '320px',
                                    maxHeight: isMobile ? 'calc(100vh - 4rem)' : 'auto',
                                    overflowY: isMobile ? 'auto' : 'visible',
                                    backgroundColor: 'var(--surface)',
                                    borderRadius: '1.25rem',
                                    padding: '1.5rem',
                                    boxShadow: '0 20px 25px -5px var(--shadow-weak), 0 10px 10px -5px var(--shadow-faint)',
                                    border: '1px solid var(--border)',
                                    zIndex: 1000,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '1.25rem',
                                    animation: 'popIn 0.2s ease-out',
                                    opacity: 1
                                }}>
                                    <style>{`
                                        @keyframes popIn { 
                                            from { 
                                                opacity: 0; 
                                                transform: ${isMobile ? 'translate(-50%, -45%)' : 'translateY(-8px)'}; 
                                            } 
                                            to { 
                                                opacity: 1; 
                                                transform: ${isMobile ? 'translate(-50%, -50%)' : 'translateY(0)'}; 
                                            } 
                                        }
                                    `}</style>

                                    {/* Sort controls at the top of filter popup */}
                                    {onSortChange && sortOptions && (
                                        <div style={{ paddingBottom: '1.25rem', borderBottom: '1px solid var(--surface-sunk)' }}>
                                            <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: '800', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-soft)', letterSpacing: '0.05em' }}>{t('sort_by')}</label>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                                                <div style={{ position: 'relative', flex: 1 }}>
                                                    <select aria-label={t('sort_by')}
                                                        value={localSortBy}
                                                        onChange={(e) => setLocalSortBy(e.target.value)}
                                                        className="input"
                                                        style={{
                                                            width: '100%',
                                                            padding: locale === 'ar' ? '0 0.75rem 0 2.25rem' : '0 2.25rem 0 0.75rem',
                                                            borderRadius: '1.25rem',
                                                            fontSize: '0.9rem',
                                                            backgroundColor: 'var(--surface)',
                                                            border: '1px solid var(--border)',
                                                            cursor: 'pointer',
                                                            height: '48px',
                                                            textAlign: locale === 'ar' ? 'right' : 'left',
                                                            appearance: 'none',
                                                            backgroundImage: 'none',
                                                            fontWeight: '500'
                                                        }}
                                                    >
                                                        {sortOptions.map(opt => (
                                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                        ))}
                                                    </select>
                                                    <div style={{ position: 'absolute', [locale === 'ar' ? 'left' : 'right']: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }}>
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M6 9l6 6 6-6"></path>
                                                        </svg>
                                                    </div>
                                                </div>
                                                <button aria-label={localSortOrder === 'asc' ? t('ascending') : t('descending')}
                                                    onClick={() => setLocalSortOrder(localSortOrder === 'asc' ? 'desc' : 'asc')}
                                                    style={{
                                                        height: '48px',
                                                        width: '48px',
                                                        borderRadius: '1.25rem',
                                                        border: '1px solid var(--border)',
                                                        background: 'var(--surface)',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: 'var(--text-muted)'
                                                    }}
                                                >
                                                    {localSortOrder === 'asc' ? '↑' : '↓'}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {!hideEmployeeFilter && (
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{t('filter_by_employee')}</label>
                                            <SearchableSelect
                                                options={error ? [] : employees.map(emp => ({
                                                    label: `${emp.firstName} ${emp.lastName}`,
                                                    value: emp.id,
                                                    subLabel: t(getRoleKey(emp.role) as any)
                                                }))}
                                                value={localEmployeeId}
                                                onChange={setLocalEmployeeId}
                                                placeholder={error || t('placeholder_all_employees')}
                                            />
                                        </div>
                                    )}

                                    {showRoleFilter && onRoleChange && (
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{t('role_label') || 'Role'}</label>
                                            <div style={{ position: 'relative' }}>
                                                <select aria-label={t('role_label') || 'Role'}
                                                    value={localRole}
                                                    onChange={(e) => setLocalRole(e.target.value)}
                                                    className="input"
                                                    style={{
                                                        width: '100%',
                                                        padding: locale === 'ar' ? '0 0.75rem 0 2.25rem' : '0 2.25rem 0 0.75rem',
                                                        borderRadius: '1.25rem',
                                                        background: 'var(--surface)',
                                                        border: '1px solid var(--border)',
                                                        height: '48px',
                                                        appearance: 'none',
                                                        backgroundImage: 'none',
                                                        cursor: 'pointer',
                                                        fontSize: '0.9rem',
                                                        fontWeight: '500',
                                                        textAlign: locale === 'ar' ? 'right' : 'left'
                                                    }}
                                                >
                                                    <option value="">{t('all_roles')}</option>
                                                    <option value="EMPLOYEE">{t('role_employee')}</option>
                                                    <option value="TEAM_LEADER">{t('role_team_leader')}</option>
                                                    <option value="ADMIN">{t('role_admin')}</option>
                                                </select>
                                                <div style={{ position: 'absolute', [locale === 'ar' ? 'left' : 'right']: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }}>
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M6 9l6 6 6-6"></path>
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Only when there are teams to choose
                                        between. A company with no team leaders
                                        has no teams, and a filter whose only
                                        option is "all" is furniture. */}
                                    {onTeamChange && (teamOptions?.length ?? 0) > 0 && (
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{t('team_column')}</label>
                                            <div style={{ position: 'relative' }}>
                                                <select aria-label={t('team_column')}
                                                    value={localTeam}
                                                    onChange={(e) => setLocalTeam(e.target.value)}
                                                    className="input"
                                                    style={{
                                                        width: '100%',
                                                        padding: locale === 'ar' ? '0 0.75rem 0 2.25rem' : '0 2.25rem 0 0.75rem',
                                                        borderRadius: '1.25rem',
                                                        background: 'var(--surface)',
                                                        border: '1px solid var(--border)',
                                                        height: '48px',
                                                        appearance: 'none',
                                                        backgroundImage: 'none',
                                                        cursor: 'pointer',
                                                        fontSize: '0.9rem',
                                                        fontWeight: '500',
                                                        textAlign: locale === 'ar' ? 'right' : 'left'
                                                    }}
                                                >
                                                    <option value="">{t('team_filter_all')}</option>
                                                    {/* A real value, not the absence of one: unassigned
                                                        people are visible to no team leader, so they are
                                                        exactly who an Admin needs to be able to find. */}
                                                    <option value="unassigned">{t('team_unassigned')}</option>
                                                    {teamOptions!.map(l => (
                                                        <option key={l.id} value={l.id}>{l.firstName} {l.lastName}</option>
                                                    ))}
                                                </select>
                                                <div style={{ position: 'absolute', [locale === 'ar' ? 'left' : 'right']: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }}>
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M6 9l6 6 6-6"></path>
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {extraFilters.filter(f => !f.hidden).map(f => (
                                        <div key={f.key}>
                                            <label htmlFor={`extra-filter-${f.key}`} style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{f.label}</label>
                                            <div style={{ position: 'relative' }}>
                                                <select id={`extra-filter-${f.key}`}
                                                    value={localExtra[f.key] ?? ''}
                                                    onChange={(e) => pickExtra(f.key, e.target.value)}
                                                    className="input"
                                                    style={{
                                                        width: '100%',
                                                        paddingInlineStart: '0.75rem',
                                                        paddingInlineEnd: '2.25rem',
                                                        borderRadius: '1.25rem',
                                                        background: 'var(--surface)',
                                                        border: '1px solid var(--border)',
                                                        height: '48px',
                                                        appearance: 'none',
                                                        backgroundImage: 'none',
                                                        cursor: 'pointer',
                                                        fontSize: '0.9rem',
                                                        fontWeight: '500',
                                                        textAlign: 'start'
                                                    }}
                                                >
                                                    {optionsOf(f, localExtra).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                </select>
                                                <div style={{ position: 'absolute', insetInlineEnd: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }}>
                                                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M6 9l6 6 6-6"></path>
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {showCompanyFilter && companyOptions && Array.isArray(companyOptions) && (
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{t('company_label')}</label>
                                            <div style={{ position: 'relative' }}>
                                                <select aria-label={t('company_label')}
                                                    value={localCompanyId}
                                                    onChange={(e) => setLocalCompanyId(e.target.value)}
                                                    className="input"
                                                    style={{
                                                        width: '100%',
                                                        padding: locale === 'ar' ? '0 0.75rem 0 2.25rem' : '0 2.25rem 0 0.75rem',
                                                        borderRadius: '1.25rem',
                                                        background: 'var(--surface)',
                                                        border: '1px solid var(--border)',
                                                        height: '48px',
                                                        appearance: 'none',
                                                        backgroundImage: 'none',
                                                        cursor: 'pointer',
                                                        fontSize: '0.9rem',
                                                        fontWeight: '500',
                                                        textAlign: locale === 'ar' ? 'right' : 'left'
                                                    }}
                                                >
                                                    <option value="">{t('all_companies')}</option>
                                                    {companyOptions.map(opt => (
                                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                    ))}
                                                </select>
                                                <div style={{ position: 'absolute', [locale === 'ar' ? 'left' : 'right']: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }}>
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M6 9l6 6 6-6"></path>
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {!hideStatusFilter && (
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{t('filter_by_status')}</label>
                                            <div style={{ position: 'relative' }}>
                                                <select aria-label={t('filter_by_status')}
                                                    value={localStatus}
                                                    onChange={(e) => setLocalStatus(e.target.value)}
                                                    className="input"
                                                    style={{
                                                        width: '100%',
                                                        padding: locale === 'ar' ? '0 0.75rem 0 2.25rem' : '0 2.25rem 0 0.75rem',
                                                        borderRadius: '1.25rem',
                                                        background: 'var(--surface)',
                                                        border: '1px solid var(--border)',
                                                        height: '48px',
                                                        appearance: 'none',
                                                        backgroundImage: 'none',
                                                        cursor: 'pointer',
                                                        fontSize: '0.9rem',
                                                        fontWeight: '500',
                                                        textAlign: locale === 'ar' ? 'right' : 'left'
                                                    }}
                                                >
                                                    <option value="">{t('placeholder_all_statuses')}</option>
                                                    {statusOptions && Array.isArray(statusOptions) ? (
                                                        statusOptions.map(opt => (
                                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                        ))
                                                    ) : (
                                                        <>
                                                            {(!allowedStatuses || allowedStatuses.includes('COMPLETED')) && <option value="COMPLETED">{t('status_completed')}</option>}
                                                            {(!allowedStatuses || allowedStatuses.includes('APPROVED')) && <option value="APPROVED">{t('status_approved')}</option>}
                                                            {(!allowedStatuses || allowedStatuses.includes('REJECTED')) && <option value="REJECTED">{t('status_rejected')}</option>}
                                                            {(!allowedStatuses || allowedStatuses.includes('PENDING_CONFIRMATION')) && <option value="PENDING_CONFIRMATION">{t('status_pending_confirmation')}</option>}
                                                            {(!allowedStatuses || allowedStatuses.includes('IN_PROGRESS')) && <option value="IN_PROGRESS">{t('status_in_progress')}</option>}
                                                            {(!allowedStatuses || allowedStatuses.includes('PENDING')) && <option value="PENDING">{t('status_pending')}</option>}
                                                        </>
                                                    )}
                                                </select>
                                                <div style={{ position: 'absolute', [locale === 'ar' ? 'left' : 'right']: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }}>
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M6 9l6 6 6-6"></path>
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {!hideDateFilter && (
                                        <div>
                                            <DateRangePicker
                                                dateFrom={localDateFrom}
                                                dateTo={localDateTo}
                                                onChange={(from, to) => {
                                                    setLocalDateFrom(from)
                                                    setLocalDateTo(to)
                                                }}
                                            />
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
                                        <button
                                            onClick={resetFilters}
                                            style={{
                                                flex: 1,
                                                height: '48px',
                                                borderRadius: '1.25rem',
                                                border: '1px solid var(--border)',
                                                background: 'var(--surface)',
                                                fontWeight: '700',
                                                cursor: 'pointer',
                                                fontSize: '0.875rem',
                                                color: 'var(--text-soft)',
                                                transition: 'all 0.2s ease'
                                            }}
                                            onMouseOver={(e) => e.currentTarget.style.background = 'var(--surface-subtle)'}
                                            onMouseOut={(e) => e.currentTarget.style.background = 'var(--surface)'}
                                        >
                                            {t('reset_filters')}
                                        </button>
                                        <button
                                            onClick={handleApplyFilters}
                                            style={{
                                                flex: 1,
                                                height: '48px',
                                                borderRadius: '1.25rem',
                                                border: 'none',
                                                background: 'linear-gradient(135deg, var(--brand-primary) 0%, var(--accent-fill) 100%)',
                                                color: 'var(--text-on-accent)',
                                                fontWeight: '700',
                                                cursor: 'pointer',
                                                fontSize: '0.875rem',
                                                boxShadow: '0 4px 12px color-mix(in srgb, var(--primary) 20%, transparent)'
                                            }}
                                        >
                                            {t('show_results')}
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}


                {/* Statistics Box */}
                {totalCount !== undefined && <div style={{
                    height: '48px',
                    padding: '0 1.25rem',
                    // Was var(--text-strong): the darkest ink, which reads as a
                    // dark pill in light mode and as a near-white one in dark,
                    // where the label written on it disappeared. A filled chip
                    // needs its own pair, not the text scale's end.
                    background: 'var(--chip-solid-bg)',
                    borderRadius: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    whiteSpace: 'nowrap',
                    color: 'var(--chip-solid-fg)'
                }}>
                    {/* 0.5 opacity put this close to invisible on the filled
                        chip. The label is small and uppercase already; it does
                        not also need to be faint to read as secondary. */}
                    <span style={{ fontSize: '0.7rem', fontWeight: '800', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('total_label')}</span>
                    <span style={{ fontSize: '1.25rem', fontWeight: '900' }}>{totalCount}</span>
                </div>}

                {/* Primary Action Integration */}
                {primaryAction && (
                    <div className="toolbar-action" style={{ marginLeft: locale === 'ar' ? '0' : 'auto', marginRight: locale === 'ar' ? 'auto' : '0' }}>
                        {primaryAction}
                    </div>
                )}
            </div>

            {/* Total Cost Badge - Below if present */}
            {totalCost !== undefined && (
                <div style={{ display: 'flex', justifyContent: locale === 'ar' ? 'flex-end' : 'flex-end', marginTop: '-0.5rem' }}>
                    <div style={{
                        background: 'linear-gradient(135deg, var(--warn-bg-warm-subtle) 0%, var(--warn-bg-warm) 100%)',
                        color: 'var(--warn-fg-warm)',
                        padding: '0.5rem 1.25rem',
                        borderRadius: '1rem',
                        border: '1px solid var(--warn-border-warm)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        boxShadow: '0 2px 4px color-mix(in srgb, var(--warn-solid-warm) 5%, transparent)'
                    }}>
                        <div style={{ background: 'var(--warn-fill-warm)', color: 'var(--text-on-accent)', padding: '0.25rem', borderRadius: '0.5rem', display: 'flex' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="1" x2="12" y2="23"></line>
                                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                            </svg>
                        </div>
                        <span style={{ fontSize: '0.7rem', fontWeight: '800', opacity: 0.8, textTransform: 'uppercase' }}>{totalCostLabel ?? t('total_cost')}:</span>
                        <span style={{ fontSize: '1.125rem', fontWeight: '900' }}>
                            {totalCost.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2 })} <span style={{ fontSize: '0.75rem' }}>{locale === 'ar' ? 'ج.م' : 'EGP'}</span>
                        </span>
                    </div>
                </div>
            )}
        </div>
    )
}
