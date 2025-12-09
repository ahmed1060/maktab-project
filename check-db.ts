import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkDatabase() {
    try {
        console.log('Checking database connection...')

        // Try to fetch a user
        const users = await prisma.user.findMany({
            take: 1
        })

        console.log('Users found:', users.length)

        if (users.length > 0) {
            console.log('First user:', JSON.stringify(users[0], null, 2))
            console.log('Has gender field:', 'gender' in users[0])
            console.log('Has avatar field:', 'avatar' in users[0])
        }

        // Check schema
        console.log('\nChecking if we can query gender and avatar...')
        const userWithFields = await prisma.user.findFirst({
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                gender: true,
                avatar: true,
                status: true
            }
        })

        console.log('User with fields:', JSON.stringify(userWithFields, null, 2))

    } catch (error) {
        console.error('Database error:', error)
    } finally {
        await prisma.$disconnect()
    }
}

checkDatabase()
