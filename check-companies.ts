import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    const companies = await prisma.company.findMany()
    console.log('Companies in DB:', JSON.stringify(companies, null, 2))
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect())
