import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import ObligationsClient from "./ObligationsClient"

export default async function ObligationsPage({ searchParams }: { searchParams: { companyId?: string } }) {
    const session = await getServerSession(authOptions)
    const role = (session?.user as any)?.role
    const companyId = searchParams.companyId

    let whereClause: any = {}

    if (role === 'EMPLOYEE') {
        whereClause.assigneeId = (session?.user as any)?.id
    } else {
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
