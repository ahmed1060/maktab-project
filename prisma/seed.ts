import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
    console.log('🌱 Seeding database...')

    // List of Super Admins to create
    const superAdmins = [
        {
            email: 'ahmed.hossam1060@gmail.com',
            firstName: 'Ahmed',
            lastName: 'Hossam',
            password: '12345678',
            gender: 'MALE'
        },
        {
            email: 'mohamedsadek@gmail.com',
            firstName: 'Mohamed',
            lastName: 'Sadek',
            password: '12345678',
            gender: 'MALE'
        }
    ]

    for (const admin of superAdmins) {
        const existingSuperAdmin = await prisma.superAdmin.findUnique({
            where: { email: admin.email }
        })

        if (existingSuperAdmin) {
            console.log(`✅ Super Admin ${admin.email} already exists, skipping creation`)
            continue
        }

        const hashedPassword = await bcrypt.hash(admin.password, 12)

        const created = await prisma.superAdmin.create({
            data: {
                email: admin.email,
                password: hashedPassword,
                firstName: admin.firstName,
                lastName: admin.lastName,
                gender: 'MALE'
            }
        })

        console.log(`✅ Super Admin created successfully: ${created.email}`)
    }
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
