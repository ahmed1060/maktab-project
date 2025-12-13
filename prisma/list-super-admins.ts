
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    const admins = await prisma.user.findMany({
        where: { role: 'SUPER_ADMIN' },
        select: {
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            status: true,
            company: { select: { name: true } }
        }
    })

    console.log(JSON.stringify(admins, null, 2))
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
