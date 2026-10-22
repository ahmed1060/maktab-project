import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { RecordService } from '@/lib/services/record.service'

/**
 * A record's own address, for the link in its reminder: it opens on its
 * client's page. Kept apart from that page's address, which changed when
 * vendors became clients (CLIENTS_PLAN.md §0.1), so a link sent before then
 * still opens wherever the page is now.
 */
const NOT_THEIRS = new Set(["RECORD_NOT_FOUND", "RECORD_FORBIDDEN"])

export default async function RecordLink({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user) redirect('/login')
    let clientId: string
    try {
        clientId = (await RecordService.get(session as any, id)).client.id
    } catch (error) {
        // Gone, another company's, or not theirs to see: the same answer.
        // Anything else, such as the database being down, is a real error.
        if (error instanceof Error && NOT_THEIRS.has(error.message)) notFound()
        throw error
    }
    redirect(`/dashboard/clients/${clientId}?record=${encodeURIComponent(id)}`)
}
