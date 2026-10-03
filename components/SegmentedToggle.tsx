"use client"

import { useEffect, useRef } from "react"

type Option<T extends string> = {
    value: T
    label: string
    /** Shown as a pill after the label. Omit rather than passing 0 to hide it. */
    count?: number
}

/**
 * A two-or-more-way toggle where every option is visible and the selected one
 * is marked.
 *
 * Replaces the pattern where one button flips its own label — "Show all" that
 * becomes "Needs attention" when clicked. That shape cannot tell you what is
 * currently selected and what clicking would do at the same time, so the reader
 * has to click it to find out which of the two readings was true.
 */
export default function SegmentedToggle<T extends string>({
    value,
    options,
    onChange,
    ariaLabel,
    disabled = false,
    size = 'md',
    fixedOrder = false,
}: {
    value: T
    options: Option<T>[]
    onChange: (value: T) => void
    ariaLabel: string
    disabled?: boolean
    /** 'sm' for tight places — a dropdown row rather than a page toolbar. */
    size?: 'sm' | 'md'
    /**
     * Keep the options in array order even in an RTL layout.
     *
     * Off by default: a filter belongs to the page and should mirror with it.
     * On for the language picker, which is *about* language rather than in one
     * — it would otherwise swap sides the moment you used it, moving the half
     * you just clicked to the opposite end of the control.
     */
    fixedOrder?: boolean
}) {
    const pad = size === 'sm' ? '0.35rem 0.7rem' : '0.45rem 0.9rem'
    const font = size === 'sm' ? '0.8rem' : '0.85rem'
    // When the track scrolls, keep the chosen option in sight: one opened by
    // its address can otherwise start out of view.
    const track = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const box = track.current
        const chosen = box?.querySelector<HTMLElement>('[aria-pressed="true"]')
        if (!box || !chosen || box.scrollWidth <= box.clientWidth) return
        const b = box.getBoundingClientRect(), c = chosen.getBoundingClientRect()
        if (c.left < b.left) box.scrollBy({ left: c.left - b.left - 8 })
        else if (c.right > b.right) box.scrollBy({ left: c.right - b.right + 8 })
    }, [value])
    return (
        <div
            ref={track}
            role="group"
            aria-label={ariaLabel}
            style={{
                display: 'inline-flex',
                // Never wider than the space it is in. With more options than
                // fit — the settings tabs on a phone — the track scrolls
                // sideways by itself, rather than widening the whole page.
                maxWidth: '100%',
                overflowX: 'auto',
                scrollbarWidth: 'thin',
                padding: '0.25rem',
                gap: '0.2rem',
                borderRadius: '999px',
                background: 'color-mix(in srgb, var(--text-strong) 6%, transparent)',
                border: '1px solid color-mix(in srgb, var(--text-strong) 8%, transparent)',
                ...(fixedOrder ? { direction: 'ltr' as const } : {}),
            }}
        >
            {options.map(option => {
                const selected = option.value === value
                return (
                    <button
                        key={option.value}
                        type="button"
                        // Announced as a selection, not just styled as one — the
                        // white pill means nothing without sight.
                        aria-pressed={selected}
                        disabled={disabled}
                        onClick={() => !selected && onChange(option.value)}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            padding: pad,
                            borderRadius: '999px',
                            border: 'none',
                            fontSize: font,
                            fontWeight: selected ? 700 : 500,
                            // The unselected half stays clearly legible rather
                            // than fading out: it is a choice on offer, not
                            // disabled.
                            color: selected ? 'var(--text-strong)' : 'var(--text-muted)',
                            // Raised above the track in both themes. --surface
                            // is the panel behind the toggle on dark, so using
                            // it made the selected half a hole rather than a
                            // pill; and a shadow mixed from --text-strong is a
                            // white halo once --text-strong is near-white.
                            background: selected ? 'var(--segment-raised)' : 'transparent',
                            boxShadow: selected ? '0 1px 3px var(--segment-raised-shadow)' : 'none',
                            cursor: disabled ? 'not-allowed' : selected ? 'default' : 'pointer',
                            opacity: disabled ? 0.6 : 1,
                            transition: 'background 0.15s, color 0.15s, box-shadow 0.15s',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                        }}
                    >
                        {option.label}
                        {typeof option.count === 'number' && (
                            <span style={{
                                padding: '0.05rem 0.4rem',
                                borderRadius: '999px',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                // Amber only when the selected filter has
                                // something in it. An amber zero pulls the eye
                                // every morning and teaches you to stop looking.
                                background: selected && option.count > 0 ? 'var(--warn-bg)' : 'color-mix(in srgb, var(--text-strong) 7%, transparent)',
                                color: selected && option.count > 0 ? 'var(--warn-fg)' : 'var(--text-soft)',
                            }}>
                                {option.count}
                            </span>
                        )}
                    </button>
                )
            })}
        </div>
    )
}
