import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import ObligationsClient from "./ObligationsClient"

export default async function ObligationsPage({ searchParams }: { searchParams: { company?: string } }) {
    const session = await getServerSession(authOptions)
    const role = (session?.user as any)?.role

    let companyId: string | undefined = undefined
    if (searchParams.company) {
        const comp = await prisma.company.findUnique({ where: { name: searchParams.company } })
        if (comp) companyId = comp.id
    }

    const whereClause: any = {}
    const userCompanyId = (session?.user as any)?.companyId

    if (role === 'EMPLOYEE') {
        whereClause.assigneeId = (session?.user as any)?.id
    } else if (['ADMIN', 'TEAM_LEADER'].includes(role)) {
        // Strict isolation for Admin/Team Leader: Must match their company
        if (!userCompanyId) {
            // Unassigned Admins see nothing
            const obligations: any[] = []
            return <ObligationsClient obligations={obligations} role={role} />
        }
        whereClause.assignee = { companyId: userCompanyId }
    } else if (role === 'SUPER_ADMIN') {
        // Super Admin can filter by company or see everything
        if (companyId) {
            whereClause.assignee = { companyId }
        }
    }

    const obligations = await prisma.obligation.findMany({
        where: whereClause,
        include: { assignee: { select: { firstName: true, lastName: true } } },
        orderBy: { deadline: 'asc' }
    })


    return <ObligationsClient obligations={obligations} role={role} />
}
