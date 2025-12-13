import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('Start SHSD migration...')

    // 1. Create SHSD Company
    const companyName = "SHSD"
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
        console.log(`Company already exists: ${companyName} (${company.id})`)
    }

    // 2. Assign all SUPER_ADMINS to this company
    const result = await prisma.user.updateMany({
        where: {
            role: 'SUPER_ADMIN'
        },
        data: {
            companyId: company.id
        }
    })

    console.log(`Migrated ${result.count} Super Admins to SHSD.`)
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
