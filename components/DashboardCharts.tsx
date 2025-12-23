'use client'



interface DonutChartProps {
    data: { label: string; value: number; color: string }[]
    title: string
}

export function DonutChart({ data, title }: DonutChartProps) {
    const total = data.reduce((acc, item) => acc + item.value, 0)
    let currentAngle = 0
    const radius = 35
    const strokeWidth = 10
    const center = 50

    if (total === 0) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>No data available</div>
            </div>
        )
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: '#1e293b' }}>{title}</h4>
            <div style={{ position: 'relative', width: '160px', height: '160px' }}>
                <svg viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}>
                    {data.map((item, idx) => {
                        const percentage = (item.value / total) * 100
                        const dashArray = (percentage * 2 * Math.PI * radius) / 100
                        const dashOffset = -(currentAngle * 2 * Math.PI * radius) / 100
                        currentAngle += percentage

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
                    <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#1e293b' }}>{total}</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold' }}>TOTAL</div>
                </div>
            </div>
            <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', width: '100%' }}>
                {data.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: item.color }} />
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
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
    return (
        <div className="glass-card" style={{ padding: '1.25rem', borderLeft: `4px solid ${color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.75rem' }}>
                <div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                    <div style={{ fontSize: '1.75rem', fontWeight: '800', color: '#1e293b', marginTop: '0.25rem' }}>{value}</div>
                </div>
                <div style={{
                    width: '40px',
                    height: '40px',
                    background: `${color}15`,
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
                        <span style={{ color: '#64748b' }}>{subLabel || 'Completion Rate'}</span>
                        <span style={{ color: color }}>{percentage}%</span>
                    </div>
                    <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '10px', overflow: 'hidden' }}>
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
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.5rem', fontStyle: 'italic' }}>
                    {subLabel}
                </div>
            )}
        </div>
    )
}
