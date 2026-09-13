'use client'
import { useLanguage } from '@/context/LanguageContext'
import TrashIcon from '@/components/TrashIcon'

// F-23: extracted verbatim out of tasks/[id]/client.tsx (1834 lines before
// this split). Purely presentational — no state of its own, just reads
// `task` and calls the two handlers back up to the parent, which is the
// one place task state actually lives.
interface TaskCostsSectionProps {
    task: any
    userId: string
    userRole: string
    onDeleteItem: (type: 'ATTACHMENT' | 'COST_ADDITION' | 'SUBMISSION_NOTE', itemId: string) => void
    onPaymentStatusChange: (newStatus: string, targetUserId?: string) => void
    getMemberCosts: (taskObj: any) => Record<string, number>
    getMemberPaymentStatus: (taskObj: any) => Record<string, string>
}

export default function TaskCostsSection({
    task, userId, userRole, onDeleteItem, onPaymentStatusChange, getMemberCosts, getMemberPaymentStatus
}: TaskCostsSectionProps) {
    const { t, locale } = useLanguage()

    if (!task.comments) return null
    try {
        const logs = Array.isArray(task.comments) ? task.comments : []
        if (!Array.isArray(logs)) return null
        const costs = logs.filter((l: any) => l.type === 'COST_ADDITION')
        if (costs.length === 0) return null

        return (
            <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem' }}>{t('costs')}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {costs.map((c: any, i: number) => (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', background: 'var(--warn-bg-yellow-subtle)', border: '1px solid var(--warn-border-yellow)', borderRadius: '0.5rem', padding: '1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: 'row' }}>
                                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--warn-fg)', textTransform: 'uppercase', fontWeight: '600', marginBottom: '0.25rem' }}>{t('cost_description_placeholder').split(' ')[0]}</div>
                                        {task.status === 'IN_PROGRESS' && (c.authorId === userId || ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) && (
                                            <button onClick={() => onDeleteItem('COST_ADDITION', c.date)} style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', display: 'flex' }} title={t('delete_cost_title')}>
                                                <TrashIcon size={14} />
                                            </button>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--warn-fg-deep)' }}>{c.description || t('no_description')}</div>
                                </div>
                                <div style={{ textAlign: 'center', background: 'var(--warn-bg)', padding: '0.5rem 1rem', borderRadius: '0.375rem', border: '1px solid var(--warn-border)' }}>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--warn-fg)', textTransform: 'uppercase', fontWeight: '600' }}>{t('amount_label')}</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--warn-fg)' }}>{(c.amount || 0).toFixed(2)} {t('egp')}</div>
                                </div>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--warn-fg-mid)', marginTop: '0.5rem', borderTop: '1px dashed var(--warn-border)', paddingTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {(task.assignees?.length > 1) && (
                                    <span style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-solid)', color: 'var(--warn-fg-mid)', padding: '0.1rem 0.4rem', borderRadius: '1rem', fontSize: '0.65rem', fontWeight: 'bold' }}>
                                        {locale === 'ar' ? 'بواسطة:' : 'By:'} {c.author}
                                    </span>
                                )}
                                {!((task.assignees?.length > 1)) && <span>{c.author}</span>}
                                <span>• {new Date(c.date).toLocaleString(locale)}</span>
                            </div>
                        </div>
                    ))}
                    {(() => {
                        const isAssignee = task.assignees?.some((a: any) => a.id === userId)
                        const isMulti = (task.assignees?.length || 0) > 1
                        const mPaymentStatus = getMemberPaymentStatus(task)

                        if (isMulti && isAssignee) {
                            const myStatus = mPaymentStatus[userId] || 'PENDING_PAYMENT'
                            return (
                                <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', flexDirection: 'row', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: '150px', background: 'var(--info-solid)', color: 'var(--text-on-accent)', padding: '1.25rem', borderRadius: '1rem', textAlign: 'center', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', position: 'relative' }}>
                                        <div style={{ fontSize: '0.875rem', fontWeight: '600', opacity: 0.9 }}>{t('my_total_cost' as any)}</div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{(getMemberCosts(task)[userId] || 0).toFixed(2)} {t('egp')}</div>
                                        <div style={{
                                            marginTop: '0.5rem',
                                            padding: '0.2rem 0.6rem',
                                            borderRadius: '1rem',
                                            background: 'var(--veil-20)',
                                            fontSize: '0.65rem',
                                            fontWeight: '800',
                                            width: 'fit-content',
                                            margin: '0.5rem auto 0',
                                            textTransform: 'uppercase'
                                        }}>
                                            {myStatus === 'PAID' ? t('payment_status_paid' as any) || 'PAID' : t('payment_status_pending' as any) || 'PENDING'}
                                        </div>
                                    </div>
                                    <div style={{ flex: 1, minWidth: '150px', background: 'var(--warn-solid)', color: 'var(--text-on-accent)', padding: '1.25rem', borderRadius: '1rem', textAlign: 'center', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                                        <div style={{ fontSize: '0.875rem', fontWeight: '600', opacity: 0.9 }}>{t('grand_total_cost' as any)}</div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{(task.totalCost || 0).toFixed(2)} {t('egp')}</div>
                                        <div style={{
                                            marginTop: '0.5rem',
                                            padding: '0.2rem 0.6rem',
                                            borderRadius: '1rem',
                                            background: 'var(--veil-20)',
                                            fontSize: '0.65rem',
                                            fontWeight: '800',
                                            width: 'fit-content',
                                            margin: '0.5rem auto 0',
                                            textTransform: 'uppercase'
                                        }}>
                                            {task.paymentStatus === 'PAID' ? t('payment_status_paid' as any) || 'PAID' : t('payment_status_pending' as any) || 'PENDING'}
                                        </div>
                                    </div>
                                </div>
                            )
                        }

                        return (
                            <div style={{ background: 'var(--warn-solid)', color: 'var(--text-on-accent)', padding: '1.25rem', borderRadius: '1rem', textAlign: 'center', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                                <div style={{ fontSize: '0.875rem', fontWeight: '600', opacity: 0.9 }}>{t('total_cost')}</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{(task.totalCost || 0).toFixed(2)} {t('egp')}</div>
                                <div style={{
                                    marginTop: '0.5rem',
                                    padding: '0.2rem 0.6rem',
                                    borderRadius: '1rem',
                                    background: 'var(--veil-20)',
                                    fontSize: '0.65rem',
                                    fontWeight: '800',
                                    width: 'fit-content',
                                    margin: '0.5rem auto 0',
                                    textTransform: 'uppercase'
                                }}>
                                    {task.paymentStatus === 'PAID' ? t('payment_status_paid' as any) || 'PAID' : t('payment_status_pending' as any) || 'PENDING'}
                                </div>
                            </div>
                        )
                    })()}

                    {/* Individual Settlements for Admins */}
                    {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && !['PENDING', 'IN_PROGRESS'].includes(task.status) && (task.assignees?.length || 0) > 1 && Object.keys(getMemberCosts(task)).length > 0 && (
                        <div style={{ marginTop: '1rem', padding: '1.25rem', background: 'var(--surface-subtle)', borderRadius: '1rem', border: '1px solid var(--border)' }}>
                            <h4 style={{ fontSize: '0.9rem', fontWeight: '700', marginBottom: '1rem', color: 'var(--text-main)' }}>
                                {t('individual_settlements' as any) || 'Individual Settlements'}
                            </h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {Object.entries(getMemberCosts(task)).map(([uid, amount]: [string, any]) => {
                                    const assignee = task.assignees.find((a: any) => a.id === uid)
                                    if (!assignee) return null
                                    const isPaid = getMemberPaymentStatus(task)[uid] === 'PAID'

                                    return (
                                        <div key={uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0.75rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--surface-sunk)', display: 'flex', alignItems: 'center', justifySelf: 'center', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-soft)' }}>
                                                    {assignee.firstName[0]}{assignee.lastName[0]}
                                                </div>
                                                <div>
                                                    <div style={{ fontWeight: '700', color: 'var(--text-body)', fontSize: '0.875rem' }}>{assignee.firstName} {assignee.lastName}</div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', fontWeight: '600' }}>{amount.toFixed(2)} {t('egp')}</div>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                <div style={{
                                                    padding: '0.2rem 0.5rem',
                                                    borderRadius: '1rem',
                                                    background: isPaid ? 'var(--ok-bg)' : 'var(--danger-bg)',
                                                    color: isPaid ? 'var(--ok-fg)' : 'var(--danger-fg)',
                                                    fontSize: '0.65rem',
                                                    fontWeight: '800',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    {isPaid ? t('payment_status_paid' as any) || 'PAID' : t('payment_status_pending' as any) || 'PENDING'}
                                                </div>
                                                <button
                                                    onClick={() => onPaymentStatusChange(isPaid ? 'PENDING_PAYMENT' : 'PAID', uid)}
                                                    style={{
                                                        background: isPaid ? 'var(--surface-sunk)' : 'var(--ok-solid)',
                                                        color: isPaid ? 'var(--text-soft)' : 'var(--text-on-accent)',
                                                        padding: '0.4rem 0.8rem',
                                                        fontSize: '0.75rem',
                                                        fontWeight: '700',
                                                        border: 'none',
                                                        borderRadius: '0.5rem',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    {isPaid ? t('mark_as_unpaid' as any) || 'Unsettle' : t('mark_as_paid')}
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )
    } catch { return null }
}
