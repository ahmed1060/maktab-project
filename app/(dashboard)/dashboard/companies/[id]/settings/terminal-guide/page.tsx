import TerminalGuidePage from '@/components/TerminalGuidePage'

/**
 * How to set up a fingerprint terminal, for the Super Admin, for one company
 * (ATTENDANCE_PLAN.md §17.7; DESIGN.md §5.5, A guide's page; PR 356), opened
 * from the round "i" on its Fingerprint terminals.
 */
export default async function SuperAdminTerminalGuidePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return <TerminalGuidePage companyId={id} />
}
