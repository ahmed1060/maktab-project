
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
    console.log('Starting data fix for orphaned Tasks and Obligations...')

    // 1. Fix Tasks
    const orphanedTasks = await prisma.task.findMany({
        where: { companyId: null },
        include: { assignees: { select: { id: true, companyId: true }, take: 1 } }
    })

    console.log(`Found ${orphanedTasks.length} orphaned tasks.`)
    for (const task of orphanedTasks) {
        if (task.assignees.length > 0 && task.assignees[0].companyId) {
            await prisma.task.update({
                where: { id: task.id },
                data: { companyId: task.assignees[0].companyId }
            })
            console.log(`Updated Task "${task.title}" with Company ID: ${task.assignees[0].companyId}`)
        }
    }

    // 2. Fix Obligations
    const orphanedObligations = await prisma.obligation.findMany({
        where: { companyId: null },
        include: { assignees: { select: { id: true, companyId: true }, take: 1 } }
    })

    console.log(`Found ${orphanedObligations.length} orphaned obligations.`)
    for (const obl of orphanedObligations) {
        if (obl.assignees.length > 0 && obl.assignees[0].companyId) {
            await prisma.obligation.update({
                where: { id: obl.id },
                data: { companyId: obl.assignees[0].companyId }
            })
            console.log(`Updated Obligation "${obl.title}" with Company ID: ${obl.assignees[0].companyId}`)
        }
    }

    console.log('Data fix complete.')
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
