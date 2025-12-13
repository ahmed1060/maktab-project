import { PrismaClient } from '@prisma/client'
import fs from 'fs'

const prisma = new PrismaClient()

async function main() {
    const users = await prisma.user.findMany({
        include: {
            company: true
        }
    })

    fs.writeFileSync('users_export.json', JSON.stringify(users, null, 2))
    console.log('Done writing users_export.json')
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect())
