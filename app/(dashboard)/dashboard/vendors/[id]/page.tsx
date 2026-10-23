import { redirect } from 'next/navigation'

/** A client's page at its old address (see ../page.tsx). */
export default async function MovedPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    redirect(`/dashboard/clients/${encodeURIComponent(id)}`)
}
