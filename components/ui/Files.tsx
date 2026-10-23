'use client'

import { useRef, useState, type ReactNode } from 'react'
import { FileIcon, PaperclipIcon, XIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { fileSize } from '@/lib/record-files'
import { Icon } from './Icon'

/**
 * Files (DESIGN.md §5.5): a chip per file, picked or saved, and the button
 * that picks them. A saved file's chip opens it in a new tab; a chip's
 * remove button is named for its file.
 */
export function FileChip({ name, size, href, onRemove }: { name: string; size?: number; href?: string; onRemove?: () => void }) {
    const { t, locale } = useLanguage()
    const inside = (
        <>
            <Icon icon={FileIcon} size={16} />
            <span className="ui-file-name">{name}</span>
            {size ? <span className="ui-file-size">{fileSize(size, locale)}</span> : null}
        </>
    )
    return (
        <span className="ui-file">
            {href
                ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="ui-file-open">
                        {inside}
                        <span className="ui-visually-hidden">{t('ui_opens_new_tab')}</span>
                    </a>
                )
                : <span className="ui-file-open">{inside}</span>}
            {onRemove && (
                <button type="button" className="ui-file-remove" onClick={onRemove} aria-label={t('ui_remove_file').replace('{name}', name)} title={t('ui_remove_file').replace('{name}', name)}>
                    <Icon icon={XIcon} size={16} />
                </button>
            )}
        </span>
    )
}

/** Chips in a row that wraps. */
export function FileChips({ label, children }: { label: string; children: ReactNode }) {
    return <div className="ui-files" role="group" aria-label={label}>{children}</div>
}

/**
 * "Attach files": a secondary button that opens the file picker, and, on
 * computers, a place to drop files. `hint` says which kinds and how large.
 */
export function FilePicker({ label, hint, accept, onFiles, disabled = false }: {
    label: string
    hint: ReactNode
    accept: string
    onFiles: (files: File[]) => void
    disabled?: boolean
}) {
    const input = useRef<HTMLInputElement>(null)
    const [over, setOver] = useState(false)
    return (
        <div
            className="ui-file-drop"
            data-over={over || undefined}
            // A drop is always taken here, so a file dropped while it's
            // disabled isn't opened by the browser in place of the page.
            onDragOver={e => {
                e.preventDefault()
                if (disabled) e.dataTransfer.dropEffect = 'none'
                else setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={e => {
                e.preventDefault()
                setOver(false)
                if (!disabled) onFiles([...e.dataTransfer.files])
            }}
        >
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => input.current?.click()} disabled={disabled}>
                <Icon icon={PaperclipIcon} size={18} />
                {label}
            </button>
            <span className="ui-hint">{hint}</span>
            <input
                ref={input}
                type="file"
                multiple
                accept={accept}
                className="ui-visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
                onChange={e => {
                    onFiles([...(e.target.files ?? [])])
                    e.target.value = ''
                }}
            />
        </div>
    )
}
