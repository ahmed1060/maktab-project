'use client'
import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useSession } from 'next-auth/react'
import { useCompany } from '@/context/CompanyContext'
import SearchableSelect from './SearchableSelect'
import DateRangePicker from './DateRangePicker'

interface SortOption {
    label: string
    value: string
}

interface EmployeeFilterProps {
    onFilterChange: (filters: { employeeId: string; dateFrom: string; dateTo: string; status: string; search: string }) => void
    selectedEmployeeId: string
    dateFrom: string
    dateTo: string
    totalCount: number
    totalCost?: number
    selectedStatus?: string
    searchQuery?: string
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
    hideFilterButton?: boolean,
    hideSearch?: boolean,
    statusOptions?: SortOption[],
    // Company filter support
    showCompanyFilter?: boolean,
    selectedCompanyId?: string,
    onCompanyChange?: (id: string) => void,
    companyOptions?: SortOption[]
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
    selectedStatus = '',
    searchQuery = '',
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
    hideFilterButton,
    hideSearch,
    statusOptions,
    showCompanyFilter,
    selectedCompanyId = '',
    onCompanyChange,
    companyOptions
}: EmployeeFilterProps) {
    const [employees, setEmployees] = useState<EmployeeType[]>([])
    const [loading, setLoading] = useState(!isEmployee && !hideEmployeeFilter)
    const [isPopupOpen, setIsPopupOpen] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    const { t, locale } = useLanguage()
    const { data: session } = useSession()
    const { selectedCompanyId: globalCompanyId } = useCompany()

    const [localEmployeeId, setLocalEmployeeId] = useState(selectedEmployeeId)
    const [localDateFrom, setLocalDateFrom] = useState(dateFrom)
    const [localDateTo, setLocalDateTo] = useState(dateTo)
    const [localStatus, setLocalStatus] = useState(selectedStatus)
    const [localRole, setLocalRole] = useState(selectedRole)
    const [localCompanyId, setLocalCompanyId] = useState(selectedCompanyId)

    useEffect(() => {
        setLocalEmployeeId(selectedEmployeeId)
        setLocalStatus(selectedStatus)
        setLocalRole(selectedRole)
        setLocalCompanyId(selectedCompanyId)
        setLocalDateFrom(dateFrom)
        setLocalDateTo(dateTo)
    }, [selectedEmployeeId, selectedStatus, selectedRole, selectedCompanyId, dateFrom, dateTo])

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768)
        }
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    useEffect(() => {
        if (!isEmployee && !hideEmployeeFilter) {
            setLoading(true)
            const role = session?.user?.role as string
            let url = '/api/users?limit=1000'

            // For Super Admins, respect the global company selection
            if (role === 'SUPER_ADMIN' && globalCompanyId) {
                url += `&companyId=${globalCompanyId}`
            }

            fetch(url)
                .then(res => res.json())
                .then(responseData => {
                    // Support both direct array and { data: [] } structure
                    const data = Array.isArray(responseData) ? responseData : (responseData.data || [])

                    const filteredData = data.filter((emp: EmployeeType) => emp.role !== 'ADMIN' && emp.role !== 'SUPER_ADMIN')
                    const sortedData = filteredData.sort((a: EmployeeType, b: EmployeeType) => {
                        const rolePriority: { [key: string]: number } = {
                            'EMPLOYEE': 1,
                            'TEAM_LEADER': 2,
                            'ADMIN': 3,
                            'SUPER_ADMIN': 4
                        }
                        const priorityA = rolePriority[a.role] || 99
                        const priorityB = rolePriority[b.role] || 99
                        return priorityA !== priorityB ? priorityA - priorityB : a.firstName.localeCompare(b.firstName)
                    })
                    setEmployees(sortedData)
                    setLoading(false)
                })
                .catch(err => {
                    console.error('Failed to load employees:', err)
                    setLoading(false)
                })
        } else {
            setLoading(false)
        }
    }, [isEmployee, hideEmployeeFilter, session?.user?.role, globalCompanyId])

    const handleApplyFilters = () => {
        onFilterChange({
            employeeId: localEmployeeId,
            dateFrom: localDateFrom,
            dateTo: localDateTo,
            status: localStatus,
            search: searchQuery
        })
        if (onRoleChange && showRoleFilter) onRoleChange(localRole)
        if (onCompanyChange && showCompanyFilter) onCompanyChange(localCompanyId)
        setIsPopupOpen(false)
    }

    const resetFilters = () => {
        setLocalEmployeeId('')
        setLocalStatus('')
        setLocalDateFrom('')
        setLocalDateTo('')
        setLocalRole('')
        setLocalCompanyId('')
        onFilterChange({ employeeId: '', dateFrom: '', dateTo: '', status: '', search: searchQuery })
        if (onRoleChange) onRoleChange('')
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
        // Search stays immediate
        onFilterChange({
            employeeId: selectedEmployeeId,
            dateFrom: dateFrom,
            dateTo: dateTo,
            status: selectedStatus,
            search
        })
    }

    const activeFilterCount = [
        (!hideEmployeeFilter && selectedEmployeeId) ? 1 : 0,
        (!hideStatusFilter && selectedStatus) ? 1 : 0,
        (!hideDateFilter && (dateFrom || dateTo)) ? 1 : 0,
        (showRoleFilter && selectedRole) ? 1 : 0,
        (showCompanyFilter && selectedCompanyId) ? 1 : 0
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
                    background: 'rgba(255, 255, 255, 0.4)',
                    backdropFilter: 'blur(8px)',
                    borderRadius: '1.5rem',
                    border: '1px solid rgba(255, 255, 255, 0.5)',
                    zIndex: -1,
                    pointerEvents: 'none'
                }} />
                {/* Spacer to push items to the right if search is hidden */}
                {hideSearch && <div style={{ flex: 1 }} />}

                {/* Search - Flexible width */}
                {!hideSearch && (
                    <div style={{ flex: 1, minWidth: '300px', position: 'relative' }}>
                        <div style={{ position: 'absolute', [locale === 'ar' ? 'right' : 'left']: '1.25rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                        </div>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            placeholder={t('search_placeholder')}
                            className="input"
                            style={{
                                width: '100%',
                                padding: locale === 'ar' ? '0.625rem 3.5rem 0.625rem 1.25rem' : '0.625rem 1.25rem 0.625rem 3.5rem',
                                borderRadius: '1.25rem',
                                fontSize: '0.95rem',
                                border: '1px solid #e2e8f0',
                                textAlign: locale === 'ar' ? 'right' : 'left',
                                background: 'white',
                                height: '48px',
                                minHeight: '48px'
                            }}
                        />
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
                                background: loading ? '#f1f5f9' : (activeFilterCount > 0 ? '#eff6ff' : 'white'),
                                border: `2px solid ${loading ? '#e2e8f0' : (activeFilterCount > 0 ? '#3b82f6' : '#e2e8f0')}`,
                                color: loading ? '#94a3b8' : (activeFilterCount > 0 ? '#2563eb' : '#475569'),
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
                                    <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid #cbd5e1', borderTopColor: '#94a3b8', animation: 'spin 1s linear infinite' }} />
                                    <span>{t('loading_filters')}</span>
                                </div>
                            ) : (
                                <>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                                    </svg>
                                    {t('filters_button')}
                                </>
                            )}
                            {activeFilterCount > 0 && (
                                <span style={{
                                    position: 'absolute',
                                    top: '-4px',
                                    [locale === 'ar' ? 'left' : 'right']: '-4px',
                                    background: '#3b82f6',
                                    color: 'white',
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
                                        backgroundColor: isMobile ? 'rgba(0,0,0,0.3)' : 'transparent',
                                        backdropFilter: isMobile ? 'blur(4px)' : 'none'
                                    }}
                                />
                                <div style={{
                                    position: isMobile ? 'fixed' : 'absolute',
                                    top: isMobile ? '50%' : 'calc(100% + 0.75rem)',
                                    left: isMobile ? '50%' : (locale === 'ar' ? '0' : 'auto'),
                                    right: isMobile ? 'auto' : (locale === 'ar' ? 'auto' : '0'),
                                    transform: isMobile ? 'translate(-50%, -50%)' : 'none',
                                    width: isMobile ? 'min(calc(100vw - 3rem), 400px)' : '320px',
                                    maxHeight: isMobile ? 'calc(100vh - 4rem)' : 'auto',
                                    overflowY: isMobile ? 'auto' : 'visible',
                                    backgroundColor: '#ffffff',
                                    borderRadius: '1.25rem',
                                    padding: '1.5rem',
                                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                                    border: '1px solid #e2e8f0',
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
                                        <div style={{ paddingBottom: '1.25rem', borderBottom: '1px solid #f1f5f9' }}>
                                            <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: '800', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>{t('sort_by')}</label>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                                                <div style={{ position: 'relative', flex: 1 }}>
                                                    <select
                                                        value={sortBy}
                                                        onChange={(e) => onSortChange(e.target.value, sortOrder || 'asc')}
                                                        className="input"
                                                        style={{
                                                            width: '100%',
                                                            padding: locale === 'ar' ? '0 0.75rem 0 2.25rem' : '0 2.25rem 0 0.75rem',
                                                            borderRadius: '1.25rem',
                                                            fontSize: '0.9rem',
                                                            backgroundColor: 'white',
                                                            border: '1px solid #e2e8f0',
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
                                                    <div style={{ position: 'absolute', [locale === 'ar' ? 'left' : 'right']: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M6 9l6 6 6-6"></path>
                                                        </svg>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => onSortChange(sortBy || '', sortOrder === 'asc' ? 'desc' : 'asc')}
                                                    style={{
                                                        height: '48px',
                                                        width: '48px',
                                                        borderRadius: '1.25rem',
                                                        border: '1px solid #e2e8f0',
                                                        background: 'white',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: '#475569'
                                                    }}
                                                >
                                                    {sortOrder === 'asc' ? '↑' : '↓'}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {!hideEmployeeFilter && (
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{t('filter_by_employee')}</label>
                                            <SearchableSelect
                                                options={employees.map(emp => ({
                                                    label: `${emp.firstName} ${emp.lastName}`,
                                                    value: emp.id,
                                                    subLabel: t(getRoleKey(emp.role) as any)
                                                }))}
                                                value={localEmployeeId}
                                                onChange={setLocalEmployeeId}
                                                placeholder={t('placeholder_all_employees')}
                                            />
                                        </div>
                                    )}

                                    {showRoleFilter && onRoleChange && (
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{t('role_label' as any) || 'Role'}</label>
                                            <div style={{ position: 'relative' }}>
                                                <select
                                                    value={localRole}
                                                    onChange={(e) => setLocalRole(e.target.value)}
                                                    className="input"
                                                    style={{
                                                        width: '100%',
                                                        padding: locale === 'ar' ? '0 0.75rem 0 2.25rem' : '0 2.25rem 0 0.75rem',
                                                        borderRadius: '1.25rem',
                                                        background: 'white',
                                                        border: '1px solid #e2e8f0',
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
                                                <div style={{ position: 'absolute', [locale === 'ar' ? 'left' : 'right']: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M6 9l6 6 6-6"></path>
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {showCompanyFilter && companyOptions && (
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{t('company_label')}</label>
                                            <div style={{ position: 'relative' }}>
                                                <select
                                                    value={localCompanyId}
                                                    onChange={(e) => setLocalCompanyId(e.target.value)}
                                                    className="input"
                                                    style={{
                                                        width: '100%',
                                                        padding: locale === 'ar' ? '0 0.75rem 0 2.25rem' : '0 2.25rem 0 0.75rem',
                                                        borderRadius: '1.25rem',
                                                        background: 'white',
                                                        border: '1px solid #e2e8f0',
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
                                                <div style={{ position: 'absolute', [locale === 'ar' ? 'left' : 'right']: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>
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
                                                <select
                                                    value={localStatus}
                                                    onChange={(e) => setLocalStatus(e.target.value)}
                                                    className="input"
                                                    style={{
                                                        width: '100%',
                                                        padding: locale === 'ar' ? '0 0.75rem 0 2.25rem' : '0 2.25rem 0 0.75rem',
                                                        borderRadius: '1.25rem',
                                                        background: 'white',
                                                        border: '1px solid #e2e8f0',
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
                                                    {statusOptions ? (
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
                                                <div style={{ position: 'absolute', [locale === 'ar' ? 'left' : 'right']: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>
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
                                                border: '1px solid #e2e8f0',
                                                background: 'white',
                                                fontWeight: '700',
                                                cursor: 'pointer',
                                                fontSize: '0.875rem',
                                                color: '#64748b',
                                                transition: 'all 0.2s ease'
                                            }}
                                            onMouseOver={(e) => e.currentTarget.style.background = '#f8fafc'}
                                            onMouseOut={(e) => e.currentTarget.style.background = 'white'}
                                        >
                                            {t('reset_filters' as any) || 'Reset'}
                                        </button>
                                        <button
                                            onClick={handleApplyFilters}
                                            style={{
                                                flex: 1,
                                                height: '48px',
                                                borderRadius: '1.25rem',
                                                border: 'none',
                                                background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                                                color: 'white',
                                                fontWeight: '700',
                                                cursor: 'pointer',
                                                fontSize: '0.875rem',
                                                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)'
                                            }}
                                        >
                                            {t('show_results' as any) || 'Apply'}
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}


                {/* Statistics Box */}
                <div style={{
                    height: '48px',
                    padding: '0 1.25rem',
                    background: '#0f172a',
                    borderRadius: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    color: 'white'
                }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: '800', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('total_label')}</span>
                    <span style={{ fontSize: '1.25rem', fontWeight: '900' }}>{totalCount}</span>
                </div>

                {/* Primary Action Integration */}
                {primaryAction && (
                    <div style={{ marginLeft: locale === 'ar' ? '0' : 'auto', marginRight: locale === 'ar' ? 'auto' : '0' }}>
                        {primaryAction}
                    </div>
                )}
            </div>

            {/* Total Cost Badge - Below if present */}
            {totalCost !== undefined && (
                <div style={{ display: 'flex', justifyContent: locale === 'ar' ? 'flex-end' : 'flex-end', marginTop: '-0.5rem' }}>
                    <div style={{
                        background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)',
                        color: '#9a3412',
                        padding: '0.5rem 1.25rem',
                        borderRadius: '1rem',
                        border: '1px solid #fed7aa',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        boxShadow: '0 2px 4px rgba(251, 146, 60, 0.05)'
                    }}>
                        <div style={{ background: '#fb923c', color: 'white', padding: '0.25rem', borderRadius: '0.5rem', display: 'flex' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="1" x2="12" y2="23"></line>
                                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                            </svg>
                        </div>
                        <span style={{ fontSize: '0.7rem', fontWeight: '800', opacity: 0.8, textTransform: 'uppercase' }}>{t('total_cost')}:</span>
                        <span style={{ fontSize: '1.125rem', fontWeight: '900' }}>
                            {totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span style={{ fontSize: '0.75rem' }}>{locale === 'ar' ? 'ج.م' : 'EGP'}</span>
                        </span>
                    </div>
                </div>
            )}
        </div>
    )
}
