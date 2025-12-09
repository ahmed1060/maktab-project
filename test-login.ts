import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function testLogin() {
    const email = 'superadmin@example.com'
    const password = 'password123'

    console.log(`Testing login for ${email}...`)

    try {
        const user = await prisma.user.findUnique({ where: { email } })

        if (!user) {
            console.error('❌ User not found!')
            return
        }

        console.log('✅ User found:', user.email)
        console.log('User role:', user.role)
        console.log('User status:', user.status)

        // Check password
        const isValid = await bcrypt.compare(password, user.password)
        console.log(`Password valid: ${isValid ? '✅ YES' : '❌ NO'}`)

        if (isValid) {
            console.log('✅ DB Connection and Password Verification Successful!')
        } else {
            console.error('❌ Password verification failed!')
        }

    } catch (error) {
        console.error('❌ Database error:', error)
    } finally {
        await prisma.$disconnect()
    }
}

testLogin()
