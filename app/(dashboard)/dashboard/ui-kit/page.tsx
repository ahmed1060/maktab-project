'use client'

import { useEffect, useState } from 'react'
import {
    CalendarBlankIcon, CircleHalfIcon, ClipboardTextIcon, MapPinIcon, PlusIcon, SortAscendingIcon, TrashIcon, UserIcon,
} from '@phosphor-icons/react/ssr'
import { useViewer } from '@/lib/useCan'
import AccessDenied from '@/components/AccessDenied'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import {
    Button, ButtonLink, Card, DataList, DueDate, EmptyState, Field, FilterBar, ItemTitle, ListCard, PageHeader, Pager, Person,
    SearchInput, Select, StatusBadge, Tabs, TextInput, TotalTiles, taskStatusTone, type Column,
} from '@/components/ui'

/**
 * Every building block (DESIGN.md §5) on one page, with sample tasks, so they
 * can be looked at in both languages and both themes before any page uses
 * them. The Super Admin's only; it isn't in the side bar.
 */

type Sample = { id: string; title: [string, string]; place: [string, string]; people: [string, string][]; due: string; overdue?: boolean; pts: number; status: string }

const TASKS: Sample[] = [
    { id: '1', title: ['Collect tax card from the tax office', 'استلام البطاقة الضريبية من مصلحة الضرائب'], place: ['Tax office – Nasr City', 'مصلحة الضرائب – مدينة نصر'], people: [['Mohamed Adel', 'محمد عادل']], due: '2026-10-12', overdue: true, pts: 2, status: 'PENDING' },
    { id: '2', title: ['Renew commercial register', 'تجديد السجل التجاري'], place: ['Al Noor Trading – HQ', 'النور للتجارة – المقر الرئيسي'], people: [['Mohamed Adel', 'محمد عادل']], due: '2026-10-18', pts: 3, status: 'IN_PROGRESS' },
    { id: '3', title: ['Submit social insurance forms', 'تقديم استمارات التأمينات الاجتماعية'], place: ['Delta Foods – 6th of October branch', 'دلتا للأغذية – فرع ٦ أكتوبر'], people: [['Sara Hassan', 'سارة حسن'], ['Omar Khaled', 'عمر خالد']], due: '2026-10-20', pts: 5, status: 'PENDING_CONFIRMATION' },
    { id: '4', title: ['Open a company bank account', 'فتح حساب بنكي للشركة'], place: ['Bank branch – Heliopolis', 'فرع البنك – مصر الجديدة'], people: [['Omar Khaled', 'عمر خالد']], due: '2026-10-16', pts: 3, status: 'APPROVED' },
    { id: '5', title: ['Notarize the power of attorney', 'توثيق التوكيل'], place: ['Notary office – Dokki', 'الشهر العقاري – الدقي'], people: [['Youssef Nabil', 'يوسف نبيل']], due: '2026-10-13', pts: 2, status: 'REJECTED' },
]

