
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    // Find all users with role 'SUPER_ADMIN'
    const superAdminUsers = await prisma.user.findMany({
        where: { role: 'SUPER_ADMIN' }
    })

    console.log(`Found ${superAdminUsers.length} Super Admins to migrate.`)

    for (const user of superAdminUsers) {
        // Check if already exists in SuperAdmin to avoid dupes (by email)
        const exists = await prisma.superAdmin.findUnique({
            where: { email: user.email }
        })

        if (!exists) {
            await prisma.superAdmin.create({
                data: {
                    // id: user.id, // Better to let it generate a new UUID or keep same? 
                    // Keeping same ID is risky if UUIDs clash or if we want clean separation. 
                    // Let's generate new ID to ensure no PK conflicts if tables were somehow merged later, 
                    // BUT preserving ID is better for relations if we had them. 
                    // Since we are decoupling, new ID is fine, but I'll try to keep other data.
                    email: user.email,
                    password: user.password, // Keep hashed password
                    firstName: user.firstName,
                    lastName: user.lastName,
                    avatar: user.avatar,
                    gender: user.gender,
                    createdAt: user.lastActivity // Approximation or keep current
                }
            })
            console.log(`Migrated ${user.email}`)
        }

        // Delete from User table
        await prisma.user.delete({
            where: { id: user.id }
        })
        console.log(`Deleted ${user.email} from User table`)
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
