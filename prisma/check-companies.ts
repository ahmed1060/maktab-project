
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    const count = await prisma.company.count()
    console.log(`Total companies: ${count}`)
    if (count > 0) {
        const companies = await prisma.company.findMany()
        console.log(companies)
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