const TEXT = {
    en: {
        page: 'Building blocks', title: 'Tasks', subtitle: 'Manage team tasks, deadlines, and project progress', create: 'Create new task',
        search: 'Search tasks…', employee: 'Employee', allEmployees: 'All employees', status: 'Status', allStatuses: 'All statuses', sort: 'Sort by', smart: 'Smart sort (status)',
        tabs: 'Which tasks', all: 'All tasks', mine: 'My tasks', task: 'Task', assignee: 'Assignee', deadline: 'Deadline', difficulty: 'Difficulty', actions: 'Actions',
        results: '18 tasks', start: 'Start', next: 'Continue', view: 'View',
        pending: 'Pending', progress: 'In Progress', waiting: 'Pending Confirmation', done: 'Completed', rejected: 'Rejected', approved: 'Approved',
        tiles: ['Pending', 'In progress', 'Waiting for confirmation', 'Overdue'],
        buttons: 'Buttons', primary: 'Primary', secondary: 'Secondary', quiet: 'Quiet', danger: 'Delete client', small: 'In a row', busy: 'Saving…', disabled: 'Not allowed',
        form: 'A form', name: 'Client name', nameHint: 'As it appears on their commercial register.', code: 'Tax number', codeError: 'Enter the 9 digits on the tax card.',
        badges: 'Status badges', empty: 'No tasks yet', emptyAction: 'Create a task', pts: (n: number) => n === 1 ? '1 pt' : `${n} pts`,
    },
    ar: {
        page: 'مكونات الواجهة', title: 'المهام', subtitle: 'إدارة مهام الفريق والمواعيد النهائية وتقدم المشروع', create: 'إنشاء مهمة جديدة',
        search: 'بحث في المهام…', employee: 'الموظف', allEmployees: 'كل الموظفين', status: 'الحالة', allStatuses: 'جميع الحالات', sort: 'ترتيب حسب', smart: 'ترتيب ذكي (الحالة)',
        tabs: 'أي المهام', all: 'كل المهام', mine: 'مهامي', task: 'المهمة', assignee: 'المكلف', deadline: 'الموعد النهائي', difficulty: 'الصعوبة', actions: 'الإجراءات',
        results: '١٨ مهمة', start: 'بدء', next: 'متابعة', view: 'عرض',
        pending: 'معلق', progress: 'قيد التنفيذ', waiting: 'بانتظار التأكيد', done: 'مكتمل', rejected: 'مرفوض', approved: 'مقبول',
        tiles: ['معلقة', 'قيد التنفيذ', 'بانتظار التأكيد', 'متأخرة'],
        buttons: 'الأزرار', primary: 'أساسي', secondary: 'ثانوي', quiet: 'هادئ', danger: 'حذف العميل', small: 'داخل صف', busy: 'جارٍ الحفظ…', disabled: 'غير مسموح',
        form: 'نموذج', name: 'اسم العميل', nameHint: 'كما يظهر في السجل التجاري.', code: 'الرقم الضريبي', codeError: 'أدخل الأرقام التسعة الموجودة على البطاقة الضريبية.',
        badges: 'حالات', empty: 'لا توجد مهام بعد', emptyAction: 'إنشاء مهمة', pts: (n: number) => n === 1 ? 'نقطة واحدة' : n === 2 ? 'نقطتان' : `${n.toLocaleString('ar-EG')} نقاط`,
    },
}

