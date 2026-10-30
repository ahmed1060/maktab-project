'use client'
import { TrashIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useModules } from '@/lib/useModules'
import SectionBoundary from './SectionBoundary'
import SafeDate from './SafeDate'
import { useCan } from '@/lib/useCan'
import { useBusyAction } from '@/lib/useBusyAction'
import { isReviewed } from '@/lib/task-reviewed'
import { cents, costLines } from '@/lib/task-costs'
import { Button, Card, FileChip, FileChips, StatusBadge, TotalTiles, type Tile } from '@/components/ui'

// A task's costs (CLIENTS_PLAN.md §4.4, §4.5), as a card of the building
// blocks: no state of its own, it reads `task` and calls the page's two
// handlers, the page being where a task's state lives.
interface TaskCostsSectionProps {
    task: any
    userId: string
    onDeleteItem: (type: 'ATTACHMENT' | 'COST' | 'COST_ADDITION' | 'SUBMISSION_NOTE', itemId: string) => void
    onPaymentStatusChange: (newStatus: string, targetUserId?: string) => Promise<void> | void
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
    // One share saved at a time, the one clicked showing it.
    const action = useBusyAction()

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
    const paidBadge = (paid: boolean) => <StatusBadge tone={paid ? 'good' : 'waiting'}>{paid ? t('payment_status_paid') : t('payment_status_pending')}</StatusBadge>
    // A total that's what's to be paid back says so, once part of it came from an advance.
    const note = (paid: boolean, of?: string) => (
        <>
            {paidBadge(paid)}
            {advanced(of) > 0 && <span className="ui-hint"> {t('advances_cost_split').replace('{total}', money(spentOn(of))).replace('{advance}', money(advanced(of)))}</span>}
        </>
    )

    const isAssignee = task.assignees?.some((a: any) => a.id === userId)
    const shared = (task.assignees?.length || 0) > 1
    const taskPaid = task.paymentStatus === 'PAID'
    const total: Tile = { label: advanced() > 0 ? t('advances_to_pay_back') : shared && isAssignee ? t('grand_total_cost') : t('total_cost'), value: money(task.totalCost || 0), note: note(taskPaid) }
    // Someone on a shared task sees their own share beside the task's.
    const tiles: Tile[] = shared && isAssignee
        ? [{ label: advanced(userId) > 0 ? t('advances_to_pay_back') : t('my_total_cost'), value: money(getMemberCosts(task)[userId] || 0), note: note((getMemberPaymentStatus(task)[userId] || 'PENDING_PAYMENT') === 'PAID', userId) }, total]
        : [total]
    // Each person's share, paid one by one, once the task is reviewed, as the server pays only then.
    const settlements = can('tasks.pay') && isReviewed(task.status) && shared && Object.keys(getMemberCosts(task)).length > 0

    return (
        <Card title={modules.label('costs')}>
            <ul className="ui-rows ui-cost-rows" aria-label={modules.label('costs')}>
                {costs.map(c => (
                    <li key={c.id}>
                        <div className="ui-row">
                            <span className="ui-row-main">
                                {/* A description is up to 200 characters, a link among them: it wraps, however long its words. */}
                                <span className="ui-item-title"><bdi>{c.description || t('no_description')}</bdi></span>
                                <span className="ui-item-detail"><bdi>{c.author}</bdi> · <SafeDate date={c.date} locale={locale} /></span>
                                {/* Part of it from the author's cash advance (CLIENTS_PLAN.md §7.5). */}
                                {(c.fromAdvance ?? 0) > 0 && (
                                    <span className="ui-item-detail">
                                        {t('advances_from_advance')}: <span className="ui-num ui-nowrap">{money(c.fromAdvance ?? 0)}</span> · {t('advances_to_pay_back')}: <span className="ui-num ui-nowrap">{money(cents(c.amount - (c.fromAdvance ?? 0)))}</span>
                                    </span>
                                )}
                                {/* Its receipt's photo, opened in a new tab (CLIENTS_PLAN.md §6.2). */}
                                {c.receiptUrl && (
                                    <FileChips label={t('cost_receipt_of').replace('{name}', c.description || t('no_description'))}>
                                        <FileChip name={t('cost_receipt')} href={c.receiptUrl} />
                                    </FileChips>
                                )}
                            </span>
                            <span className="ui-row-end">
                                {/* An amount is never broken from its currency (DESIGN.md §5.5). */}
                                <span className="ui-num ui-nowrap">{money(c.amount)}</span>
                                {!locked && task.status === 'IN_PROGRESS' && (c.authorId === userId || can('tasks.edit')) && (
                                    <Button size="sm" variant="quiet" icon={TrashIcon} aria-label={t('delete_cost_title')} title={t('delete_cost_title')} onClick={() => onDeleteItem('COST', c.id)}>{t('delete')}</Button>
                                )}
                            </span>
                        </div>
                    </li>
                ))}
            </ul>
            <TotalTiles items={tiles} />
            {settlements && (
                <section className="ui-subsection">
                    <h3 className="ui-subsection-title">{t('individual_settlements')}</h3>
                    <ul className="ui-rows" aria-label={t('individual_settlements')}>
                        {Object.entries(getMemberCosts(task)).map(([uid, amount]) => {
                            const assignee = task.assignees.find((a: any) => a.id === uid)
                            if (!assignee) return null
                            const isPaid = getMemberPaymentStatus(task)[uid] === 'PAID'
                            return (
                                <li key={uid}>
                                    <div className="ui-row">
                                        <span className="ui-row-main">
                                            <span className="ui-item-title"><bdi>{assignee.firstName} {assignee.lastName}</bdi></span>
                                            <span className="ui-item-detail ui-num ui-nowrap">{money(amount)}</span>
                                        </span>
                                        <span className="ui-row-end">
                                            {paidBadge(isPaid)}
                                            <Button size="sm" onClick={() => { void action.run(uid, () => onPaymentStatusChange(isPaid ? 'PENDING_PAYMENT' : 'PAID', uid)) }} disabled={action.running} busy={action.is(uid)}>
                                                {isPaid ? t('mark_as_unpaid') : t('mark_as_paid')}
                                            </Button>
                                        </span>
                                    </div>
                                </li>
                            )
                        })}
                    </ul>
                </section>
            )}
        </Card>
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
