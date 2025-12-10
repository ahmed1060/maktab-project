import React from 'react'

interface DiffViewerProps {
    oldText: string
    newText: string
}

export default function DiffViewer({ oldText, newText }: DiffViewerProps) {
    if (!oldText && !newText) return null
    if (!oldText) return <span style={{ backgroundColor: '#dcfce7', color: '#166534' }}>{newText}</span>
    if (!newText) return <span style={{ textDecoration: 'line-through', color: '#dc2626' }}>{oldText}</span>

    const diffWords = (oldString: string, newString: string) => {
        const oldWords = oldString.split(/\s+/)
        const newWords = newString.split(/\s+/)
        const result: { type: 'same' | 'added' | 'removed', text: string }[] = []

        let i = 0
        let j = 0

        while (i < oldWords.length || j < newWords.length) {
            if (i < oldWords.length && j < newWords.length && oldWords[i] === newWords[j]) {
                result.push({ type: 'same', text: oldWords[i] })
                i++
                j++
            } else {
                // Look ahead for match in new strings (Insertion)
                let k = 1
                let foundInNew = false
                while (j + k < newWords.length && k < 10) {
                    if (i < oldWords.length && newWords[j + k] === oldWords[i]) {
                        foundInNew = true
                        for (let m = 0; m < k; m++) {
                            result.push({ type: 'added', text: newWords[j + m] })
                        }
                        j += k
                        break
                    }
                    k++
                }
                if (foundInNew) continue

                // Look ahead for match in old strings (Deletion)
                k = 1
                let foundInOld = false
                while (i + k < oldWords.length && k < 10) {
                    if (j < newWords.length && oldWords[i + k] === newWords[j]) {
                        foundInOld = true
                        for (let m = 0; m < k; m++) {
                            result.push({ type: 'removed', text: oldWords[i + m] })
                        }
                        i += k
                        break
                    }
                    k++
                }
                if (foundInOld) continue

                // Verify bound before pushing
                if (i < oldWords.length) {
                    result.push({ type: 'removed', text: oldWords[i] })
                    i++
                }
                if (j < newWords.length) {
                    result.push({ type: 'added', text: newWords[j] })
                    j++
                }
            }
        }
        return result
    }

    const diff = diffWords(oldText, newText)

    return (
        <div style={{ lineHeight: '1.6' }}>
            {diff.map((part, index) => (
                <span
                    key={index}
                    style={{
                        backgroundColor: part.type === 'added' ? '#dcfce7' : part.type === 'removed' ? '#fee2e2' : 'transparent',
                        color: part.type === 'added' ? '#166534' : part.type === 'removed' ? '#991b1b' : 'inherit',
                        textDecoration: part.type === 'removed' ? 'line-through' : 'none',
                        marginRight: '4px'
                    }}
                >
                    {part.text}
                </span>
            ))}
        </div>
    )
}
