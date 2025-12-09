import { prisma } from './lib/prisma'

async function debugApprovedTasks() {
    const approvedTasks = await prisma.task.findMany({
        where: {
            OR: [
                { status: 'APPROVED' },
                { status: 'COMPLETED' }
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

    console.log(`\n=== APPROVED/COMPLETED TASKS ===`)
    console.log(`Found ${approvedTasks.length} approved/completed tasks:\n`)

    approvedTasks.forEach((task, i) => {
        console.log(`${i + 1}. "${task.title}"`)
        console.log(`   Status: ${task.status}`)
        console.log(`   Total Cost: ${task.totalCost} EGP`)
        console.log(`   Payment Status: ${task.paymentStatus}`)

        // Check why it's not showing
        const reasons = []
        if (task.totalCost <= 0) reasons.push('❌ No cost (totalCost = 0)')
        if (task.paymentStatus === 'PAID') reasons.push('❌ Already marked as PAID')
        if (task.paymentStatus !== 'PENDING_PAYMENT' && task.paymentStatus !== 'PAID') {
            reasons.push(`❌ Invalid payment status: ${task.paymentStatus}`)
        }

        if (reasons.length === 0 && task.totalCost > 0 && task.paymentStatus === 'PENDING_PAYMENT') {
            console.log('   ✅ SHOULD BE VISIBLE ON COSTS PAGE')
        } else {
            console.log(`   ${reasons.join(', ')}`)
        }
        console.log('')
    })
}

debugApprovedTasks()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err)
        process.exit(1)
    })
