'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { Button, Dialog, DialogActions, Field, Select, TextArea, TextInput } from '@/components/ui'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import PermissionMatrix from '@/components/PermissionMatrix'
import { BUILT_IN_LABEL, roleLabel } from '@/lib/role-label'
import { countOf } from '@/lib/plural'
import { useLanguage } from '@/context/LanguageContext'
import type { TranslationKey } from '@/lib/translations'
import type { Grants } from '@/lib/permissions/grants'
import type { SerializedAccess } from '@/lib/features/bundles'
import { fromRows, permissionLabelKey, toRows } from '@/lib/permissions/matrix'
import { conflictsIn, newConflicts } from '@/lib/permissions/separation'
import { newWorksWithLess, unmetNeeds, worksWithLess, type WorksWithLess } from '@/lib/permissions/grant-rules'

/**
 * Creating or editing a company's role, or a role template — the same form:
 * name, description, base role and the permission matrix (ROLES_PLAN.md §6.1,
 * §6.2). The server decides; this says in advance what it will refuse (a
 * locked or built-in role, a held role's base) so nobody fills in a form to be
 * told no.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 4c):
 * the building blocks' dialog, its fields labelled, and what's wrong said
 * under the field on Save, where Save was off without a word.
 */

export type BaseRole = 'ADMIN' | 'TEAM_LEADER' | 'EMPLOYEE'
type Rows = { permission: string; scope: string }[]
export type Template = { id: string; name: string; description: string | null; baseRole: BaseRole; grants: Rows }
export type EditableRole = {
    id?: string
    name: string
    description: string | null
    baseRole: BaseRole
    grants: Rows
    builtIn?: BaseRole | null
    holders?: number
    locked?: boolean
    copiedFromTemplateId?: string | null
}

export type RoleSubmission = {
    name: string
    description: string | null
    baseRole: BaseRole
    grants: Rows
    fromTemplateId?: string
    applyNow?: boolean
    acknowledgeConflicts?: boolean
    acknowledgeLess?: boolean
}

type Props = {
    isOpen: boolean
    onClose: () => void
    kind: 'role' | 'template'
    role: EditableRole | null
    /** For a new company role: templates to start from. */
    templates?: Template[]
    access?: SerializedAccess | null
    onSubmit: (submission: RoleSubmission) => Promise<boolean>
}

type RoleErrors = { name?: TranslationKey; acknowledge?: TranslationKey; needs?: TranslationKey; less?: TranslationKey }

/**
 * What's wrong on Save, each said under its field: a name, a new pair of
 * duties kept on purpose, a permission ticked without another area's it
 * needs (PR 372), as a role saved before may be, and one newly working with
 * less kept that way on purpose (PR 373).
 */
export function roleErrors({ name, addedPairs, acknowledged, unmet = 0, addedLess = 0, keptLess = false }: {
    name: string; addedPairs: number; acknowledged: boolean; unmet?: number; addedLess?: number; keptLess?: boolean
}): RoleErrors {
    const errors: RoleErrors = {}
    if (!name.trim()) errors.name = 'roles_name_required'
    if (addedPairs > 0 && !acknowledged) errors.acknowledge = 'sod_acknowledge_required'
    if (unmet > 0) errors.needs = 'roles_needs_missing'
    if (addedLess > 0 && !keptLess) errors.less = 'roles_less_acknowledge_required'
    return errors
}

/** "Create tasks without See clients: no client can be picked for a task." */
function lessLine(t: (key: TranslationKey) => string, { permission, without }: WorksWithLess): string {
    const effect = `roles_less_${permission.replace(/\./g, '_')}_${without.replace(/\./g, '_')}` as TranslationKey
    return t('roles_less_item')
        .replace('{permission}', t(permissionLabelKey(permission)))
        .replace('{without}', t(permissionLabelKey(without)))
        .replace('{effect}', t(effect))
}

const BASE_ROLES: BaseRole[] = ['EMPLOYEE', 'TEAM_LEADER', 'ADMIN']

export default function RoleEditorModal(props: Props) {
    // Keyed so each opening starts from the role as it is, not the last edit.
    if (!props.isOpen) return null
    return <Editor key={props.role?.id ?? 'new'} {...props} />
}

