/**
 * Puts the focus on the first field a form says is wrong, once it says so
 * (DESIGN.md §5.3): a text field, a date's picker (a button) or a group of
 * boxes alike, each a `.ui-field` with its error under it.
 */
export function focusFirstWrong(form: HTMLFormElement | null) {
    requestAnimationFrame(() => {
        const wrong = [...(form?.querySelectorAll<HTMLElement>('.ui-field') ?? [])].find(f => f.querySelector(':scope > .ui-error'))
        // The control marked wrong, where the field says which: a policy band's
        // end, not the band's Remove before it (company settings part 3b).
        const target = wrong?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? wrong?.querySelector<HTMLElement>('input, select, textarea, button')
        target?.focus()
    })
}
