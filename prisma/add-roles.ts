import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
    try {
        // Add SUPER_ADMIN
        const superAdminEmail = 'superadmin@example.com'
        const existingSuperAdmin = await prisma.user.findUnique({
            where: { email: superAdminEmail }
        })

        if (!existingSuperAdmin) {
            const hashedPassword = await bcrypt.hash('superadmin123', 10)
            const superAdmin = await prisma.user.create({
                data: {
                    email: superAdminEmail,
                    password: hashedPassword,
                    firstName: 'Super',
                    lastName: 'Admin',
                    role: 'SUPER_ADMIN',
                    active: true
                }
            })
            console.log('Created SUPER_ADMIN user:', superAdmin.email)
        } else {
            console.log('SUPER_ADMIN user already exists:', existingSuperAdmin.email)
        }

        // Add TEAM_LEADER
        const teamLeaderEmail = 'teamleader@example.com'
        const existingTeamLeader = await prisma.user.findUnique({
            where: { email: teamLeaderEmail }
        })

        if (!existingTeamLeader) {
            const hashedPassword = await bcrypt.hash('teamleader123', 10)
            const teamLeader = await prisma.user.create({
                data: {
                    email: teamLeaderEmail,
                    password: hashedPassword,
                    firstName: 'Team',
                    lastName: 'Leader',
                    role: 'TEAM_LEADER',
                    active: true
                }
            })
            console.log('Created TEAM_LEADER user:', teamLeader.email)
        } else {
            console.log('TEAM_LEADER user already exists:', existingTeamLeader.email)
        }

        console.log('\n✅ All roles now have users!')
        console.log('\nComplete user list:')
        const allUsers = await prisma.user.findMany({
            select: { email: true, role: true, firstName: true, lastName: true }
        })
        allUsers.forEach(user => {
            console.log(`- ${user.role}: ${user.email} (${user.firstName} ${user.lastName})`)
        })

    } catch (error) {
        console.error('Error adding users:', error)
    } finally {
        await prisma.$disconnect()
    }
}

main()
