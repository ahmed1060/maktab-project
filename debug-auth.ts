import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"

async function main() {
    const credentials = {
        email: "admin@example.com",
        password: "admin123"
    }

    console.log("\n=== Testing Database Connection ===")

    // Test 1: Can we connect to database?
    try {
        const user = await prisma.user.findUnique({
            where: { email: credentials.email }
        })
        console.log("✓ Database connection works")
        console.log("✓ User found:", user ? `${user.firstName} ${user.lastName}` : "NOT FOUND")

        if (user) {
            // Test 2: Password comparison
            const isValid = await bcrypt.compare(credentials.password, user.password)
            console.log("✓ Password valid:", isValid)

            if (!isValid) {
                console.log("\n❌ Password hashes don't match!")
                console.log("Stored hash:", user.password.substring(0, 20) + "...")
                console.log("Testing password:", credentials.password)
            }
        }
    } catch (error) {
        console.error("❌ Database error:", error)
    }

    console.log("\n=== Testing NextAuth Provider ===")

    // Test 3: NextAuth authorize function
    const provider = authOptions.providers.find(p => p.id === 'credentials')

    if (provider && provider.type === 'credentials') {
        try {
            // @ts-ignore
            const result = await provider.authorize(credentials)
            console.log("✓ Authorize result:", result ? `Logged in as ${result.email}` : "NULL (failed)")

            if (!result) {
                console.log("\n❌ Authorization failed! Check console.error logs above.")
            }
        } catch (error) {
            console.error("❌ Authorize error:", error)
        }
    } else {
        console.log("❌ Credentials provider not found")
    }
}

main().catch(console.error)
