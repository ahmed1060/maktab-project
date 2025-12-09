import { prisma } from './lib/prisma'

async function checkVisibleCosts() {
    const tasks = await prisma.task.findMany({
        where: {
            AND: [
                {
                    OR: [
                        { status: 'APPROVED' },
                        { status: 'COMPLETED' }
                    ]
                },
                {
                    totalCost: {
                        gt: 0
                    }
                },
                {
                    paymentStatus: 'PENDING_PAYMENT'
                }
            ]
        },
        select: {
            id: true,
            title: true,
            status: true,
            totalCost: true,
            paymentStatus: true
        }
    })

    console.log(`\n=== COSTS PAGE QUERY ===`)
    console.log(`Tasks that SHOULD appear on Costs page: ${tasks.length}`)

    if (tasks.length === 0) {
        console.log('\n❌ NO TASKS TO DISPLAY!')
        console.log('This is why you don\'t see the button.')
        console.log('\nTo see the button, you need tasks that are:')
        console.log('1. Status: APPROVED or COMPLETED')
        console.log('2. totalCost > 0')
        console.log('3. paymentStatus: PENDING_PAYMENT')
    } else {
        console.log('\n✅ These tasks should be visible:')
        tasks.forEach(t => {
            console.log(`  - ${t.title}: ${t.totalCost} EGP`)
        })
        console.log('\n✅ The green "Mark All as Paid" button should be visible!')
    }
}

checkVisibleCosts()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err)
        process.exit(1)
    })
