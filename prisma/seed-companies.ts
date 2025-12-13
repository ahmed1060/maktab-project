
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    const companies = ['SHSD', 'Maktab']

    for (const name of companies) {
        const exists = await prisma.company.findUnique({ where: { name } })
        if (!exists) {
            await prisma.company.create({ data: { name } })
            console.log(`Created company: ${name}`)
        } else {
            console.log(`Company exists: ${name}`)
        }
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
