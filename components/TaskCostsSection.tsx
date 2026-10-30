'use client'
import { useLanguage } from '@/context/LanguageContext'
import { useModules } from '@/lib/useModules'
import TrashIcon from '@/components/TrashIcon'
import SectionBoundary from './SectionBoundary'
import SafeDate from './SafeDate'
import { useCan } from '@/lib/useCan'
import { isReviewed } from '@/lib/task-reviewed'
import { cents, costLines } from '@/lib/task-costs'
import { FileChip, FileChips } from '@/components/ui'

// F-23: extracted verbatim out of tasks/[id]/client.tsx (1834 lines before
// this split). Purely presentational — no state of its own, just reads
// `task` and calls the two handlers back up to the parent, which is the
// one place task state actually lives.
interface TaskCostsSectionProps {
    task: any
    userId: string
    onDeleteItem: (type: 'ATTACHMENT' | 'COST' | 'COST_ADDITION' | 'SUBMISSION_NOTE', itemId: string) => void
    onPaymentStatusChange: (newStatus: string, targetUserId?: string) => void
    getMemberCosts: (taskObj: any) => Record<string, number>
    getMemberPaymentStatus: (taskObj: any) => Record<string, string>
    /** Past its deadline, for whoever does it: a cost stays. */
    locked?: boolean
}

