'use client'
import { use } from 'react'
import EmployeeProfileForm from '@/components/EmployeeProfileForm'

export default function EditEmployeePage(props: {
    // Promises since Next 15, for a client page as much as a server one.
    params: Promise<{ id: string }>,
    searchParams: Promise<{ mode?: string }>,
}) {
    // React's use(), not await: this is a client component, and a client
    // component may not be an async function — React has no way to resume one
    // across a re-render, so Next rejects it outright. use() unwraps the same
    // promise from inside an ordinary render instead.
    const params = use(props.params)
    const searchParams = use(props.searchParams)
    const isViewMode = searchParams.mode === 'view'

    return (
        <EmployeeProfileForm
            userId={params.id}
            isViewMode={isViewMode}
        />
    )
}
