'use client'
import { useState } from 'react'
import { MapPinIcon, PaperPlaneTiltIcon, PlusIcon, XIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { COST_DESCRIPTION_MAX, RECEIPT_ACCEPT } from '@/lib/task-costs'
import AdvanceBalanceHint from '@/components/cash-advances/AdvanceBalanceHint'
import { Button, Card, Field, FileChip, FileChips, FilePicker, NamePicker, TextArea, TextInput, type PickedName } from '@/components/ui'
import { useListNames } from '@/components/lists/useListNames'
import { nameOnList } from '@/lib/saved-lists'

/** The files a task takes: images, PDF and Office, as the upload route does. */
const TASK_FILE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx'

// What whoever does a task hands in, as a card of the building blocks. All
// it holds is read by the page's handlers too (the upload, Add, the check-in
// and the save on suspension), so it's all passed in.
interface TaskSubmissionFormProps {
    pendingFiles: File[]
    onAddFiles: (files: File[]) => void
    onRemoveFile: (index: number) => void
    uploading: boolean
    /** The cost's name, typed or picked from the company's cost names (CLIENTS_PLAN.md §5). */
    costName: PickedName
    setCostName: (v: PickedName) => void
    /** The task's company, whose cost names are offered. */
    companyId?: string | null
    /** The task and its client, whose cash advance money pays a cost here first (CLIENTS_PLAN.md §7.9). */
    taskId: string
    clientId: string | null
    cost: string
    setCost: (v: string) => void
    /** Add, with the list's name where it was checked against the list. */
    onAddCost: (name?: PickedName) => void
    /**
     * The company keeps cost names to its saved list (CLIENTS_PLAN.md §6.9;
     * DESIGN.md §5.3): the field says so, and Add takes one of them.
     */
    listOnly?: boolean
    /** The next cost's receipt photo, if one was picked (CLIENTS_PLAN.md §6.2). */
    costReceipt: File | null
    onCostReceipt: (files: File[]) => void
    onClearCostReceipt: () => void
    costEntries: any[]
    onRemoveCostEntry: (index: number) => void
    note: string
    setNote: (v: string) => void
    capturingLocation: boolean
    locationStatus: string
    onCaptureLocation: () => void
    onSaveDraft: () => void
    onSubmitRequest: () => void
    loadingType: 'DRAFT' | 'SUBMIT' | null
    /**
     * Past its deadline: it says so, and nothing more is added to it or taken
     * from it, files, costs, a location or a draft. It can still be handed in.
     */
    locked?: boolean
}

export default function TaskSubmissionForm({
    pendingFiles, onAddFiles, onRemoveFile, uploading,
    costName, setCostName, companyId, taskId, clientId, cost, setCost, onAddCost, costReceipt, onCostReceipt, onClearCostReceipt, costEntries, onRemoveCostEntry,
    note, setNote,
    capturingLocation, locationStatus, onCaptureLocation,
    onSaveDraft, onSubmitRequest, loadingType, locked = false, listOnly = false
}: TaskSubmissionFormProps) {
    const { t, locale } = useLanguage()
    const costNames = useListNames('COST_NAME', companyId)
    // What's wrong with the name, said under the field until it's typed again.
    const [nameProblem, setNameProblem] = useState<{ key: 'cost_name_needed' | 'cost_name_not_listed_add' | 'cost_name_not_listed_ask'; typed: string } | null>(null)
    const [checking, setChecking] = useState(false)
    // Said as it comes, with the focus left on Add: on the field, its
    // suggestions would cover it.
    const problem = nameProblem && <span role="alert">{t(nameProblem.key).replace('{name}', nameProblem.typed)}</span>
    const nameLabel = t(listOnly ? 'cost_name_from_list_placeholder' : 'cost_description_placeholder')

    // Where the company keeps cost names to its saved list, Add takes one of
    // them, one typed in full as the list has it too; otherwise the field
    // says why. If the list doesn't answer, the cost is added as it is, and
    // the server checks it when the task is handed in.
    const addCost = async () => {
        if (!listOnly) { onAddCost(); return }
        if (checking) return
        setChecking(true)
        try {
            const checked = await nameOnList(costName, costNames.suggest)
            if ('name' in checked) {
                setNameProblem(null)
                onAddCost(checked.name)
                return
            }
            setNameProblem({ key: checked.problem === 'needed' ? 'cost_name_needed' : costNames.onAdd ? 'cost_name_not_listed_add' : 'cost_name_not_listed_ask', typed: checked.typed })
        } catch {
            onAddCost()
        } finally {
            setChecking(false)
        }
    }
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const money = (n: number) => `${n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`

    // Not a form: Enter in a cost's amount adds nothing, and hands nothing in.
    return (
        <Card title={t('submit_task_title')}>
            <div className="ui-form">
                {locked && <p className="ui-error" role="status">{t('overdue_task_alert_msg')}</p>}

                <div className="ui-field">
                    <span className="ui-label">{t('attachments_optional_label')}</span>
                    <FilePicker label={t('ui_attach_files')} hint={t('upload_allowed_types_msg')} accept={TASK_FILE_ACCEPT} onFiles={onAddFiles} disabled={uploading || locked} />
                    {pendingFiles.length > 0 && (
                        <FileChips label={t('attachments_optional_label')}>
                            {pendingFiles.map((f, i) => (
                                <FileChip key={`${f.name}-${i}`} name={f.name} size={f.size} onRemove={locked || uploading ? undefined : () => onRemoveFile(i)} />
                            ))}
                        </FileChips>
                    )}
                </div>

                <fieldset className="ui-field ui-fieldset">
                    <legend className="ui-label">{t('add_costs_label')}</legend>
                    {/* Their cash advance, which pays the costs they add first (CLIENTS_PLAN.md §7.2). */}
                    <AdvanceBalanceHint on={{ taskId, clientId }} />
                    {/* On a phone the name takes the line, and the amount goes below: its suggestions need the width. */}
                    <div className="ui-cost-entry">
                        <Field label={nameLabel} hideLabel error={problem}>{p => (
                            <NamePicker
                                {...p}
                                placeholder={nameLabel}
                                value={costName}
                                onChange={v => { setNameProblem(null); setCostName(v) }}
                                {...costNames}
                                addLabel={t('lists_add_to_list')}
                                failedLabel={t('lists_add_failed')}
                                maxLength={COST_DESCRIPTION_MAX}
                            />
                        )}</Field>
                        <Field label={t('cost_amount_placeholder')} hideLabel>{p => (
                            <TextInput {...p} type="number" inputMode="decimal" name="cost-amount" autoComplete="off" placeholder={t('cost_amount_placeholder')} value={cost} onChange={e => setCost(e.target.value)} disabled={locked} />
                        )}</Field>
                        {/* Busy, not disabled: a disabled button drops the focus. */}
                        <Button icon={PlusIcon} onClick={() => { void addCost() }} aria-busy={checking || undefined} disabled={!cost || locked}>{t('add_label')}</Button>
                    </div>
                    {/* Its receipt, picked before Add, goes with the cost added next; picked again, it's replaced. */}
                    {costReceipt && (
                        <FileChips label={t('cost_receipt')}>
                            <FileChip name={costReceipt.name} size={costReceipt.size} onRemove={locked ? undefined : onClearCostReceipt} />
                        </FileChips>
                    )}
                    <FilePicker label={t('cost_receipt_attach')} hint={t('cost_receipt_hint')} accept={RECEIPT_ACCEPT} onFiles={onCostReceipt} disabled={uploading || locked} multiple={false} />
                    {costEntries.length > 0 && (
                        <ul className="ui-rows" aria-label={t('add_costs_label')}>
                            {costEntries.map((e, i) => (
                                <li key={i}>
                                    <div className="ui-row">
                                        <span className="ui-row-main">
                                            <span className="ui-item-title"><bdi>{e.description || t('no_description')}</bdi></span>
                                            {e.receipt && (
                                                <FileChips label={t('cost_receipt_of').replace('{name}', e.description || t('no_description'))}>
                                                    <FileChip name={e.receipt.name} size={e.receipt.size} />
                                                </FileChips>
                                            )}
                                        </span>
                                        <span className="ui-row-end">
                                            <span className="ui-num">{money(e.amount)}</span>
                                            {!locked && <Button size="sm" variant="quiet" icon={XIcon} aria-label={t('ui_remove_file').replace('{name}', e.description || t('no_description'))} onClick={() => onRemoveCostEntry(i)}>{t('remove')}</Button>}
                                        </span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </fieldset>

                <Field label={t('note_optional_label')} hint={t('ui_characters_used').replace('{used}', num(note.length)).replace('{max}', num(500))}>{p => (
                    <TextArea {...p} name="note" dir="auto" rows={3} maxLength={500} placeholder={t('note_placeholder')} value={note} onChange={e => setNote(e.target.value)} />
                )}</Field>

                <div className="ui-field">
                    <span className="ui-label">{t('current_location_label')}</span>
                    <div className="ui-form-actions">
                        <Button icon={MapPinIcon} onClick={onCaptureLocation} disabled={capturingLocation || uploading || locked} busy={capturingLocation}>
                            {capturingLocation ? t('capturing_location_button') : t('capture_location_button')}
                        </Button>
                        {/* There before it's said, or a screen reader may not say it. */}
                        <span className="ui-hint" role="status">{locationStatus}</span>
                    </div>
                </div>

                <div className="ui-form-actions">
                    <Button variant="primary" icon={PaperPlaneTiltIcon} onClick={onSubmitRequest} disabled={uploading} busy={loadingType === 'SUBMIT'}>
                        {loadingType === 'SUBMIT' ? t('submitting') : t('submit_task_button')}
                    </Button>
                    <Button onClick={onSaveDraft} disabled={uploading || locked} busy={loadingType === 'DRAFT'}>
                        {loadingType === 'DRAFT' ? t('saving') : t('save_draft_button')}
                    </Button>
                </div>
            </div>
        </Card>
    )
}
