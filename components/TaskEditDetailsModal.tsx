'use client'
import Modal from '@/components/Modal'
import DateTimePicker from '@/components/DateTimePicker'
import LocationSearchInput from '@/components/LocationSearchInput'
import { useLanguage } from '@/context/LanguageContext'

// F-23: extracted verbatim out of tasks/[id]/client.tsx. editForm/
// editFieldErrors stay owned by the parent (handleSaveDetails and
// handleEditClick, which populates the form when the modal opens, both
// live there), so this component is purely the form's JSX.
interface TaskEditDetailsModalProps {
    isOpen: boolean
    onClose: () => void
    onSubmit: (e: React.FormEvent) => void
    editForm: {
        title: string
        description: string
        location: string
        locationLink?: string
        deadline: string
        difficulty: number
    }
    setEditForm: (form: any) => void
    editFieldErrors: { title: string, description: string }
    setEditFieldErrors: (errors: { title: string, description: string }) => void
    task: any
}

export default function TaskEditDetailsModal({ isOpen, onClose, onSubmit, editForm, setEditForm, editFieldErrors, setEditFieldErrors, task }: TaskEditDetailsModalProps) {
    const { t, locale } = useLanguage()

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('edit_task_details_title')} hideFooter>
            <form onSubmit={onSubmit} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                <div style={{ marginBottom: '1.25rem' }}>
                    <label className="label">{t('name_label')}</label>
                    <input className="input" value={editForm.title} onChange={e => { setEditForm({ ...editForm, title: e.target.value }); setEditFieldErrors({ ...editFieldErrors, title: '' }); }} style={{ borderColor: editFieldErrors.title ? 'var(--danger-solid)' : undefined }} maxLength={100} required />
                    <div style={{ textAlign: locale === 'ar' ? 'left' : 'right', fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: '0.25rem' }}>{editForm.title.length}/100</div>
                </div>
                <div style={{ marginBottom: '1.25rem' }}>
                    <label className="label">{t('description_changes_title').split(' ')[0]}</label>
                    <textarea className="input" rows={4} value={editForm.description} onChange={e => { setEditForm({ ...editForm, description: e.target.value }); setEditFieldErrors({ ...editFieldErrors, description: '' }); }} style={{ borderColor: editFieldErrors.description ? 'var(--danger-solid)' : undefined }} maxLength={1000} required />
                    <div style={{ textAlign: locale === 'ar' ? 'left' : 'right', fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: '0.25rem' }}>{editForm.description.length}/1000</div>
                </div>
                <div style={{ marginBottom: '1.25rem' }}>
                    <LocationSearchInput
                        label="Location"
                        value={{ name: editForm.location, link: (editForm as any).locationLink }}
                        onChange={(val) => {
                            setEditForm({ ...editForm, location: val.name, locationLink: val.link })
                        }}
                        placeholder={t('location_name_placeholder')}
                        locale={locale}
                    />
                </div>
                <div style={{ marginBottom: '1.25rem' }}>
                    <label className="label">{t('assignee_label')}</label>
                    <div style={{
                        maxHeight: '150px',
                        overflowY: 'auto',
                        border: '1px solid var(--border)',
                        borderRadius: '0.5rem',
                        padding: '1rem',
                        background: 'var(--surface-subtle)',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.5rem'
                    }}>
                        {task.assignees && task.assignees.length > 0 ? (
                            task.assignees.map((u: any) => (
                                <div key={u.id} style={{
                                    background: 'var(--surface)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '2rem',
                                    padding: '0.4rem 1rem',
                                    fontSize: '0.9rem',
                                    color: 'var(--text-body)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    boxShadow: '0 1px 2px var(--shadow-faint)'
                                }}>
                                    {u.firstName} {u.lastName} <small style={{ color: 'var(--text-soft)', marginLeft: locale === 'ar' ? 0 : '0.4rem', marginRight: locale === 'ar' ? '0.4rem' : 0 }}>({t(`role_${u.role?.toLowerCase()}` as any)})</small>
                                </div>
                            ))
                        ) : (
                            <div style={{
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                borderRadius: '2rem',
                                padding: '0.5rem 1rem',
                                fontSize: '0.9rem',
                                fontWeight: '600'
                            }}>
                                {task.assignees?.map((a: any) => `${a.firstName} ${a.lastName}`).join(', ')}
                            </div>
                        )}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-soft)', marginTop: '0.5rem' }}>
                        {t('transfer_notice' as any) || (locale === 'ar' ? 'يرجى استخدام زر "التحويل" لتغيير الموظفين.' : 'Please use the "Transfer" button to change employees.')}
                    </p>
                </div>
                <div style={{ marginBottom: '1.25rem' }}>
                    {/* Backend requires the deadline be at least 3h out
                        (task.service.ts's updateDetails) — this min matches
                        that, same as the create-task form already does.
                        Previously just blocked the past, which let you pick
                        e.g. "10 minutes from now" here and get an unhandled
                        500 back. */}
                    <DateTimePicker label={t('deadline_label')} value={editForm.deadline} onChange={v => setEditForm({ ...editForm, deadline: v })} min={new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()} />
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                    <label className="label">{t('difficulty')}</label>
                    <input type="number" className="input" value={editForm.difficulty} onChange={e => setEditForm({ ...editForm, difficulty: parseInt(e.target.value) || 0 })} min={0} max={10} required />
                </div>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                    <button type="button" onClick={onClose} className="btn" style={{ background: 'var(--border)' }}>{t('cancel')}</button>
                    <button type="submit" className="btn btn-primary">{t('save_changes_button')}</button>
                </div>
            </form>
        </Modal>
    )
}
