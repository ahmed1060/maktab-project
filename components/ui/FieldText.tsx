'use client'

import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { PlusIcon } from '@phosphor-icons/react/ssr'
import { CHIP_CLASS, htmlOfParts, partsOf, textOfNodes } from '@/lib/field-text'
import { Icon } from './Icon'

export type FieldTextField = { key: string; label: string }

/**
 * A text with fields put in by buttons (DESIGN.md §5.5; CLIENT_PORTAL_PLAN.md
 * §7.1, §12 step 10b; PR 347), as the owner's mockup draws it: a box where
 * each field is a chip by its name in the page's language, a button for each
 * field that puts it where the cursor was, and under them what the page says
 * of the text (`foot`) and its buttons (`actions`).
 *
 * The text is kept with its fields in braces (lib/field-text.ts). The box
 * opens with `value` and is the browser's from then on: React leaves what's
 * in it alone, and each change is read back and handed to `onChange`. To
 * start it again from another text, as Discard changes does, give it another
 * key. New lines, pasted text and fields are put in by the box itself, so it
 * holds only words, chips and new lines.
 */
export function FieldText({ label, labelAside, value, onChange, fields, lang, dir, addLabel, error, foot, actions, boxRef }: {
    label: ReactNode
    /** At the label's end, such as a switch between the text's languages. */
    labelAside?: ReactNode
    /** What it opens with, read once. */
    value: string
    onChange: (text: string) => void
    fields: readonly FieldTextField[]
    lang: string
    dir: 'rtl' | 'ltr'
    addLabel: string
    error?: ReactNode
    foot?: ReactNode
    actions?: ReactNode
    /** For the page to move the focus to the box, as to a field with a mistake. */
    boxRef?: Ref<HTMLDivElement>
}) {
    const id = useId()
    const labelId = `${id}-label`, addId = `${id}-add`, errorId = `${id}-error`
    const box = useRef<HTMLDivElement | null>(null)
    // Where the cursor last was in the box, for a field's button pressed from the keyboard.
    const cursor = useRef<Range | null>(null)
    const names = Object.fromEntries(fields.map(f => [f.key, f.label]))
    const [html] = useState(() => htmlOfParts(partsOf(value, fields.map(f => f.key)), field => names[field] ?? field))

    useEffect(() => {
        const keep = () => {
            const selection = document.getSelection()
            const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
            if (range && box.current?.contains(range.commonAncestorContainer)) cursor.current = range.cloneRange()
        }
        document.addEventListener('selectionchange', keep)
        return () => document.removeEventListener('selectionchange', keep)
    }, [])

    useImperativeHandle(boxRef, () => box.current as HTMLDivElement, [])

    /** The line break kept last, where the cursor stands after a last new line or chip. */
    const keepEnd = (el: HTMLDivElement) => {
        const last = el.lastChild
        if (last instanceof HTMLBRElement && last.hasAttribute('data-end')) return
        el.querySelectorAll('br[data-end]').forEach(br => br.remove())
        const end = document.createElement('br')
        end.setAttribute('data-end', '')
        el.appendChild(end)
    }
    const changed = () => {
        const el = box.current
        if (!el) return
        keepEnd(el)
        onChange(textOfNodes(el.childNodes))
    }

    /** Where something goes: where the cursor is or last was in the box, never inside a chip, else at its end. */
    const target = (el: HTMLDivElement): Range => {
        const selection = document.getSelection()
        const live = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
        const inside = (r: Range | null) => !!r && el.contains(r.commonAncestorContainer)
        const range = (inside(live) ? live!.cloneRange() : inside(cursor.current) ? cursor.current!.cloneRange() : null) ?? (() => {
            const end = document.createRange()
            const last = el.lastChild
            if (last instanceof HTMLBRElement && last.hasAttribute('data-end')) end.setStartBefore(last)
            else { end.selectNodeContents(el); end.collapse(false) }
            return end
        })()
        const start = range.startContainer
        const chip = (start instanceof Element ? start : start.parentElement)?.closest(`.${CHIP_CLASS}`)
        if (chip && el.contains(chip)) { range.setStartAfter(chip); range.collapse(true) }
        return range
    }
    const put = (node: Node) => {
        const el = box.current
        if (!el) return
        const range = target(el)
        el.focus({ preventScroll: true })
        range.deleteContents()
        range.insertNode(node)
        range.setStartAfter(node)
        range.collapse(true)
        const selection = document.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        cursor.current = range.cloneRange()
        changed()
    }
    const addField = (field: FieldTextField) => {
        const chip = document.createElement('span')
        chip.className = CHIP_CLASS
        chip.contentEditable = 'false'
        chip.dataset.field = field.key
        chip.textContent = field.label
        put(chip)
    }

    return (
        <div className="ui-fieldtext">
            <div className="ui-fieldtext-head">
                <span id={labelId} className="ui-label" onClick={() => box.current?.focus()}>{label}</span>
                {labelAside}
            </div>
            <div
                ref={box}
                role="textbox"
                aria-multiline="true"
                aria-labelledby={labelId}
                aria-describedby={error ? errorId : undefined}
                aria-invalid={error ? true : undefined}
                contentEditable
                spellCheck
                className="ui-input ui-fieldtext-box"
                lang={lang}
                dir={dir}
                dangerouslySetInnerHTML={{ __html: html }}
                onInput={changed}
                onKeyDown={e => {
                    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                    e.preventDefault()
                    put(document.createTextNode('\n'))
                }}
                onPaste={e => {
                    e.preventDefault()
                    const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
                    if (text) put(document.createTextNode(text))
                }}
                onDrop={e => e.preventDefault()}
            />
            {error && <span id={errorId} className="ui-error">{error}</span>}
            <div role="group" aria-labelledby={addId} className="ui-fieldtext-adds">
                <span id={addId} className="ui-fieldtext-add-label">{addLabel}</span>
                {fields.map(field => (
                    // Pressed with a pointer, the box keeps the focus and its cursor.
                    <button key={field.key} type="button" className="ui-fieldtext-add" data-field={field.key}
                        onMouseDown={e => e.preventDefault()} onClick={() => addField(field)}>
                        <Icon icon={PlusIcon} size={14} />{field.label}
                    </button>
                ))}
            </div>
            {foot && <div className="ui-fieldtext-foot">{foot}</div>}
            {actions && <div className="ui-fieldtext-actions">{actions}</div>}
        </div>
    )
}
