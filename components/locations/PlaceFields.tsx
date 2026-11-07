'use client'

import { useLanguage } from '@/context/LanguageContext'
import { Field, TextInput } from '@/components/ui'
import PointPicker from '@/components/PointPicker'
import { LOCATION_NAME_MAX, LOCATION_RADIUS_DEFAULT, LOCATION_RADIUS_MAX, LOCATION_RADIUS_MIN } from '@/lib/locations'
import type { PlaceDraft, PlaceErrors } from '@/lib/place-draft'
import PlaceSearch from './PlaceSearch'

/**
 * A place on the map (DESIGN.md §5.3): its name, a place search that drops
 * the pin, the pin itself with "Use my current location" and "Pick on the
 * map" right below it, and its check radius. The same map as the check-in
 * places.
 */
export default function PlaceFields({ draft, onChange, errors, nameLabel, nameHint, disabled = false, locked = false }: {
    draft: PlaceDraft
    onChange: (draft: PlaceDraft) => void
    /** Shown once a save has been tried. */
    errors: PlaceErrors
    nameLabel?: string
    nameHint?: string
    disabled?: boolean
    /** Shown as it is, for someone who may not change it: no place search or map either. */
    locked?: boolean
}) {
    const { t } = useLanguage()
    const set = (change: Partial<PlaceDraft>) => onChange({ ...draft, ...change })
    const radius = Number(draft.radius) || LOCATION_RADIUS_DEFAULT
    const off = disabled || locked

    return (
        <>
            {/* Names keep their own direction, whichever language the page is in (DESIGN.md §7). */}
            <Field
                label={nameLabel ?? t('location_name')}
                hint={nameHint ?? t('location_name_hint')}
                error={errors.name && t('location_name_required')}
            >{p => <TextInput {...p} name="locationName" autoComplete="off" dir="auto" maxLength={LOCATION_NAME_MAX} value={draft.name} onChange={e => set({ name: e.target.value })} disabled={off} />}</Field>
            {/* A place picked from the search drops the pin there, and names a place that has no name yet. */}
            {!locked && <Field label={t('location_search')}>{p => <PlaceSearch {...p} placeholder={t('location_search_placeholder')} onPick={place => set({ point: place.point, name: draft.name.trim() ? draft.name : place.name })} />}</Field>}
            {/* The pin, with its buttons right below it. */}
            <div className="ui-field">
                <Field
                    label={t('location_pin')}
                    // It points to the buttons, which a locked place doesn't have.
                    hint={locked ? undefined : t('att_loc_point_hint')}
                    error={errors.point === 'required' ? t('location_pin_required') : errors.point === 'invalid' ? t('att_loc_point_invalid') : undefined}
                >{p => (
                    <TextInput {...p} name="pin" autoComplete="off" dir="ltr" inputMode="decimal" placeholder="30.0444, 31.2357" value={draft.point} onChange={e => set({ point: e.target.value })} disabled={off} />
                )}</Field>
                {!locked && <PointPicker value={draft.point} radius={radius} onChange={point => set({ point })} />}
            </div>
            <Field
                label={t('location_radius')}
                hint={t('location_radius_hint')}
                error={errors.radius && t('location_radius_invalid')}
            >{p => (
                <TextInput {...p} name="radius" autoComplete="off" type="number" inputMode="numeric" min={LOCATION_RADIUS_MIN} max={LOCATION_RADIUS_MAX} step={10} placeholder={String(LOCATION_RADIUS_DEFAULT)} value={draft.radius} onChange={e => set({ radius: e.target.value })} disabled={off} />
            )}</Field>
        </>
    )
}
