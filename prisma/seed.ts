import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
    console.log('🌱 Seeding database...')

    // Check if Super Admin already exists
    const existingSuperAdmin = await prisma.superAdmin.findUnique({
        where: { email: 'ahmed.hossam1060@gmail.com' }
    })

    if (existingSuperAdmin) {
        console.log('✅ Super Admin already exists, skipping creation')
        return
    }

    // Create Super Admin
    const hashedPassword = await bcrypt.hash('12345678', 12)

    const superAdmin = await prisma.superAdmin.create({
        data: {
            email: 'ahmed.hossam1060@gmail.com',
            password: hashedPassword,
            firstName: 'Ahmed',
            lastName: 'Hossam',
            gender: 'MALE'
        }
    })

    console.log('✅ Super Admin created successfully!')
    console.log('📧 Email:', superAdmin.email)
    console.log('🔑 Password: 12345678')
    console.log('')
    console.log('⚠️  IMPORTANT: Change the password after first login in production!')
}

main()
    .then(async () => {
        await prisma.$disconnect()
        console.log('✅ Seeding completed')
    })
    .catch(async (e) => {
        console.error('❌ Error during seeding:', e)
        await prisma.$disconnect()
        process.exit(1)
    })
