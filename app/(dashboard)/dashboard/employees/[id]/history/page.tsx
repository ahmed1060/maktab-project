'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface SalaryRecord {
    id: string
    month: number
    year: number
    totalDays: number
    deductions: number // Deductions in DAYS
    baseSalary: number
    bonusDays: number // Bonus in DAYS
    createdAt: string
}

interface Employee {
    id: string
    firstName: string
    lastName: string
    salary?: number
}

export default function EmployeeHistoryPage() {
    const params = useParams()
    const router = useRouter()
    const [records, setRecords] = useState<SalaryRecord[]>([])
    const [employee, setEmployee] = useState<Employee | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch Employee Details (Use query param for ID)
                const userRes = await fetch(`/api/users?id=${params.id}`)
                if (userRes.ok) {
                    const userData = await userRes.json()
                    setEmployee(userData)
                }

                // Fetch Salary History
                const historyRes = await fetch(`/api/users/${params.id}/salary-history`)
                if (historyRes.ok) {
                    const historyData = await historyRes.json()
                    setRecords(historyData)
                }
            } catch (error) {
                console.error('Error fetching data:', error)
            } finally {
                setLoading(false)
            }
        }

        if (params.id) {
            fetchData()
        }
    }, [params.id])

    const getMonthName = (month: number) => {
        return new Date(2000, month - 1).toLocaleString('default', { month: 'long' })
    }

    if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>

    return (
        <div>
            <div style={{ marginBottom: '2rem' }}>
                <Link href="/dashboard/employees" style={{ color: '#64748b', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    ← Back to Employees
                </Link>
                <h1>Salary History</h1>
                {employee && (
                    <div style={{ fontSize: '1.2rem', color: '#475569' }}>
                        <p style={{ margin: 0 }}>For: <strong>{employee.firstName} {employee.lastName}</strong></p>
                        {employee.salary !== undefined && (
                            <p style={{ margin: '0.25rem 0 0 0', fontSize: '1rem' }}>Current Base Salary: <strong>{employee.salary} EGP</strong></p>
                        )}
                    </div>
                )}
            </div>

            <div className="card">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                            <th style={{ padding: '1rem', textAlign: 'left' }}>Month/Year</th>
                            <th style={{ padding: '1rem', textAlign: 'left' }}>Base Salary</th>
                            <th style={{ padding: '1rem', textAlign: 'left' }}>Values (Net / Total)</th>
                            <th style={{ padding: '1rem', textAlign: 'left' }}>Deduction Days</th>
                            <th style={{ padding: '1rem', textAlign: 'left' }}>Bonus Days</th>
                            <th style={{ padding: '1rem', textAlign: 'left' }}>Calculated Salary</th>
                            <th style={{ padding: '1rem', textAlign: 'left' }}>Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {records.length === 0 ? (
                            <tr>
                                <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                                    No records found.
                                </td>
                            </tr>
                        ) : (
                            records.map(record => {
                                // Net Days = Total - Deductions
                                const netDays = record.totalDays - record.deductions
                                const fractionDisplay = netDays % 1 !== 0 ? netDays.toFixed(2) : netDays

                                // Calculate Salary: (Base / Total) * (Total - Deductions + BonusDays)
                                // Effectively: (Base / Total) * (NetDays + BonusDays)

                                const baseSalaryToUse = record.baseSalary || employee?.salary || 0
                                let calculatedSalary = 0

                                const totalPayableDays = netDays + (record.bonusDays || 0)

                                if (baseSalaryToUse > 0 && record.totalDays > 0) {
                                    calculatedSalary = (baseSalaryToUse / record.totalDays) * totalPayableDays
                                }

                                const formattedCalculated = new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(calculatedSalary)
                                const formattedBase = new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(baseSalaryToUse)

                                return (
                                    <tr key={record.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                        <td style={{ padding: '1rem', fontWeight: '500' }}>
                                            {getMonthName(record.month)} {record.year}
                                        </td>
                                        <td style={{ padding: '1rem', color: '#475569' }}>
                                            {formattedBase}
                                        </td>
                                        <td style={{ padding: '1rem', fontSize: '1.1rem', color: '#0f172a' }}>
                                            <span style={{ fontWeight: 'bold' }}>{fractionDisplay}</span>
                                            <span style={{ color: '#94a3b8' }}> / {record.totalDays}</span>
                                        </td>
                                        <td style={{ padding: '1rem', color: '#dc2626', fontWeight: '500' }}>
                                            {record.deductions > 0 ? `-${record.deductions} days` : '-'}
                                        </td>
                                        <td style={{ padding: '1rem', color: '#7c3aed', fontWeight: '500' }}>
                                            {record.bonusDays ? `+${record.bonusDays} days` : '-'}
                                        </td>
                                        <td style={{ padding: '1rem', fontWeight: '600', color: '#166534' }}>
                                            {formattedCalculated}
                                        </td>
                                        <td style={{ padding: '1rem', color: '#64748b', fontSize: '0.875rem' }}>
                                            Created: {new Date(record.createdAt).toLocaleDateString()}
                                        </td>
                                    </tr>
                                )
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
