import { prisma } from './lib/prisma'

async function checkCosts() {
    console.log('Checking for tasks with costs...')

    const allTasksWithCosts = await prisma.task.findMany({
        where: {
            totalCost: { gt: 0 }
        },
        select: {
            id: true,
            title: true,
            status: true,
            totalCost: true,
            paymentStatus: true
        }
    })

    console.log(`\nFound ${allTasksWithCosts.length} tasks with costs:`)
    allTasksWithCosts.forEach(task => {
        console.log(`- ${task.title}: ${task.totalCost} EGP, Status: ${task.status}, Payment: ${task.paymentStatus}`)
    })

    const pendingPayment = allTasksWithCosts.filter(t =>
        (t.status === 'APPROVED' || t.status === 'COMPLETED') &&
        t.paymentStatus === 'PENDING_PAYMENT'
    )

    console.log(`\n${pendingPayment.length} tasks shown on Costs page (Approved/Completed + Pending Payment)`)
}

checkCosts()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err)
        process.exit(1)
    })
