
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    const users = await prisma.user.findMany({ select: { id: true, email: true, company: { select: { name: true } } } })
    console.log('Users with Companies:')
    users.forEach(u => console.log(`${u.email}: ${u.company?.name || 'No Company'}`))

    // Auto-assign existing users to 'SHSD' if null?
    if (users.length > 0) {
        const shsd = await prisma.company.findUnique({ where: { name: 'SHSD' } })
        if (shsd) {
            const unassigned = users.filter(u => !u.company)
            if (unassigned.length > 0) {
                console.log(`Assigning ${unassigned.length} users to SHSD...`)
                await prisma.user.updateMany({
                    where: { companyId: null },
                    data: { companyId: shsd.id }
                })
                console.log('Done.')
            }
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
