/** Up to two initials, from the first two words of a name, in whatever script it's written. */
export function initials(name: string): string {
    return name.trim().split(/\s+/).slice(0, 2).map(w => Array.from(w)[0] ?? '').join('').toUpperCase()
}

/** A person's initials in a circle. Always beside their name, so it's hidden from screen readers. */
export function Avatar({ name }: { name: string }) {
    return <span className="ui-avatar" aria-hidden="true">{initials(name)}</span>
}

/** A person, or the first of several with how many more. */
export function Person({ names, moreLabel }: { names: string[]; moreLabel?: (n: number) => string }) {
    if (names.length === 0) return null
    const more = names.length - 1
    return (
        <span className="ui-person">
            <Avatar name={names[0]} />
            <span>{names[0]}</span>
            {more > 0 && <span className="ui-person-more">{moreLabel ? moreLabel(more) : `+${more}`}</span>}
        </span>
    )
}
