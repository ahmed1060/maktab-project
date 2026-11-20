'use client'

import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import MessageEditor from '@/components/client-messages/MessageEditor'
import { Button, EmptyState, Page, PageHeader } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { MESSAGE_KINDS, type NizmoMessage } from '@/lib/client-message-template'

/**
 * Client messages on WhatsApp (CLIENT_PORTAL_PLAN.md §7.1, §12 step 10b;
 * DESIGN.md §5.5; PR 347): Nizmo's own messages, which every company without
 * a copy of its own uses, for the Super Admin to change, as the owner's
 * mockup draws it (Message templates): a tab for each message, then the
 * editor (components/client-messages/MessageEditor.tsx), which a company's
 * copy shares since PR 349.
 */
export default function ClientMessagesPage() {
    const { t } = useLanguage()
    const { data: session, status } = useSession()
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

    const { data, error, isValidating, mutate } = useSWR(isSuperAdmin ? '/api/client-messages' : null, fetcher)
    const messages: NizmoMessage[] | null = data ? data.data?.messages ?? [] : null

    if (status === 'loading') return null
    if (!isSuperAdmin) return <AccessDenied superAdmins />

    const header = <PageHeader title={t('cmsg_title')} subtitle={t('cmsg_hint')} />
    if (!messages) {
        return (
            <Page>
                {header}
                {error ? (
                    <div className="ui-panel">
                        <EmptyState icon={WarningCircleIcon} title={t('cmsg_load_failed')} detail={(error as SWRError).info?.error}
                            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    </div>
                ) : (
                    <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                )}
            </Page>
        )
    }

    return (
        <Page>
            {header}
            <MessageEditor
                messages={messages}
                kinds={MESSAGE_KINDS}
                saveUrl={(kind, language) => `/api/client-messages/${kind}/${language}`}
                reload={async () => (await mutate())?.data?.messages}
                noteOf={(message, day) => day ? t('cmsg_changed').replace('{name}', message.changedBy ?? '').replace('{date}', day) : t('cmsg_never_changed')}
                savedSay="cmsg_saved"
            />
        </Page>
    )
}
