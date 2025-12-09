import { prisma } from './lib/prisma'

async function checkUserRole() {
    // Get the first user (assuming it's you for testing)
    const users = await prisma.user.findMany({
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true
        }
    })

    console.log('\n=== ALL USERS AND THEIR ROLES ===\n')
    users.forEach(user => {
        console.log(`${user.firstName} ${user.lastName} (${user.email})`)
        console.log(`  Role: ${user.role}`)

        if (['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
            console.log('  ✅ Can see "Mark All as Paid" button')
        } else {
            console.log('  ❌ CANNOT see "Mark All as Paid" button (not admin)')
        }
        console.log('')
    })
}

checkUserRole()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err)
        process.exit(1)
    })
