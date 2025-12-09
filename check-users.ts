import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
    const users = await prisma.user.findMany()
    console.log('Users found:', users.length)

    for (const user of users) {
        console.log(`User: ${user.email}, Role: ${user.role}, First: ${user.firstName}, Last: ${user.lastName}`)

        // Test password
        let password = ''
        if (user.role === 'SUPER_ADMIN') password = 'superadmin123'
        else if (user.role === 'ADMIN') password = 'admin123'
        else if (user.role === 'EMPLOYEE') password = '123456'

        if (password) {
            const isValid = await bcrypt.compare(password, user.password)
            console.log(`Password '${password}' valid: ${isValid}`)
        }
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect())
