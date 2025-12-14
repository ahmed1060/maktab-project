
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
            const newAdmin = await prisma.superAdmin.create({
                data: {
                    email: user.email,
                    password: user.password,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    avatar: user.avatar,
                    gender: user.gender,
                    createdAt: user.lastActivity
                }
            })
            console.log(`Migrated ${user.email} -> New ID: ${newAdmin.id}`)

            // 1. Handle AuditLogs
            // Update logs to point to the new SuperAdmin ID and unlink from User
            const updatedLogs = await prisma.auditLog.updateMany({
                where: { userId: user.id },
                data: {
                    userId: null,
                    superAdminId: newAdmin.id
                }
            })
            console.log(`Updated ${updatedLogs.count} AuditLogs`)
        } else {
            console.log(`SuperAdmin already exists for ${user.email}`)
        }

        // Handle other dependencies before deletion (even if SuperAdmin existed locally, we might need to clean up User)
        // If "exists" was true, we don't have the newAdmin ID easily unless we fetch it, but usually we just want to clean up the User.
        // For safety, let's assume we proceed to cleanup. 

        // 2. Unlink Created Tasks (Set createdBy to null)
        await prisma.task.updateMany({
            where: { createdBy: user.id },
            data: { createdBy: null }
        })

        // 3. Delete Assigned Tasks (Super Admins shouldn't have tasks usually)
        await prisma.task.deleteMany({
            where: { assigneeId: user.id }
        })

        // 4. Delete Notifications
        await prisma.notification.deleteMany({
            where: { userId: user.id }
        })

        // 5. Delete Obligations
        await prisma.obligation.deleteMany({
            where: { assigneeId: user.id }
        })

        // 6. Delete Salary Records
        await prisma.salaryRecord.deleteMany({
            where: { userId: user.id }
        })

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
