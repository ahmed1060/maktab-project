import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { RecordService } from '@/lib/services/record.service'

/**
 * A record's own address, for the link in its reminder: it opens on its
 * client's page. Kept apart from that page's address, which changes when
 * vendors become clients (CLIENTS_PLAN.md §0.1), so a reminder sent before
 * then still opens.
 */
export default async function RecordLink({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user) redirect('/login')
    let vendorId: string
    try {
        vendorId = (await RecordService.get(session as any, id)).client.id
    } catch {
        // Gone, another company's, or not theirs to see: the same answer.
        notFound()
    }
    redirect(`/dashboard/vendors/${vendorId}?record=${encodeURIComponent(id)}`)
}
