import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('Start migration...')

    // 1. Create Default Company "مكتب مؤمن"
    const companyName = "مكتب مؤمن"
    let company = await prisma.company.findUnique({
        where: { name: companyName }
    })

    if (!company) {
        console.log(`Creating company: ${companyName}`)
        company = await prisma.company.create({
            data: {
                name: companyName
            }
        })
    } else {
        console.log(`Company already exists: ${companyName}`)
    }

    // 2. Assign all users without a company to this company
    const users = await prisma.user.findMany({
        where: {
            companyId: null
        }
    })

    console.log(`Found ${users.length} users without a company.`)

    for (const user of users) {
        await prisma.user.update({
            where: { id: user.id },
            data: { companyId: company.id }
        })
        console.log(`Assigned user ${user.email} to ${companyName}`)
    }

    console.log('Migration completed.')
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
