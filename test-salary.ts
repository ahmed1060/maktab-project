import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('Testing Prisma Client...')
    // @ts-ignore
    if (prisma.salaryRecord) {
        console.log('✅ prisma.salaryRecord exists')
        // @ts-ignore
        const count = await prisma.salaryRecord.count()
        console.log('Count:', count)
    } else {
        console.log('❌ prisma.salaryRecord DOES NOT exist')
        console.log('Keys:', Object.keys(prisma))
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect())
