import fs from 'fs'
import path from 'path'

const filesToFix = [
    'd:/maktab project/app/app/(dashboard)/dashboard/companies/[id]/payments/page.tsx',
    'd:/maktab project/app/app/(dashboard)/dashboard/requests/history/RequestsHistoryClient.tsx',
    'd:/maktab project/app/app/(dashboard)/dashboard/tasks/new/page.tsx',
    'd:/maktab project/app/components/requests/RequestsSection.tsx',
    'd:/maktab project/app/lib/location.ts'
]

filesToFix.forEach(file => {
    if (!fs.existsSync(file)) {
        console.log(`File not found: ${file}`)
        return
    }
    let content = fs.readFileSync(file, 'utf8')

    // Replace catch (error) { with catch {
    content = content.replace(/catch\s*\((error|e)\)\s*\{/g, 'catch {')

    fs.writeFileSync(file, content, 'utf8')
    console.log(`Fixed: ${file}`)
})
