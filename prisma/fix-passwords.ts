import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
    console.log('🔄 Resetting all user passwords...\n')

    const users = [
        { email: 'superadmin@example.com', password: 'superadmin123', role: 'SUPER_ADMIN' },
        { email: 'admin@example.com', password: 'admin123', role: 'ADMIN' },
        { email: 'teamleader@example.com', password: 'teamleader123', role: 'TEAM_LEADER' },
        { email: 'employee@example.com', password: '123456', role: 'EMPLOYEE' }
    ]

    for (const userData of users) {
        const hashedPassword = await bcrypt.hash(userData.password, 10)

        await prisma.user.update({
            where: { email: userData.email },
            data: { password: hashedPassword }
        })

        // Verify it works
        const user = await prisma.user.findUnique({ where: { email: userData.email } })
        if (user) {
            const isValid = await bcrypt.compare(userData.password, user.password)
            console.log(`${isValid ? '✓' : '✗'} ${userData.role.padEnd(15)} ${userData.email.padEnd(30)} password: ${userData.password}`)
        }
    }

    console.log('\n✅ All passwords reset successfully!')
    await prisma.$disconnect()
}

main()