function TaskCostsSectionBody({
    task, userId, onDeleteItem, onPaymentStatusChange, getMemberCosts, getMemberPaymentStatus, locked = false
}: TaskCostsSectionProps) {
    const { t, locale } = useLanguage()
    const { can } = useCan()
    const modules = useModules()

        // Each with its description (CLIENTS_PLAN.md §4.4, §4.5).
        const costs = costLines(task.costs ?? [], task.comments)
        if (costs.length === 0) return null
        // What came from cash advances, the task's and the viewer's (CLIENTS_PLAN.md §7.2):
        // its shares and total count only what's to be paid back.
        const advanced = (of?: string) => cents(costs.filter(c => !of || c.authorId === of).reduce((sum, c) => sum + (c.fromAdvance ?? 0), 0))
        const spentOn = (of?: string) => cents(costs.filter(c => !of || c.authorId === of).reduce((sum, c) => sum + c.amount, 0))
        // With Intl, in the page's language's digits (DESIGN.md §3.3).
        const amounts = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const money = (n: number) => `${amounts.format(n)} ${t('egp')}`
        // A total that's what's to be paid back, once part of it came from an advance.
        const owedNote = (of?: string) => advanced(of) > 0 && (
            <div style={{ fontSize: 'var(--text-xs)', opacity: 0.9, marginTop: 'var(--space-1)' }}>
                {t('advances_cost_split').replace('{total}', money(spentOn(of))).replace('{advance}', money(advanced(of)))}
            </div>
        )

        return (
            <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem' }}>{modules.label('costs')}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {costs.map(c => (
                        <div key={c.id} style={{ display: 'flex', flexDirection: 'column', background: 'var(--warn-bg-yellow-subtle)', border: '1px solid var(--warn-border-yellow)', borderRadius: '0.5rem', padding: '1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: 'row' }}>
                                {/* A description is up to 200 characters, a link among them: it wraps, however long its words. */}
                                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left', minWidth: 0, overflowWrap: 'anywhere' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--warn-fg)', textTransform: 'uppercase', fontWeight: '600', marginBottom: '0.25rem' }}>{t('cost_description_placeholder').split(' ')[0]}</div>
                                        {!locked && task.status === 'IN_PROGRESS' && (c.authorId === userId || can('tasks.edit')) && (
                                            <button aria-label={t('delete_cost_title')} onClick={() => onDeleteItem('COST', c.id)} style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', display: 'flex' }} title={t('delete_cost_title')}>
                                                <TrashIcon size={14} />
                                            </button>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--warn-fg-deep)' }}>{c.description || t('no_description')}</div>
                                    {/* Its receipt's photo, opened in a new tab (CLIENTS_PLAN.md §6.2). */}
                                    {c.receiptUrl && (
                                        <div style={{ marginTop: 'var(--space-2)' }}>
                                            <FileChips label={t('cost_receipt_of').replace('{name}', c.description || t('no_description'))}>
                                                <FileChip name={t('cost_receipt')} href={c.receiptUrl} />
                                            </FileChips>
                                        </div>
                                    )}
                                </div>
                                <div style={{ textAlign: 'center', background: 'var(--warn-bg)', padding: '0.5rem 1rem', borderRadius: '0.375rem', border: '1px solid var(--warn-border)' }}>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--warn-fg)', textTransform: 'uppercase', fontWeight: '600' }}>{t('amount_label')}</div>
                                    {/* An amount is never broken from its currency (DESIGN.md §5.5): the description beside it wraps instead. */}
                                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--warn-fg)', whiteSpace: 'nowrap' }}>{money(c.amount)}</div>
                                </div>
                            </div>
                            {/* Part of it from the author's cash advance (CLIENTS_PLAN.md §7.5): a line of its own, so the amount's box stays narrow on a phone. */}
                            {(c.fromAdvance ?? 0) > 0 && (
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--warn-fg-mid)', marginTop: 'var(--space-2)', display: 'flex', flexWrap: 'wrap', columnGap: 'var(--space-4)' }}>
                                    <span>{t('advances_from_advance')}: {money(c.fromAdvance ?? 0)}</span>
                                    <span>{t('advances_to_pay_back')}: {money(cents(c.amount - (c.fromAdvance ?? 0)))}</span>
                                </div>
                            )}
                            <div style={{ fontSize: '0.75rem', color: 'var(--warn-fg-mid)', marginTop: '0.5rem', borderTop: '1px dashed var(--warn-border)', paddingTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {(task.assignees?.length > 1) && (
                                    <span style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-solid)', color: 'var(--warn-fg-mid)', padding: '0.1rem 0.4rem', borderRadius: '1rem', fontSize: '0.65rem', fontWeight: 'bold' }}>
                                        {locale === 'ar' ? 'بواسطة:' : 'By:'} {c.author}
                                    </span>
                                )}
                                {!((task.assignees?.length > 1)) && <span>{c.author}</span>}
                                <span>• <SafeDate date={c.date} locale={locale} /></span>
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
                                    <div style={{ flex: 1, minWidth: '150px', background: 'var(--info-fill)', color: 'var(--text-on-accent)', padding: '1.25rem', borderRadius: '1rem', textAlign: 'center', boxShadow: '0 4px 6px -1px var(--shadow-weak)', position: 'relative' }}>
                                        <div style={{ fontSize: '0.875rem', fontWeight: '600', opacity: 0.9 }}>{advanced(userId) > 0 ? t('advances_to_pay_back') : t('my_total_cost' as any)}</div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{money(getMemberCosts(task)[userId] || 0)}</div>
                                        {owedNote(userId)}
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
                                    <div style={{ flex: 1, minWidth: '150px', background: 'var(--warn-fill)', color: 'var(--text-on-accent)', padding: '1.25rem', borderRadius: '1rem', textAlign: 'center', boxShadow: '0 4px 6px -1px var(--shadow-weak)' }}>
                                        <div style={{ fontSize: '0.875rem', fontWeight: '600', opacity: 0.9 }}>{advanced() > 0 ? t('advances_to_pay_back') : t('grand_total_cost' as any)}</div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{money(task.totalCost || 0)}</div>
                                        {owedNote()}
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
                            <div style={{ background: 'var(--warn-fill)', color: 'var(--text-on-accent)', padding: '1.25rem', borderRadius: '1rem', textAlign: 'center', boxShadow: '0 4px 6px -1px var(--shadow-weak)' }}>
                                <div style={{ fontSize: '0.875rem', fontWeight: '600', opacity: 0.9 }}>{advanced() > 0 ? t('advances_to_pay_back') : t('total_cost')}</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{money(task.totalCost || 0)}</div>
                                {owedNote()}
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

                    {/* Individual Settlements for Admins: once the task is reviewed, as the server pays only then */}
                    {can('tasks.pay') && isReviewed(task.status) && (task.assignees?.length || 0) > 1 && Object.keys(getMemberCosts(task)).length > 0 && (
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
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', fontWeight: '600' }}>{money(amount)}</div>
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
                                                        background: isPaid ? 'var(--surface-sunk)' : 'var(--ok-fill)',
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
}

/**
 * The section, inside a boundary. It used to wrap its own body in try/catch,
 * which caught errors in the JSX expressions but not in child components, and
 * reported nothing it caught — see SectionBoundary for the whole story. Same
 * behaviour for the reader: a malformed task log loses this section, not the
 * page.
 */
export default function TaskCostsSection(props: TaskCostsSectionProps) {
    return (
        <SectionBoundary name="TaskCostsSection">
            <TaskCostsSectionBody {...props} />
        </SectionBoundary>
    )
}
