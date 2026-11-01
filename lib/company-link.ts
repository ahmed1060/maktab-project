/**
 * A link that names the company it's about, `?companyId=`, as a company's
 * attendance settings and a face check's notice do: for the Super Admin, the
 * company to put in view in the top bar (DESIGN.md §5.3), so the page it opens,
 * and the pages after it, are about that company.
 *
 * None when the link names no company the top bar knows, or the one already in
 * view, or the one a pick in the top bar has just left in the address: the
 * Requests page keeps the company in view in its own address, and for a moment
 * after a pick it still names the last one. Taking that for a link would undo
 * the pick.
 */
export function companyToPutInView({ linked, inView, known, leftBehind }: {
    linked: string | null
    inView: string | null
    known: string[]
    leftBehind: string | null
}): string | null {
    if (!linked || linked === inView || linked === leftBehind) return null
    return known.includes(linked) ? linked : null
}

/**
 * The address once the link's company is in view: the top bar's name for it,
 * and no `companyId` left. Left in, the link would undo a pick made in
 * another tab, whose pick reaches this one only for this address to put its
 * own company back in view.
 */
export function addressWithCompanyInView(current: string, name: string): string {
    const next = new URLSearchParams(current)
    next.delete('companyId')
    next.set('company', name)
    return next.toString()
}
