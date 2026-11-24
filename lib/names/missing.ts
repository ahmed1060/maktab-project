import { prisma } from "@/lib/prisma"
import { ARABIC_LETTERS } from "@/lib/names"

/**
 * Who has a name still missing a language (LATER_CHANGES_PLAN.md §3.1, step 5,
 * PR 405), as lib/names.ts missingLanguages reads one: a first or last name
 * with no Arabic, or whose English column holds Arabic letters or nothing.
 * The database reads the letters, which a Prisma filter can't; in the company
 * asked, or every company where none is (the Super Admin's with none picked).
 * The list adds whatever else it asks to these.
 */
export async function missingNameIds(companyId: string | null | undefined): Promise<string[]> {
    const company = companyId ?? null
    const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "User"
        WHERE (${company}::text IS NULL OR "companyId" = ${company})
          AND (coalesce(btrim("firstNameAr"), '') = '' OR coalesce(btrim("lastNameAr"), '') = ''
               OR btrim("firstName") = '' OR btrim("lastName") = ''
               OR "firstName" ~ ${ARABIC_LETTERS} OR "lastName" ~ ${ARABIC_LETTERS})`
    return rows.map(row => row.id)
}
