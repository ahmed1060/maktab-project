// F-23: split out of tasks/[id]/client.tsx so the sections that got
// extracted into their own components (TaskCostsSection,
// TaskLocationHistorySection) can use it too, without duplicating it.
export default function TrashIcon({ size = 18, color = "#ef4444" }: { size?: number, color?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 8H19L18.1 20.2C18.05 20.65 17.65 21 17.2 21H6.8C6.35 21 5.95 20.65 5.9 20.2L5 8Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 11V18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 2" />
            <path d="M14 11V18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 2" />
            <path d="M8 5V3H16V5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 8H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}
