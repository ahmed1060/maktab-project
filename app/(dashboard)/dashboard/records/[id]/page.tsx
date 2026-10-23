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
const NOT_THEIRS = new Set(["RECORD_NOT_FOUND", "RECORD_FORBIDDEN"])

export default async function RecordLink({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user) redirect('/login')
    let vendorId: string
    try {
        vendorId = (await RecordService.get(session as any, id)).client.id
    } catch (error) {
        // Gone, another company's, or not theirs to see: the same answer.
        // Anything else, such as the database being down, is a real error.
        if (error instanceof Error && NOT_THEIRS.has(error.message)) notFound()
        throw error
    }
    redirect(`/dashboard/vendors/${vendorId}?record=${encodeURIComponent(id)}`)
}
