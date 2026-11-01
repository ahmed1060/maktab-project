/**
 * A link that names the company it's about, `?companyId=`, as a company's
 * attendance settings and a face check's notice do: for the Super Admin, the
 * company to put in view in the top bar (DESIGN.md §5.3), so the page it opens,
 * and the pages after it, are about that company.
 *
 * Only on the pages such links open (LINKED_PAGES). A page that keeps the
 * company in view in its own address, as Requests does, isn't one: when
 * another tab picks a company, that address still names the last one, and
 * taking it for a link wrote it back over the other tab's pick (review on
 * PR 148).
 *
 * None, too, when the link names no company the top bar knows, or the one a
 * pick in the top bar has just left in the address, which would undo the pick.
 *
 * Followed even when its company is in view already: following it takes it out
 * of the address, and left in, the page went on preferring it and put that
 * company back after another tab picked a different one (review on PR 148).
 */
export const LINKED_PAGES = ['/dashboard/attendance']

export function companyLinkToFollow({ pathname, linked, known, leftBehind }: {
    pathname: string
    linked: string | null
    known: string[]
    leftBehind: string | null
}): string | null {
    if (!LINKED_PAGES.includes(pathname)) return null
    if (!linked || linked === leftBehind) return null
    return known.includes(linked) ? linked : null
}

/**
 * The address once the link's company is in view: the top bar's name for it,
 * and no `companyId` left. Left in, the link would undo a pick made in
 * another tab, whose pick reaches this one only for this address to put its
 * own company back in view.
 *
 * With no name, for All companies, it names none.
 */
export function addressWithCompanyInView(current: string, name: string | null): string {
    const next = new URLSearchParams(current)
    next.delete('companyId')
    if (name) next.set('company', name)
    else next.delete('company')
    return next.toString()
}

/**
 * What the top bar does with the company the address names by name,
 * `?company=`, which it keeps there for the company in view, and which a
 * reload, a new tab or a pasted link brings with it.
 *
 * Nothing until the top bar knows its companies, which arrive after the page
 * loads. Deciding before then took the name for handled, so once they came a
 * reload kept the stored company in view under another company's name in the
 * address (seen in the browser while checking PR 148).
 *
 * Then a name it knows puts that company in view, unless it's there already.
 * Any other name, or none, is rewritten to the company in view's, or taken
 * out for All companies. A company in view that the top bar doesn't know
 * counts as All companies, as the switcher shows it.
 */
export type CompanyNameStep =
    | { kind: 'wait' }
    | { kind: 'none' }
    | { kind: 'put-in-view'; id: string }
    | { kind: 'rewrite'; name: string | null }

export function companyNameStep({ named, known, inView }: {
    named: string | null
    known: { id: string; name: string }[]
    inView: string | null
}): CompanyNameStep {
    if (known.length === 0) return { kind: 'wait' }
    const match = known.find(c => c.name === named)
    if (match) return match.id === inView ? { kind: 'none' } : { kind: 'put-in-view', id: match.id }
    const name = known.find(c => c.id === inView)?.name ?? null
    return name === named ? { kind: 'none' } : { kind: 'rewrite', name }
}
