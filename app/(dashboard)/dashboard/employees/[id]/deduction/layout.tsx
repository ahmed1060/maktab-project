import { guardModule } from "@/lib/features/guard"

// Adding a deduction is HR's, its route refused without it. Gated at the
// layout, as the modules' own pages are: the directory around it is Core, and
// stays open.
export default async function AddDeductionLayout({ children }: { children: React.ReactNode }) {
    const refused = await guardModule('SALARY_ADJUSTMENTS')
    return refused ?? <>{children}</>
}
