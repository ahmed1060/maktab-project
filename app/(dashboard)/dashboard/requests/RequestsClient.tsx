'use client'
import RequestsSection from '@/components/requests/RequestsSection'

export default function RequestsPage({ userRole }: { userRole: string }) {

    return (
        <div style={{ padding: '0' }}>
            <RequestsSection userRole={userRole} />
        </div>
    )
}