function Editor({ onClose, kind, role, templates = [], access, onSubmit }: Props) {
    const { t, locale } = useLanguage()
    const id = useId()
    const formRef = useRef<HTMLFormElement>(null)
    const isNew = !role?.id

    const [name, setName] = useState(role?.name ?? '')
    const [description, setDescription] = useState(role?.description ?? '')
    const [baseRole, setBaseRole] = useState<BaseRole>(role?.baseRole ?? 'EMPLOYEE')
    const [grants, setGrants] = useState<Grants>(fromRows(role?.grants ?? []))
    const [templateId, setTemplateId] = useState('')
    const [applyNow, setApplyNow] = useState(false)
    const [acknowledged, setAcknowledged] = useState(false)
    const [keptLess, setKeptLess] = useState(false)
    const [saving, setSaving] = useState(false)
    const [errors, setErrors] = useState<RoleErrors>({})

    const locked = !!role?.locked
    const builtIn = !!role?.builtIn
    const holders = role?.holders ?? 0
    // A held role's base cannot move (§4.3), nor a built-in's.
    const baseFixed = builtIn || holders > 0
    const original = fromRows(role?.grants ?? [])
    const grantsChanged = JSON.stringify(Object.entries(grants).sort()) !== JSON.stringify(Object.entries(original).sort())
    const reachesHolders = !isNew && holders > 0 && (grantsChanged || baseRole !== role?.baseRole)
    // Separation of duties (§6.11): every pair it holds is shown; one it did
    // not hold before must be acknowledged, and the decision is recorded.
    const pairs = conflictsIn(grants)
    const addedPairs = newConflicts(original, grants)
    // Rule 3 (PR 373): every permission it holds that works with less is
    // shown; one it did not hold before is kept on purpose, and recorded.
    const less = worksWithLess(grants)
    const addedLess = newWorksWithLess(original, grants)
    const compareWith = role?.copiedFromTemplateId ? templates.find(tp => tp.id === role.copiedFromTemplateId) : null

    const startFrom = (templateId: string) => {
        setTemplateId(templateId)
        const template = templates.find(tp => tp.id === templateId)
        if (!template) return
        setBaseRole(template.baseRole)
        setGrants(fromRows(template.grants))
        if (!name) setName(template.name)
        if (!description && template.description) setDescription(template.description)
    }

    const submit = async (e: FormEvent) => {
        e.preventDefault()
        if (locked) return
        const found = roleErrors({ name, addedPairs: addedPairs.length, acknowledged, unmet: unmetNeeds(grants).length, addedLess: addedLess.length, keptLess })
        setErrors(found)
        if (found.name || found.acknowledge || found.needs || found.less) { focusFirstWrong(formRef.current); return }
        setSaving(true)
        try {
            const ok = await onSubmit({
                name: name.trim(), description: description.trim() || null, baseRole, grants: toRows(grants),
                ...(isNew && templateId ? { fromTemplateId: templateId } : {}),
                ...(reachesHolders && applyNow ? { applyNow: true } : {}),
                ...(addedPairs.length && acknowledged ? { acknowledgeConflicts: true } : {}),
                ...(addedLess.length && keptLess ? { acknowledgeLess: true } : {}),
            })
            if (ok) onClose()
        } finally {
            setSaving(false)
        }
    }

    const title = kind === 'template'
        ? (isNew ? t('role_templates_new') : role!.name)
        : (isNew ? t('roles_new') : roleLabel(role, t))

    return (
        <Dialog open onClose={() => { if (!saving) onClose() }} title={title}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={submit}>
                {locked && <p className="ui-dialog-note">{t('roles_locked_hint')}</p>}

                {isNew && kind === 'role' && templates.length > 0 && (
                    <Field label={t('roles_template')}>{p => (
                        <Select {...p} name="template" value={templateId} onChange={e => startFrom(e.target.value)}
                            options={[{ value: '', label: t('roles_from_scratch') }, ...templates.map(tp => ({ value: tp.id, label: tp.name }))]} />
                    )}</Field>
                )}

                <Field label={t('roles_name')} error={errors.name && t(errors.name)}>{p => (
                    // A built-in role's name is shown in the page's language, and kept.
                    <TextInput {...p} name="name" autoComplete="off" maxLength={60} value={builtIn ? roleLabel(role, t) : name} disabled={builtIn}
                        onChange={e => { setName(e.target.value); setErrors(x => ({ ...x, name: undefined })) }} />
                )}</Field>
                <Field label={t('roles_description')}>{p => (
                    <TextArea {...p} name="description" rows={2} maxLength={500} value={description} disabled={locked} onChange={e => setDescription(e.target.value)} />
                )}</Field>
                <Field label={t('roles_base_role')} hint={t('roles_base_role_hint')}>{p => (
                    <Select {...p} name="baseRole" value={baseRole} disabled={baseFixed} onChange={e => setBaseRole(e.target.value as BaseRole)}
                        options={BASE_ROLES.map(b => ({ value: b, label: t(BUILT_IN_LABEL[b]) }))} />
                )}</Field>

                {/* A field, so Save goes to the first row still needing another (PR 372). */}
                <div className="ui-field">
                    <PermissionMatrix
                        grants={grants}
                        onChange={g => { setGrants(g); setErrors(x => ({ ...x, needs: undefined })) }}
                        disabled={locked}
                        access={access}
                        template={compareWith ? fromRows(compareWith.grants) : null}
                    />
                    {errors.needs && <span className="ui-error" role="alert">{t(errors.needs)}</span>}
                </div>

                {pairs.length > 0 && (
                    <section className="ui-dialog-note" data-tone="problem" aria-labelledby={`${id}-sod`}>
                        <h3 className="ui-subsection-title" id={`${id}-sod`}>{t('sod_title')}</h3>
                        <p>{t('sod_hint')}</p>
                        <ul>{pairs.map(key => <li key={key}>{t(`sod_${key}` as TranslationKey)}</li>)}</ul>
                        {addedPairs.length > 0 && (
                            <div className="ui-field">
                                <label className="ui-choice">
                                    <input type="checkbox" className="ui-check" name="acknowledgeConflicts" checked={acknowledged}
                                        aria-invalid={errors.acknowledge ? true : undefined} aria-describedby={errors.acknowledge ? `${id}-ack` : undefined}
                                        onChange={e => { setAcknowledged(e.target.checked); setErrors(x => ({ ...x, acknowledge: undefined })) }} />
                                    {t('sod_acknowledge')}
                                </label>
                                {errors.acknowledge && <span id={`${id}-ack`} className="ui-error">{t(errors.acknowledge)}</span>}
                            </div>
                        )}
                    </section>
                )}

                {less.length > 0 && (
                    <section className="ui-dialog-note" data-tone="waiting" aria-labelledby={`${id}-less`}>
                        <h3 className="ui-subsection-title" id={`${id}-less`}>{t('roles_less_title')}</h3>
                        <p>{t('roles_less_hint')}</p>
                        <ul>{less.map(l => <li key={`${l.permission} ${l.without}`}>{lessLine(t, l)}</li>)}</ul>
                        {addedLess.length > 0 && (
                            <div className="ui-field">
                                <label className="ui-choice">
                                    <input type="checkbox" className="ui-check" name="acknowledgeLess" checked={keptLess}
                                        aria-invalid={errors.less ? true : undefined} aria-describedby={errors.less ? `${id}-less-ack` : undefined}
                                        onChange={e => { setKeptLess(e.target.checked); setErrors(x => ({ ...x, less: undefined })) }} />
                                    {t('roles_less_acknowledge')}
                                </label>
                                {errors.less && <span id={`${id}-less-ack`} className="ui-error">{t(errors.less)}</span>}
                            </div>
                        )}
                    </section>
                )}

                {reachesHolders && (
                    <section className="ui-dialog-note" data-tone="waiting" aria-labelledby={`${id}-reach`}>
                        <h3 className="ui-subsection-title" id={`${id}-reach`}>{t('roles_affects').replace('{count}', countOf(t, locale, holders, 'employees'))}</h3>
                        <label className="ui-choice">
                            <input type="checkbox" className="ui-check" name="applyNow" checked={applyNow} onChange={e => setApplyNow(e.target.checked)} />
                            {t('roles_apply_now')}
                        </label>
                        {!applyNow && <p className="ui-hint ui-choice-hint">{t('roles_apply_later_hint')}</p>}
                    </section>
                )}

                <DialogActions>
                    {/* The built-in Admin can't be changed: there's nothing to save. */}
                    {locked ? <Button onClick={onClose}>{t('close')}</Button> : <>
                        <Button onClick={onClose} disabled={saving}>{t('cancel')}</Button>
                        <Button type="submit" variant="primary" busy={saving}>{t('save')}</Button>
                    </>}
                </DialogActions>
            </form>
        </Dialog>
    )
}
