import Image from 'next/image'

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

/**
 * A person's initials in a circle, or their photo when it's given (the top
 * bar's account button and menu, DESIGN.md §5.1), never a drawing that stands
 * in for them. Always beside their name, so it's hidden from screen readers.
 * 28px across, or 32px or 40px.
 */
export function Avatar({ name, src = null, size }: { name: string; src?: string | null; size?: 32 | 40 }) {
    const across = size ?? 28
    return (
        <span className={size ? `ui-avatar ui-avatar-${size}` : 'ui-avatar'} aria-hidden="true">
            {src ? <Image src={src} alt="" width={across} height={across} /> : initials(name)}
        </span>
    )
}

/**
 * A person's photo, at the top of their profile (DESIGN.md §5.5, A person's
 * photo): their photo filling a circle 96px across, named for screen
 * readers by `alt`, or their initials in an avatar's colours when they have
 * none, which are hidden from them, as the page names them.
 */
export function Photo({ name, src, alt }: { name: string; src: string | null; alt: string }) {
    if (!src) return <span className="ui-photo" aria-hidden="true">{initials(name)}</span>
    return <span className="ui-photo"><Image src={src} alt={alt} width={96} height={96} /></span>
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

/** The first letter of a name, in whatever script it's written: a company's mark without a logo. */
export function firstLetter(name: string): string {
    return (Array.from(name.trim())[0] ?? '').toLocaleUpperCase()
}

/**
 * A company's mark (DESIGN.md §5.1), at the top of the side bar and in its
 * preview on the Branding tab: its logo on its light plate, or else the
 * first letter of its name on a brand tile. Always beside the company's
 * name, so it's hidden from screen readers.
 */
export function CompanyMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
    return (
        <span className="ui-company-mark" aria-hidden="true">
            {logoUrl
                // eslint-disable-next-line @next/next/no-img-element -- next/image would need every company's storage host in next.config, for one small image
                ? <img src={logoUrl} alt="" width={32} height={32} className="ui-logo-plate" />
                : <span className="ui-company-letter">{firstLetter(name)}</span>}
        </span>
    )
}
