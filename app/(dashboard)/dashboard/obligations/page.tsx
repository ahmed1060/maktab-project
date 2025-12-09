import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import ObligationsClient from "./ObligationsClient"

export default async function ObligationsPage() {
    const session = await getServerSession(authOptions)
    const role = (session?.user as any)?.role

    const obligations = await prisma.obligation.findMany({
        where: role === 'EMPLOYEE' ? { assigneeId: (session?.user as any)?.id } : {},
        include: { assignee: { select: { firstName: true, lastName: true } } },
        orderBy: { deadline: 'asc' }
    })

    return <ObligationsClient obligations={obligations} role={role} />
}
