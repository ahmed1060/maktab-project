'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'
import { useLanguage } from '@/context/LanguageContext'
import { hereAttribution, hereProviders, hereTileUrl, loadHereCopyrights, type HereStyle } from '@/lib/here-tiles'
import { fixStillWanted, formatPoint, locateErrorKey, MAX_ACCURACY_METERS, parsePoint } from '@/lib/attendance/geo'

/**
 * Two more ways to fill a check-in place's "lat, lng" field, beside typing or
 * pasting it: where this device is now, or a pin on a map. Both write the
 * same text into the field, so the field stays the one thing that is saved.
 *
 * The map is HERE's (the same key as the place search), drawn with Leaflet,
 * as a street map or satellite imagery. Clicking puts the pin
 * there; the pin can be dragged; the circle shows the radius. Without a
 * mouse, the arrow keys move the map and "Pin the centre" drops the pin
 * under the cross in the middle.
 */

const CAIRO: [number, number] = [30.0444, 31.2357]

type Status = { kind: 'accuracy'; meters: number; text: string } | { kind: 'error'; key: ReturnType<typeof locateErrorKey> | 'att_loc_here_unsupported' }

export default function PointPicker({ value, radius, onChange }: { value: string; radius: number; onChange: (text: string) => void }) {
    const { t, locale } = useLanguage()
    const hereKey = process.env.NEXT_PUBLIC_HERE_API_KEY
    const [mapOpen, setMapOpen] = useState(false)
    const [locating, setLocating] = useState(false)
    const [status, setStatus] = useState<Status | null>(null)
    const [drawn, setDrawn] = useState(0)

    const box = useRef<HTMLDivElement>(null)
    const leaflet = useRef<{ L: typeof Leaflet; map: Leaflet.Map } | null>(null)
    const pin = useRef<Leaflet.Marker | null>(null)
    const ring = useRef<Leaflet.Circle | null>(null)
    const latest = useRef({ value, onChange })
    useEffect(() => { latest.current = { value, onChange } })
    const alive = useRef(true)
    // Set again on each mount: React may mount, unmount and remount (strict mode).
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

    const put = (lat: number, lng: number) => latest.current.onChange(formatPoint(lat, lng))

    // The latest request for this device's position: a newer one, or a point
    // typed or picked while waiting, makes an earlier answer stale.
    const request = useRef(0)
    // Every change to the field, typed, picked or dragged, counted.
    const edits = useRef(0)
    useEffect(() => { edits.current++ }, [value])

    const locate = () => {
        if (!navigator.geolocation) return setStatus({ kind: 'error', key: 'att_loc_here_unsupported' })
        const asked = { request: ++request.current, edits: edits.current }
        const wanted = () => alive.current && fixStillWanted(asked, { request: request.current, edits: edits.current })
        setLocating(true)
        setStatus(null)
        navigator.geolocation.getCurrentPosition(
            pos => {
                if (!alive.current || asked.request !== request.current) return
                setLocating(false)
                if (!wanted()) return
                const text = formatPoint(pos.coords.latitude, pos.coords.longitude)
                setStatus({ kind: 'accuracy', meters: Math.round(pos.coords.accuracy), text })
                latest.current.onChange(text)
            },
            err => {
                if (!alive.current || asked.request !== request.current) return
                setLocating(false)
                if (!wanted()) return
                setStatus({ kind: 'error', key: locateErrorKey(err.code) })
            },
            // A fresh, satellite-grade fix: an old or network-only one could be far off.
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
        )
    }

    // Draw the map while it's open. Leaflet needs the browser, so it's loaded here.
    useEffect(() => {
        if (!mapOpen) return
        let cancelled = false
        let map: Leaflet.Map | null = null
        import('leaflet').then(mod => {
            const L = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as typeof Leaflet)
            if (cancelled || !box.current) return
            const start = parsePoint(latest.current.value)
            map = L.map(box.current, { center: start ? [start.latitude, start.longitude] : CAIRO, zoom: start ? 17 : 11 })
            const layer = (style: HereStyle) => L.tileLayer(hereTileUrl(style, locale, hereKey!), { maxZoom: 20 })
            const street = layer('map').addTo(map)
            L.control.layers({ [t('att_loc_layer_map')]: street, [t('att_loc_layer_satellite')]: layer('satellite') }, undefined, { position: 'topright' }).addTo(map)
            // HERE's notice names the suppliers for the style, zoom and area showing.
            let style: HereStyle = 'map'
            let notice = ''
            const credit = () => {
                if (!map) return
                const m = map
                loadHereCopyrights(hereKey!).then(list => {
                    if (cancelled || map !== m) return
                    const b = m.getBounds()
                    const view = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }
                    const next = hereAttribution(new Date().getFullYear(), list ? hereProviders(list, style, m.getZoom(), view) : [])
                    if (next === notice) return
                    m.attributionControl.removeAttribution(notice).addAttribution(next)
                    notice = next
                })
            }
            map.on('baselayerchange', e => { style = e.layer === street ? 'map' : 'satellite' })
            map.on('moveend zoomend baselayerchange', credit)
            credit()
            map.on('click', e => put(e.latlng.lat, e.latlng.lng))
            leaflet.current = { L, map }
            setDrawn(n => n + 1)
        })
        return () => {
            cancelled = true
            map?.remove()
            leaflet.current = null
            pin.current = null
            ring.current = null
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drawn once per opening, in the language it opened in
    }, [mapOpen])

    // Keep the pin and circle on the field's point, however it was set.
    useEffect(() => {
        const lf = leaflet.current
        if (!lf) return
        const p = parsePoint(value)
        if (!p) {
            pin.current?.remove(); pin.current = null
            ring.current?.remove(); ring.current = null
            return
        }
        const at: [number, number] = [p.latitude, p.longitude]
        if (pin.current) pin.current.setLatLng(at)
        else {
            pin.current = lf.L.marker(at, {
                draggable: true,
                title: t('att_loc_pin'),
                alt: t('att_loc_pin'),
                icon: lf.L.divIcon({ className: 'map-pin', iconSize: [22, 22], iconAnchor: [11, 11] }),
            }).addTo(lf.map)
            pin.current.on('dragend', () => { const ll = pin.current!.getLatLng(); put(ll.lat, ll.lng) })
        }
        if (radius > 0) {
            if (ring.current) ring.current.setLatLng(at).setRadius(radius)
            else ring.current = lf.L.circle(at, { radius, className: 'map-ring', weight: 2, fillOpacity: 0.12, interactive: false }).addTo(lf.map)
        } else { ring.current?.remove(); ring.current = null }
        // Typed or found somewhere off screen: bring it into view.
        if (!lf.map.getBounds().contains(at)) lf.map.setView(at, Math.max(lf.map.getZoom(), 16))
    }, [value, radius, drawn, t])

    const pinCentre = () => {
        const c = leaflet.current?.map.getCenter()
        if (c) put(c.lat, c.lng)
    }

    const shown = status && (status.kind === 'error' || status.text === value) ? status : null

    return (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} disabled={locating} onClick={locate}>
                    {locating ? t('att_loc_here_busy') : t('att_loc_here')}
                </button>
                {/* No key, no map: the HERE key is what draws it. */}
                {hereKey && (
                    <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} aria-expanded={mapOpen} onClick={() => setMapOpen(o => !o)}>
                        {mapOpen ? t('att_loc_pick_close') : t('att_loc_pick')}
                    </button>
                )}
            </div>
            <span role="status" style={{ fontSize: '0.75rem', color: shown?.kind === 'error' || (shown?.kind === 'accuracy' && shown.meters > Math.max(MAX_ACCURACY_METERS, radius)) ? 'var(--danger-fg)' : 'var(--text-soft)' }}>
                {shown?.kind === 'error' && t(shown.key)}
                {shown?.kind === 'accuracy' && (shown.meters > Math.max(MAX_ACCURACY_METERS, radius)
                    ? t('att_loc_here_rough').replace('{n}', String(shown.meters))
                    : t('att_loc_here_found').replace('{n}', String(shown.meters)))}
            </span>
            {mapOpen && hereKey && (
                <div style={{ display: 'grid', gap: '0.4rem' }}>
                    <div style={{ position: 'relative', isolation: 'isolate' }} dir="ltr">
                        <div ref={box} aria-label={t('att_loc_map_label')} style={{ height: '18rem', borderRadius: '0.75rem', border: '1px solid var(--field-border)' }} />
                        {/* The centre of the map, where "Pin the centre" puts the pin. */}
                        <span aria-hidden="true" className="map-cross" />
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={pinCentre}>{t('att_loc_pin_centre')}</button>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>{t('att_loc_pick_hint')}</span>
                    </div>
                </div>
            )}
        </div>
    )
}
