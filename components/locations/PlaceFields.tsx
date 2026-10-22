'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { Field, TextInput } from '@/components/ui'
import LocationSearchInput from '@/components/LocationSearchInput'
import PointPicker from '@/components/PointPicker'
import { LOCATION_NAME_MAX, LOCATION_RADIUS_DEFAULT, LOCATION_RADIUS_MAX, LOCATION_RADIUS_MIN } from '@/lib/locations'
import { pinOfLink, type PlaceDraft, type PlaceErrors } from '@/lib/place-draft'

/**
 * A place on the map (DESIGN.md §5.3): its name, a place search that drops
 * the pin, the pin itself with "Use my current location" and "Pick on the
 * map", and its check radius. The same map as the check-in places.
 */
export default function PlaceFields({ draft, onChange, errors, nameLabel, nameHint, disabled = false }: {
    draft: PlaceDraft
    onChange: (draft: PlaceDraft) => void
    /** Shown once a save has been tried. */
    errors: PlaceErrors
    nameLabel?: string
    nameHint?: string
    disabled?: boolean
}) {
    const { t, locale } = useLanguage()
    const [search, setSearch] = useState({ name: '', link: '' })
    const set = (change: Partial<PlaceDraft>) => onChange({ ...draft, ...change })
    const radius = Number(draft.radius) || LOCATION_RADIUS_DEFAULT

    return (
        <>
            {/* Names keep their own direction, whichever language the page is in (DESIGN.md §7). */}
            <Field
                label={nameLabel ?? t('location_name')}
                hint={nameHint ?? t('location_name_hint')}
                error={errors.name && t('location_name_required')}
            >{p => <TextInput {...p} name="locationName" autoComplete="off" dir="auto" maxLength={LOCATION_NAME_MAX} value={draft.name} onChange={e => set({ name: e.target.value })} disabled={disabled} />}</Field>
            <LocationSearchInput
                blocks
                label={t('location_search')}
                value={search}
                onChange={found => {
                    setSearch(found)
                    // A place picked from the search drops the pin there, and
                    // names a place that has no name yet.
                    const pin = pinOfLink(found.link)
                    if (pin) set({ point: pin, name: draft.name.trim() ? draft.name : found.name })
                }}
                placeholder={t('location_search_placeholder')}
                locale={locale}
            />
            <Field
                label={t('location_pin')}
                hint={t('att_loc_point_hint')}
                error={errors.point === 'required' ? t('location_pin_required') : errors.point === 'invalid' ? t('att_loc_point_invalid') : undefined}
            >{p => (
                <TextInput {...p} name="pin" autoComplete="off" dir="ltr" inputMode="decimal" placeholder="30.0444, 31.2357" value={draft.point} onChange={e => set({ point: e.target.value })} disabled={disabled} />
            )}</Field>
            <PointPicker blocks value={draft.point} radius={radius} onChange={point => set({ point })} />
            <Field
                label={t('location_radius')}
                hint={t('location_radius_hint')}
                error={errors.radius && t('location_radius_invalid')}
            >{p => (
                <TextInput {...p} name="radius" autoComplete="off" type="number" inputMode="numeric" min={LOCATION_RADIUS_MIN} max={LOCATION_RADIUS_MAX} step={10} placeholder={String(LOCATION_RADIUS_DEFAULT)} value={draft.radius} onChange={e => set({ radius: e.target.value })} disabled={disabled} />
            )}</Field>
        </>
    )
}
