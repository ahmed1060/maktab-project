
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    const email = 'lateness_test@company.com'

    // Find the user and task
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) throw new Error("User not found (run previous seed first)")

    const task = await prisma.task.findFirst({
        where: { assigneeId: user.id, title: 'Lateness Penalty Test' }
    })
    if (!task) throw new Error("Task not found")

    console.log(`Testing Submit for Task: ${task.id}`)
    console.log(`Current Deadline: ${task.deadline}`)

    // Simulate the API Logic (We can't call API directly via fetch easily without auth session mock, 
    // so we will REPLICATE the verifying logic or use a mock request if possible, 
    // BUT effectively we want to trigger the exact prisma calls).

    // Actually, easiest way is to use the existing `api/tasks/[id]/submit/route.ts` 
    // but that requires NextRequest and Session. 
    // Instead, I'll copy the CORE logic here to verify it doesn't crash.

    const result = await prisma.$transaction(async (tx) => {
        // 1. Get current task
        const currentTask = await tx.task.findUnique({ where: { id: task.id } })
        if (!currentTask) throw new Error("Task not found")

        let comments: any[] = []
        if (currentTask.comments) comments = JSON.parse(currentTask.comments)

        // ADD LOCATION
        const location = "Test Location via Script"
        comments.push({
            text: `Location: ${location}`,
            location: location,
            author: 'Script Tester',
            date: new Date().toISOString(),
            type: 'LOCATION_ADDED'
        })

        // INJECTED LOGIC START
        console.log("Checking Previous Locations...")
        const previousLocations = comments.filter((c: any) => c.type === 'LOCATION_ADDED')
        console.log(`Count: ${previousLocations.length} (Expected 1)`)

        if (previousLocations.length === 1) {
            const now = new Date()
            const deadline = new Date(currentTask.deadline)

            const isDeadlineDay = now.toDateString() === deadline.toDateString()
            console.log(`Is Deadline Day? ${isDeadlineDay} (${now.toDateString()} vs ${deadline.toDateString()})`)

            if (isDeadlineDay) {
                const currentHour = now.getHours()
                console.log(`Current Hour: ${currentHour}`)
                let penaltyDays = 0

                if (currentHour >= 11) penaltyDays = 1.0
                else if (currentHour >= 10) penaltyDays = 0.5
                else if (currentHour >= 9) penaltyDays = 0.25

                console.log(`Penalty: ${penaltyDays}`)

                if (penaltyDays > 0) {
                    const currentMonth = now.getMonth() + 1
                    const currentYear = now.getFullYear()

                    // Find or Create Salary Record
                    let salaryRecord = await tx.salaryRecord.findUnique({
                        where: { userId_month_year: { userId: user.id, month: currentMonth, year: currentYear } }
                    })

                    if (salaryRecord) {
                        console.log("Updating existing salary record")
                        await tx.salaryRecord.update({
                            where: { id: salaryRecord.id },
                            data: { deductions: { increment: penaltyDays } }
                        })
                    } else {
                        console.log("Creating new salary record")
                        const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
                        await tx.salaryRecord.create({
                            data: {
                                userId: user.id,
                                month: currentMonth,
                                year: currentYear,
                                totalDays: daysInMonth,
                                deductions: penaltyDays,
                                baseSalary: user.salary || 0
                            }
                        })
                    }

                    comments.push({
                        text: `⚠️ Automatic Lateness Penalty: ${penaltyDays} day(s) deducted.`,
                        author: 'System',
                        date: new Date().toISOString(),
                        type: 'SYSTEM_DEDUCTION'
                    })
                }
            }
        }
        // INJECTED LOGIC END

        return "Success"
    })

    console.log("Result:", result)
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect())
