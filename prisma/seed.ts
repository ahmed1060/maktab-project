import { createScriptClient } from "../lib/prisma-script"
import bcrypt from 'bcryptjs'

const prisma = createScriptClient()

// Seed credentials must come from the environment. This used to hardcode
// ahmed.hossam1060@gmail.com / mohamedsadek@gmail.com with the password
// "12345678" directly in this file — and print both in README.md /
// DATABASE_SETUP.md — so anyone with read access to the repo (or its
// history) had two live super-admin passwords. Set SEED_ADMIN_EMAIL_1 /
// SEED_ADMIN_PASSWORD_1 (and optionally _2 for a second account) before
// running this script; it refuses to run without at least one.
type SeedAdmin = {
    email: string
    username: string
    firstName: string
    lastName: string
    password: string
    gender: string
}

function readAdmin(n: 1 | 2): SeedAdmin | null {
    const email = process.env[`SEED_ADMIN_EMAIL_${n}`]
    const password = process.env[`SEED_ADMIN_PASSWORD_${n}`]
    if (!email || !password) return null

    if (password.length < 12) {
        throw new Error(`SEED_ADMIN_PASSWORD_${n} must be at least 12 characters`)
    }

    return {
        email,
        username: process.env[`SEED_ADMIN_USERNAME_${n}`] || email.split('@')[0],
        firstName: process.env[`SEED_ADMIN_FIRST_NAME_${n}`] || 'Super',
        lastName: process.env[`SEED_ADMIN_LAST_NAME_${n}`] || 'Admin',
        password,
        gender: process.env[`SEED_ADMIN_GENDER_${n}`] || 'MALE',
    }
}

async function main() {
    console.log('🌱 Seeding database...')

    const superAdmins = [readAdmin(1), readAdmin(2)].filter((a): a is SeedAdmin => a !== null)

    if (superAdmins.length === 0) {
        throw new Error(
            'No seed admin configured. Set SEED_ADMIN_EMAIL_1 and SEED_ADMIN_PASSWORD_1 ' +
            '(and optionally _2 for a second account) as environment variables before running this script.'
        )
    }

    for (const admin of superAdmins) {
        const existingSuperAdmin = await prisma.superAdmin.findUnique({
            where: { email: admin.email }
        })

        if (existingSuperAdmin) {
            console.log(`✅ Super Admin ${admin.email} already exists, skipping creation`)
            continue
        }

        const hashedPassword = await bcrypt.hash(admin.password, 12)

        const created = await prisma.superAdmin.create({
            data: {
                email: admin.email,
                username: admin.username,
                password: hashedPassword,
                firstName: admin.firstName,
                lastName: admin.lastName,
                gender: admin.gender
            }
        })

        console.log(`✅ Super Admin created successfully: ${created.email} (${created.username})`)
    }
}

main()
    .then(async () => {
        await prisma.$disconnect()
        console.log('✅ Seeding completed')
    })
    .catch(async (e) => {
        console.error('❌ Error during seeding:', e)
        await prisma.$disconnect()
        process.exit(1)
    })
