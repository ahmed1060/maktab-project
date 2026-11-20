'use client'

import useSWR from 'swr'
import { HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import MessageEditor from '@/components/client-messages/MessageEditor'
import { Button, EmptyState, Page, PageHeader } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useViewer } from '@/lib/useCan'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import type { CompanyMessage, MessageKind } from '@/lib/client-message-template'
import { MESSAGE_NAME, clientPortalTabHref, companyMessageApi, companyMessagesApi } from '@/lib/client-message-pages'

/**
 * A company's copy of one client message on WhatsApp, on a page of its own
 * (CLIENT_PORTAL_PLAN.md §7.1, step 10c-2; DESIGN.md §5.5, A company's
 * client messages; PR 349): the Super Admin's editor for that one message,
 * opened from the Client portal tab. For the company's own people, on
 * their settings, the server reading their own company; and for the Super
 * Admin, on the company's settings, for the company named. The server
 * refuses anyone without client_messages.manage.
 */
export default function CompanyMessagePage({ kind, companyId }: { kind: MessageKind; companyId?: string }) {
    const { t } = useLanguage()
    // Who is looking comes from the layout on the first paint, so neither page flashes refused while the session loads.
    const viewer = useViewer()
    const superAdmin = companyId !== undefined
    // The company asked for, for the Super Admin; none for its own people, whose own the server reads.
    const scope = companyId ?? null
    const allowed = superAdmin ? viewer?.role === 'SUPER_ADMIN' : !!viewer && viewer.role !== 'SUPER_ADMIN'
    const { data, error, isValidating, mutate } = useSWR(allowed ? companyMessagesApi(scope) : null, fetcher)
    const messages: CompanyMessage[] | null = data ? data.data?.messages ?? [] : null

    if (superAdmin && viewer?.role !== 'SUPER_ADMIN') return <AccessDenied superAdmins />
    // The Super Admin has no company of their own: they open a company's from its settings.
    if (!allowed) return <AccessDenied />
    // Refused for want of the permission: there is nothing to try again. A package without the client portal says so instead.
    const failed = error as SWRError | undefined
    if ((failed?.status === 401 || failed?.status === 403) && failed.info?.code !== 'CLIENT_PORTAL_NOT_IN_PACKAGE') return <AccessDenied />

    const header = (
        <PageHeader
            back={{ href: clientPortalTabHref(companyId ?? '', superAdmin), label: t('settings_tab_client_portal') }}
            title={t(MESSAGE_NAME[kind])}
            subtitle={t('cmsg_company_page_hint')}
        />
    )
    if (!messages) {
        return (
            <Page>
                {header}
                {failed ? (
                    <div className="ui-panel">
                        <EmptyState icon={WarningCircleIcon} title={t('cmsg_load_failed')} detail={failed.info?.error}
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
                // Started afresh for another message.
                key={kind}
                messages={messages}
                kinds={[kind]}
                saveUrl={(kind, language) => companyMessageApi(scope, kind, language)}
                reload={async () => (await mutate())?.data?.messages}
                noteOf={(message, day) => message.own
                    ? t('cmsg_company_own_note').replace('{name}', message.changedBy ?? '').replace('{date}', day ?? '')
                    : t('cmsg_company_nizmo_note')}
                savedSay="cmsg_company_saved"
            />
        </Page>
    )
}
