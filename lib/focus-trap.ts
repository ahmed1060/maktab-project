/**
 * Keeping Tab inside an open dialog (WCAG 2.4.3, Focus Order). Tab from the
 * last focusable element goes to the first, and Shift+Tab from the first to
 * the last, so focus never walks into the page behind, which a user can't
 * see while the dialog is up.
 */

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]'

type Focusable = { tabIndex: number; focus: () => void; hasAttribute: (name: string) => boolean; getAttribute: (name: string) => string | null; disabled?: boolean; type?: string }
type Container = { querySelectorAll: (selector: string) => ArrayLike<unknown> }

/** The elements in `container` that Tab can reach, in order. */
export function focusables(container: Container): Focusable[] {
    return Array.from(container.querySelectorAll(FOCUSABLE) as ArrayLike<Focusable>).filter(el =>
        !el.disabled && el.tabIndex >= 0 && el.type !== 'hidden' && !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true')
}

/**
 * Call from a dialog's keydown. Returns true when it moved focus (and so
 * stopped the browser's own Tab), false otherwise.
 */
export function trapTab(
    e: { key: string; shiftKey: boolean; preventDefault: () => void },
    container: Container | null,
    active: unknown,
): boolean {
    if (e.key !== 'Tab' || !container) return false
    const items = focusables(container)
    if (items.length === 0) { e.preventDefault(); return true }
    const first = items[0], last = items[items.length - 1]
    const inside = items.includes(active as Focusable)
    if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); return true }
    if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); return true }
    return false
}

/**
 * A dialog's keydown: Escape closes it, Tab stays inside. Only for keys
 * pressed inside it: a key in a pop-up opened from it (a date picker, or a
 * confirmation drawn elsewhere on the page) also reaches it through React,
 * and handling that one too would pull focus back out of the pop-up.
 * Returns what it did.
 */
export function dialogKeyDown(
    e: { key: string; shiftKey: boolean; target: unknown; preventDefault: () => void; stopPropagation: () => void },
    panel: (Container & { contains: (node: never) => boolean }) | null,
    active: unknown,
    close: (() => void) | undefined,
): 'closed' | 'trapped' | 'ignored' {
    if (!panel || !panel.contains(e.target as never)) return 'ignored'
    if (e.key === 'Escape' && close) {
        e.stopPropagation()
        close()
        return 'closed'
    }
    return trapTab(e, panel, active) ? 'trapped' : 'ignored'
}
