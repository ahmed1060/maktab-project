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

/**
 * Puts the focus back on a control in a form that stays open after a busy
 * action, such as Apply in the template offer dialog: a busy button turns
 * itself off, and the browser drops its focus to the page, where Escape and
 * Tab no longer reach the dialog (the Super Admin's pages part 1). Only when
 * focus was lost, not when the person moved it somewhere.
 */
export function refocusIfLost(form: HTMLFormElement | null, selector: string) {
    const now = document.activeElement
    if (now && now !== document.body) return
    form?.querySelector<HTMLElement>(selector)?.focus()
}
