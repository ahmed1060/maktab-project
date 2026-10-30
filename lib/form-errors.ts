/**
 * The first field, in a form's order, that has an error; none when nothing's
 * wrong. A form puts the focus there on submit (DESIGN.md §5.3), so it's the
 * first one wrong as the form reads, whatever order the errors were found in.
 */
export function firstError(errors: Record<string, string>, order: readonly string[]): string | null {
    return order.find(field => errors[field]) ?? Object.keys(errors).find(field => errors[field]) ?? null
}
