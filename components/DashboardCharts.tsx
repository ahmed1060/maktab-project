'use client'
import { useLanguage } from '@/context/LanguageContext'



interface DonutChartProps {
    data: { label: string; value: number; color: string }[]
    title: string
}

export function DonutChart({ data, title }: DonutChartProps) {
    const { t } = useLanguage()
    const total = data.reduce((acc, item) => acc + item.value, 0)
    const radius = 35
    const strokeWidth = 10
    const center = 50

    if (total === 0) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-faint)' }}>{t('no_data_available')}</div>
            </div>
        )
    }

    // Where each segment starts, worked out before rendering rather than
    // accumulated inside the .map that draws them. A running total mutated
    // during render only works while the whole map re-runs, in order, every
    // time; the React Compiler is free to cache pieces of a render, and then
    // the sum drifts and the segments land at the wrong angles.
    const percentages = data.map(item => (item.value / total) * 100)
    const startsAt = percentages.map((_, i) => percentages.slice(0, i).reduce((a, b) => a + b, 0))

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--text-main)' }}>{title}</h4>
            <div style={{ position: 'relative', width: '160px', height: '160px' }}>
                <svg viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)', filter: 'drop-shadow(0 4px 6px var(--shadow-weak))' }}>
                    {data.map((item, idx) => {
                        const percentage = percentages[idx]
                        const dashArray = (percentage * 2 * Math.PI * radius) / 100
                        const dashOffset = -(startsAt[idx] * 2 * Math.PI * radius) / 100

                        return (
                            <circle
                                key={idx}
                                cx={center}
                                cy={center}
                                r={radius}
                                fill="transparent"
                                stroke={item.color}
                                strokeWidth={strokeWidth}
                                strokeDasharray={`${dashArray} ${2 * Math.PI * radius}`}
                                strokeDashoffset={dashOffset}
                                style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
                            />
                        )
                    })}
                </svg>
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center'
                }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-main)' }}>{total}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-soft)', fontWeight: 'bold' }}>{t('total_label')}</div>
                </div>
            </div>
            <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', width: '100%' }}>
                {data.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: item.color }} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>
                            {item.label}: <strong>{item.value}</strong>
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}

interface StatMetricProps {
    label: string
    value: string | number
    icon: string
    color: string
    percentage?: number
    subLabel?: string
}

export function StatMetric({ label, value, icon, color, percentage, subLabel }: StatMetricProps) {
    const { t } = useLanguage()
    return (
        <div className="glass-card" style={{ padding: '1.25rem', borderLeft: `4px solid ${color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.75rem' }}>
                <div style={{ minWidth: 0 }}>
                    {/* Two lines' worth of room whether or not the label needs
                        it. Without this a one-line label ("Total Users") puts
                        its number higher than a two-line one ("Total
                        Companies") sitting beside it, and the row reads as
                        misaligned rather than as two tiles. */}
                    <div style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-soft)',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        lineHeight: 1.25,
                        minHeight: '2.5em',
                    }}>{label}</div>
                    <div style={{ fontSize: '1.75rem', fontWeight: '800', color: 'var(--text-main)', marginTop: '0.25rem' }}>{value}</div>
                </div>
                <div style={{
                    width: '40px',
                    height: '40px',
                    flexShrink: 0,
                    // color-mix rather than appending "15" as a hex alpha
                    // channel. That trick only works when `color` is a literal
                    // hex: once it is a custom property — which is the whole point
                    // of D1 — a token followed by "15" is not a colour at all and the
                    // background silently disappears. 0x15/255 is ~8%.
                    background: `color-mix(in srgb, ${color} 8%, transparent)`,
                    borderRadius: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.25rem'
                }}>
                    {icon}
                </div>
            </div>
            {percentage !== undefined && (
                <div style={{ marginTop: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.4rem', fontWeight: '700' }}>
                        <span style={{ color: 'var(--text-soft)' }}>{subLabel || t('completion_rate')}</span>
                        <span style={{ color: color }}>{percentage}%</span>
                    </div>
                    <div style={{ height: '6px', background: 'var(--surface-sunk)', borderRadius: '10px', overflow: 'hidden' }}>
                        <div style={{
                            height: '100%',
                            width: `${percentage}%`,
                            background: color,
                            borderRadius: '10px',
                            transition: 'width 0.8s ease-out'
                        }} />
                    </div>
                </div>
            )}
            {subLabel && percentage === undefined && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: '0.5rem', fontStyle: 'italic' }}>
                    {subLabel}
                </div>
            )}
        </div>
    )
}