export default function UiKitPage() {
    const viewer = useViewer()
    const { locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const ar = locale === 'ar'
    const s = TEXT[ar ? 'ar' : 'en']
    const [tab, setTab] = useState<'all' | 'mine'>('all')
    const [page, setPage] = useState(1)
    const [query, setQuery] = useState('')
    const [status, setStatus] = useState('')

    useEffect(() => {
        setTitle(s.page)
        setSubtitle(null)
        return () => { setTitle(null); setSubtitle(null) }
    }, [s.page, setTitle, setSubtitle])

    if (viewer?.role !== 'SUPER_ADMIN') return <AccessDenied />

    const pick = (pair: [string, string]) => pair[ar ? 1 : 0]
    const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' })
    const statusWord: Record<string, string> = {
        PENDING: s.pending, IN_PROGRESS: s.progress, PENDING_CONFIRMATION: s.waiting, APPROVED: s.approved, COMPLETED: s.done, REJECTED: s.rejected,
    }
    const action = (t: Sample) => t.status === 'PENDING' || t.status === 'IN_PROGRESS'
        ? <Button variant="primary" size="sm">{t.status === 'PENDING' ? s.start : s.next}</Button>
        : <Button size="sm">{s.view}</Button>
    const people = (t: Sample) => <Person names={t.people.map(pick)} moreLabel={n => `+${n.toLocaleString(ar ? 'ar-EG' : 'en-GB')}`} />
    const pts = (n: number) => <span className="ui-chip">{s.pts(n)}</span>

    const columns: Column<Sample>[] = [
        { key: 'task', header: s.task, cell: t => <ItemTitle title={pick(t.title)} detail={pick(t.place)} detailIcon={MapPinIcon} /> },
        { key: 'who', header: s.assignee, cell: people },
        { key: 'due', header: s.deadline, cell: t => <DueDate overdue={t.overdue}>{day(t.due)}</DueDate> },
        { key: 'pts', header: s.difficulty, cell: t => pts(t.pts) },
        { key: 'status', header: s.status, cell: t => <StatusBadge tone={taskStatusTone(t.status)}>{statusWord[t.status]}</StatusBadge> },
        { key: 'action', header: s.actions, hideHeader: true, align: 'end', cell: action },
    ]

    return (
        <div style={{ background: 'var(--page)', padding: 'clamp(var(--space-4), 4vw, var(--space-8))', borderRadius: 'var(--radius-panel)', display: 'grid', gap: 'var(--space-6)' }}>
            <PageHeader title={s.title} subtitle={s.subtitle} action={<ButtonLink href="#" variant="primary" icon={PlusIcon}>{s.create}</ButtonLink>} />

            <TotalTiles items={s.tiles.map((label, i) => ({ label, value: [6, 4, 2, 1][i].toLocaleString(ar ? 'ar-EG' : 'en-GB') }))} />

            <Tabs label={s.tabs} value={tab} onChange={setTab} idPrefix="kit-tab" items={[{ value: 'all', label: s.all }, { value: 'mine', label: s.mine }]} />

            <FilterBar
                search={<Field label={s.search} hideLabel>{p => <SearchInput {...p} placeholder={s.search} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                activeCount={status ? 1 : 0}
                onReset={() => { setQuery(''); setStatus('') }}
            >
                <Field label={s.employee} hideLabel>{p => <Select {...p} icon={UserIcon} options={[{ value: '', label: s.allEmployees }]} />}</Field>
                <Field label={s.status} hideLabel>{p => (
                    <Select {...p} icon={CircleHalfIcon} value={status} onChange={e => setStatus(e.target.value)}
                        options={[{ value: '', label: s.allStatuses }, ...Object.entries(statusWord).map(([value, label]) => ({ value, label }))]} />
                )}</Field>
                <Field label={s.sort} hideLabel>{p => <Select {...p} icon={SortAscendingIcon} options={[{ value: 'smart', label: s.smart }]} />}</Field>
            </FilterBar>

            <DataList
                caption={s.title}
                columns={columns}
                rows={TASKS}
                rowKey={t => t.id}
                tone={t => t.overdue ? 'overdue' : undefined}
                card={t => (
                    <ListCard
                        title={pick(t.title)}
                        status={<StatusBadge tone={taskStatusTone(t.status)}>{statusWord[t.status]}</StatusBadge>}
                        details={[{ icon: MapPinIcon, text: pick(t.place) }]}
                        foot={<>{people(t)}<span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}><DueDate overdue={t.overdue}>{day(t.due)}</DueDate>{pts(t.pts)}</span></>}
                    />
                )}
                footer={<Pager page={page} pageCount={3} onPage={setPage} summary={s.results} />}
            />

            <Card title={s.buttons}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center' }}>
                    <Button variant="primary" icon={PlusIcon}>{s.primary}</Button>
                    <Button>{s.secondary}</Button>
                    <Button variant="quiet">{s.quiet}</Button>
                    <Button variant="danger" icon={TrashIcon}>{s.danger}</Button>
                    <Button size="sm">{s.small}</Button>
                    <Button variant="primary" busy>{s.busy}</Button>
                    <Button disabled>{s.disabled}</Button>
                </div>
            </Card>

            <Card title={s.badges}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                    {Object.entries(statusWord).map(([key, word]) => <StatusBadge key={key} tone={taskStatusTone(key)}>{word}</StatusBadge>)}
                </div>
            </Card>

            <Card title={s.form}>
                <div style={{ display: 'grid', gap: 'var(--space-4)', maxWidth: 720 }}>
                    <Field label={s.name} hint={s.nameHint}>{p => <TextInput {...p} defaultValue={ar ? 'النور للتجارة' : 'Al Noor Trading'} />}</Field>
                    <Field label={s.code} error={s.codeError}>{p => <TextInput {...p} inputMode="numeric" defaultValue="12345" />}</Field>
                    <Field label={s.deadline}>{p => <TextInput {...p} icon={CalendarBlankIcon} type="date" defaultValue="2026-10-20" />}</Field>
                </div>
            </Card>

            <div className="ui-panel">
                <EmptyState icon={ClipboardTextIcon} title={s.empty} action={<Button variant="primary" icon={PlusIcon}>{s.emptyAction}</Button>} />
            </div>
        </div>
    )
}
