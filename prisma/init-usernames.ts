import { PrismaClient } from '@prisma/client'
import { getInitials } from '../lib/username'

const prisma = new PrismaClient()

async function main() {
    console.log('🚀 Starting username backfill...')

    const users = await prisma.user.findMany({
        where: {
            OR: [
                { username: null },
                { username: '' }
            ]
        },
        include: {
            company: true
        }
    })

    console.log(`Found ${users.length} users without usernames.`)

    for (const user of users) {
        if (!user.companyId || !user.company) {
            console.log(`Skipping user ${user.email} (No company assigned)`)
            continue
        }

        const initials = getInitials(user.company.name) || 'u'

        // Find next available number for this pattern
        let nextNumber = 0
        let newUsername = ''
        let isUnique = false

        while (!isUnique) {
            newUsername = `${initials}${nextNumber}`
            const existing = await prisma.user.findUnique({
                where: { username: newUsername }
            })
            if (!existing) {
                isUnique = true
            } else {
                nextNumber++
            }
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { username: newUsername }
        })

        console.log(`✅ Assigned ${newUsername} to ${user.email}`)
    }

    console.log('🏁 Username backfill completed.')
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })
