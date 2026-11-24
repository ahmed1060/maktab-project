import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import type { TwoLanguages } from '@/lib/names'
import { spellingsOf, type Spelling } from '@/lib/names/spellings'

/**
 * What the company saves teaches it (LATER_CHANGES_PLAN.md §3.1, step 3a,
 * PR 400): a company's spellings, worked out again from its names whenever
 * one is added, changed or deleted, so how many names use each is always
 * what's saved. Kept by where they were saved, as each is read by whoever
 * may see those names (step 3b).
 */

export const SPELLING_SOURCES = ['employee', 'client', 'owner', 'company'] as const
export type SpellingSource = typeof SPELLING_SOURCES[number]

/** A source's names, by whoever holds them, and what kind of name they are. */
async function namesOf(tx: Prisma.TransactionClient, companyId: string, source: SpellingSource): Promise<{ holders: TwoLanguages[][]; kind: 'person' | 'business' }> {
    if (source === 'employee') {
        // A deleted employee's name is no longer here.
        const people = await tx.user.findMany({
            where: { companyId, status: { not: 'DELETED' } },
            select: { firstName: true, lastName: true, firstNameAr: true, lastNameAr: true },
            orderBy: { id: 'asc' },
        })
        return { holders: people.map(p => [{ en: p.firstName, ar: p.firstNameAr }, { en: p.lastName, ar: p.lastNameAr }]), kind: 'person' }
    }
    if (source === 'company') {
        const company = await tx.company.findUnique({ where: { id: companyId }, select: { name: true, nameAr: true } })
        return { holders: company ? [[{ en: company.name, ar: company.nameAr }]] : [], kind: 'business' }
    }
    const clients = await tx.client.findMany({
        where: { companyId },
        select: { name: true, nameAr: true, ownerName: true, ownerNameAr: true },
        orderBy: { id: 'asc' },
    })
    return source === 'client'
        ? { holders: clients.map(c => [{ en: c.name, ar: c.nameAr }]), kind: 'business' }
        : { holders: clients.map(c => [{ en: c.ownerName, ar: c.ownerNameAr }]), kind: 'person' }
}

const keyOf = (spelling: { arKey: string; enKey: string }) => `${spelling.arKey}\u0000${spelling.enKey}`

/**
 * A company's spellings from where they were saved, worked out again from
 * its names: one no name uses any more goes, and each other is written as
 * its names have it. One source at a time, each held for the company while
 * it's worked out, so two saves at once can't leave the older names'.
 */
export async function relearnSpellings(companyId: string, sources: readonly SpellingSource[]): Promise<void> {
    for (const source of sources) {
        await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`name-spellings:${companyId}:${source}`}))::text`
            const { holders, kind } = await namesOf(tx, companyId, source)
            const wanted = new Map<string, Spelling>(spellingsOf(holders, kind).map(spelling => [keyOf(spelling), spelling]))
            // One after another: a transaction has one connection.
            const kept = await tx.nameSpelling.findMany({ where: { companyId, source } })
            const gone = kept.filter(row => !wanted.has(keyOf(row))).map(row => row.id)
            if (gone.length) await tx.nameSpelling.deleteMany({ where: { id: { in: gone } } })
            for (const row of kept) {
                const spelling = wanted.get(keyOf(row))
                if (!spelling) continue
                wanted.delete(keyOf(row))
                if (spelling.uses !== row.uses || spelling.ar !== row.ar || spelling.en !== row.en) {
                    await tx.nameSpelling.update({ where: { id: row.id }, data: { uses: spelling.uses, ar: spelling.ar, en: spelling.en } })
                }
            }
            if (wanted.size) await tx.nameSpelling.createMany({ data: Array.from(wanted.values()).map(spelling => ({ companyId, source, ...spelling })) })
        })
    }
}

/**
 * Learns from a save once it's made, never stopping it: one that couldn't
 * be learned is caught up by the next, which works them all out again.
 */
export async function learnSpellings(companyId: string | null | undefined, sources: readonly SpellingSource[]): Promise<void> {
    if (!companyId) return
    try {
        await relearnSpellings(companyId, sources)
    } catch (error) {
        console.error('[names] the spellings couldn\'t be learned', { companyId, sources, error })
    }
}
