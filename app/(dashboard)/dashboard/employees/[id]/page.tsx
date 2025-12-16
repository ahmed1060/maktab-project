'use client'
import EmployeeProfileForm from '@/components/EmployeeProfileForm'

export default function EditEmployeePage({ params, searchParams }: { params: { id: string }, searchParams: { mode?: string } }) {
    const isViewMode = searchParams.mode === 'view'

    return (
        <EmployeeProfileForm
            userId={params.id}
            isViewMode={isViewMode}
        />
    )
}
