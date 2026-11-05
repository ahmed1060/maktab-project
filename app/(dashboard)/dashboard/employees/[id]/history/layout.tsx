import { guardModule } from "@/lib/features/guard"

// An employee's history is HR's: their pay by month, their day off credit and
// their costs, each tab's route refused without it. Gated at the layout, as
// the modules' own pages are, since the page is a Client Component: the
// directory around it is Core, and stays open.
export default async function EmployeeHistoryLayout({ children }: { children: React.ReactNode }) {
    const refused = await guardModule('PAYROLL')
    return refused ?? <>{children}</>
}
