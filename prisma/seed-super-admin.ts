
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
    const email = 'ahmed.hossam1060@gmail.com'
    const exists = await prisma.superAdmin.findUnique({ where: { email } })

    if (!exists) {
        const hashedPassword = await bcrypt.hash('password123', 10) // or logic to prompt/use known password
        // Using a known hash from previous export if possible, otherwise reset.
        // Export showed: $2b$12$SH4d9QJepcUD4BKB4kzr2OpE0mVx1AWAoWZBKJps.PA/3VF3.Wrm.
        // I'll use that hash to preserve login if possible.

        await prisma.superAdmin.create({
            data: {
                email,
                password: '$2b$12$SH4d9QJepcUD4BKB4kzr2OpE0mVx1AWAoWZBKJps.PA/3VF3.Wrm.',
                firstName: 'ahmed',
                lastName: 'hossam',
                gender: 'MALE',
                avatar: null
            }
        })
        console.log('Seeded ahmed.hossam1060@gmail.com')
    } else {
        console.log('Super Admin already exists')
    }

    // Also seed other knowns?
    const email2 = 'mohamedsadek@gmail.com'
    const exists2 = await prisma.superAdmin.findUnique({ where: { email: email2 } })
    if (!exists2) {
        await prisma.superAdmin.create({
            data: {
                email: email2,
                password: '$2b$12$h.p7rLyArMDEZuoqI3PcDOoJAssSQz1rFpYTDCwsTPw8VxakxdQOy',
                firstName: 'mohamed',
                lastName: 'sadek',
                gender: 'MALE'
            }
        })
        console.log('Seeded mohamedsadek@gmail.com')
    }
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
