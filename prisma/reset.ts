import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('🗑️  Resetting database...')

    // Delete all data in order (child tables first)
    console.log('Deleting audit logs...')
    await prisma.auditLog.deleteMany()

    console.log('Deleting notifications...')
    await prisma.notification.deleteMany()

    console.log('Deleting obligations...')
    await prisma.obligation.deleteMany()

    console.log('Deleting tasks...')
    await prisma.task.deleteMany()

    console.log('Deleting users...')
    await prisma.user.deleteMany()

    console.log('✅ Database cleared!\n')
    console.log('Now run: npm run seed')
    console.log('To create fresh test users.')
}

main()
    .catch((e) => {
        console.error('Error resetting database:', e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
