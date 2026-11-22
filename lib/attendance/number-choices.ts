/**
 * Who the "Choose a person" lists on Employee numbers offer (ATTENDANCE_PLAN.md
 * §17.13, PR 366). A number waiting for a person offers nobody who has a number
 * already, nor anybody picked for another waiting number, so nobody is given
 * two by mistake. The form for a number by hand offers everyone, for a second
 * number on purpose: a company whose two terminals number people differently.
 *
 * Whoever matches the numbers may match their own (§14), so nobody is left out
 * for being the one choosing.
 */

/** The people a waiting number offers. */
export function choicesForWaiting<P extends { id: string }>(
    people: readonly P[],
    input: { mapped: readonly { userId: string }[]; picked: Record<string, string>; waiting: readonly string[]; code: string },
): P[] {
    const taken = new Set(input.mapped.map(m => m.userId))
    // Only picks for numbers still waiting: one saved, or matched elsewhere, is gone from the list.
    const elsewhere = new Set(input.waiting.filter(c => c !== input.code).map(c => input.picked[c]).filter(Boolean))
    return people.filter(p => !taken.has(p.id) && !elsewhere.has(p.id))
}

/** Who is picked for a waiting number: nobody, once that person has been given a number since. */
export function pickedFor(code: string, picked: Record<string, string>, mapped: readonly { userId: string }[]): string {
    const id = picked[code] ?? ""
    return id && !mapped.some(m => m.userId === id) ? id : ""
}
