const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/

/**
 * Up to two initials, from the first two words of a name, in whatever script
 * it's written. Arabic letters side by side join into a word (م and ع make
 * «مع», "with"), so they're kept apart by a zero-width non-joiner.
 */
export function initials(name: string): string {
    const letters = name.trim().split(/\s+/).slice(0, 2).map(w => Array.from(w)[0] ?? '')
    return ARABIC.test(letters.join('')) ? letters.join('\u200C') : letters.join('').toUpperCase()
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
