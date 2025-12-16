'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'

export default function NewObligationPage() {
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [assigneeId, setAssigneeId] = useState('')
    const [deadline, setDeadline] = useState('')
    const [difficulty, setDifficulty] = useState('')
    const [users, setUsers] = useState<any[]>([])
    const router = useRouter()

    const { data: session } = useSession()

    useEffect(() => {
        fetch('/api/users')
            .then(res => res.json())
            .then(data => {
                // Filter out current user first
                const otherUsers = data.filter((u: any) => u.email !== session?.user?.email)

                // Sort by role: EMPLOYEE -> TEAM_LEADER -> ADMIN -> SUPER_ADMIN
                const sortedData = otherUsers.sort((a: any, b: any) => {
                    const rolePriority: { [key: string]: number } = {
                        'EMPLOYEE': 1,
                        'TEAM_LEADER': 2,
                        'ADMIN': 3,
                        'SUPER_ADMIN': 4
                    }
                    const priorityA = rolePriority[a.role] || 99
                    const priorityB = rolePriority[b.role] || 99

                    if (priorityA !== priorityB) {
                        return priorityA - priorityB
                    }
                    // Secondary sort by name if same role
                    return a.firstName.localeCompare(b.firstName)
                })
                setUsers(sortedData)
            })
    }, [session])

    const [error, setError] = useState('')
    const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({})

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setFieldErrors({})

        // Client-side Validation
        const errors: { [key: string]: string } = {}
        if (!title || title.length < 3 || title.length > 100) {
            errors.title = "Title must be between 3 and 100 characters"
        }
        if (!description || description.length < 10 || description.length > 500) {
            errors.description = "Description must be between 10 and 500 characters"
        }

        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors)
            return
        }

        await fetch('/api/obligations', {
            method: 'POST',
            body: JSON.stringify({
                title,
                description,
                assigneeId,
                deadline,
                difficulty: parseInt(difficulty) || 0
            }),
            headers: { 'Content-Type': 'application/json' }
        })
        router.push('/dashboard/obligations')
        router.refresh()
    }

    return (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
            <h1 style={{ marginBottom: '1.5rem' }}>Add New Obligation</h1>
            <form onSubmit={handleSubmit}>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Title</label>
                    <input
                        className="input"
                        value={title}
                        onChange={e => {
                            setTitle(e.target.value)
                            if (fieldErrors.title) setFieldErrors({ ...fieldErrors, title: '' })
                        }}
                        style={fieldErrors.title ? { borderColor: '#ef4444' } : {}}
                        required
                        maxLength={100}
                    />
                    {fieldErrors.title && (
                        <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {fieldErrors.title}
                        </div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: title.length >= 100 ? '#ef4444' : '#94a3b8', textAlign: 'right', marginTop: '0.25rem' }}>
                        {title.length}/100
                    </div>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Description</label>
                    <textarea
                        className="input"
                        value={description}
                        onChange={e => {
                            setDescription(e.target.value)
                            if (fieldErrors.description) setFieldErrors({ ...fieldErrors, description: '' })
                        }}
                        style={fieldErrors.description ? { borderColor: '#ef4444' } : {}}
                        rows={4}
                        required
                        maxLength={500}
                    />
                    {fieldErrors.description && (
                        <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {fieldErrors.description}
                        </div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: description.length >= 500 ? '#ef4444' : '#94a3b8', textAlign: 'right', marginTop: '0.25rem' }}>
                        {description.length}/500
                    </div>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Assignee</label>
                    <select className="input" value={assigneeId} onChange={e => setAssigneeId(e.target.value)} required>
                        <option value="">Select Employee</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} - {u.role}</option>)}
                    </select>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Deadline</label>
                    <input
                        type="datetime-local"
                        className="input"
                        value={deadline}
                        onChange={e => setDeadline(e.target.value)}
                        min={new Date().toISOString().slice(0, 16)}
                        required
                    />
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Difficulty</label>
                    <input
                        type="number"
                        className="input"
                        value={difficulty}
                        onChange={e => {
                            const val = e.target.value
                            if (val === '') {
                                setDifficulty('')
                            } else {
                                const num = parseInt(val)
                                setDifficulty(Math.min(Math.max(num, 0), 10).toString())
                            }
                        }}
                        min="0"
                        max="10"
                        placeholder="0-10"
                        required
                    />
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button type="submit" className="btn btn-primary">Add Obligation</button>
                    <button
                        type="button"
                        className="btn"
                        style={{ background: '#e2e8f0', color: '#0f172a' }}
                        onClick={() => router.push('/dashboard/obligations')}
                    >
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    )
}
