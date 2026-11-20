import { notFound } from 'next/navigation'
import CompanyMessagePage from '@/components/client-messages/CompanyMessagePage'
import { isMessageKind } from '@/lib/client-message-pages'

/**
 * A company's copy of one client message, for the Super Admin, opened from
 * the Client portal tab of the company's settings (CLIENT_PORTAL_PLAN.md
 * §7.1, step 10c-2; PR 349). An address naming no message isn't found.
 */
export default async function SuperAdminCompanyMessagePage({ params }: { params: Promise<{ id: string; kind: string }> }) {
    const { id, kind } = await params
    if (!isMessageKind(kind)) notFound()
    return <CompanyMessagePage kind={kind} companyId={id} />
}
