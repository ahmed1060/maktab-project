"use client"

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
}: {
    value: T
    options: Option<T>[]
    onChange: (value: T) => void
    ariaLabel: string
    disabled?: boolean
}) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            style={{
                display: 'inline-flex',
                padding: '0.25rem',
                gap: '0.2rem',
                borderRadius: '999px',
                background: 'rgba(15, 23, 42, 0.06)',
                border: '1px solid rgba(15, 23, 42, 0.08)',
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
                            padding: '0.45rem 0.9rem',
                            borderRadius: '999px',
                            border: 'none',
                            fontSize: '0.85rem',
                            fontWeight: selected ? 700 : 500,
                            // The unselected half stays clearly legible rather
                            // than fading out: it is a choice on offer, not
                            // disabled.
                            color: selected ? 'var(--text-strong)' : 'var(--text-muted)',
                            background: selected ? 'var(--surface)' : 'transparent',
                            boxShadow: selected ? '0 1px 3px rgba(15, 23, 42, 0.12)' : 'none',
                            cursor: disabled ? 'not-allowed' : selected ? 'default' : 'pointer',
                            opacity: disabled ? 0.6 : 1,
                            transition: 'background 0.15s, color 0.15s, box-shadow 0.15s',
                            whiteSpace: 'nowrap',
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
                                background: selected && option.count > 0 ? 'var(--warn-bg)' : 'rgba(15, 23, 42, 0.07)',
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
