'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function NewObligationPage() {
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [assigneeId, setAssigneeId] = useState('')
    const [deadline, setDeadline] = useState('')
    const [difficulty, setDifficulty] = useState('')
    const [users, setUsers] = useState<any[]>([])
    const router = useRouter()

    useEffect(() => {
        fetch('/api/users')
            .then(res => res.json())
            .then(data => {
                // Sort by role: EMPLOYEE -> TEAM_LEADER -> ADMIN -> SUPER_ADMIN
                const sortedData = data.sort((a: any, b: any) => {
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
    }, [])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
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
                    <input className="input" value={title} onChange={e => setTitle(e.target.value)} required />
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Description</label>
                    <textarea className="input" value={description} onChange={e => setDescription(e.target.value)} rows={4} required />
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Assignee</label>
                    <select className="input" value={assigneeId} onChange={e => setAssigneeId(e.target.value)} required>
                        <option value="">Select Employee</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                    </select>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Deadline</label>
                    <input type="date" className="input" value={deadline} onChange={e => setDeadline(e.target.value)} max="9999-12-31" required />
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
