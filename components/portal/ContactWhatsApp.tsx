'use client'

import { useState } from 'react'
import { ChatIcon } from '@phosphor-icons/react/ssr'
import { Button, ButtonExternal, Dialog, Field, initials } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { whatsAppLink } from '@/lib/contact-message'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'

/**
 * Contact on WhatsApp (DESIGN.md §5.5; CLIENT_PORTAL_PLAN.md §7, §12 step 9c;
 * PR 344), as the owner's mockup draws it: who it reaches, in a box; the
 * message, which can be changed; Open WhatsApp, then Cancel; and a line at
 * its foot under a rule.
 *
 * Until the message is changed, its last line says where the question goes,
 * in a quieter colour: a field can't colour one line of its own, so it's a
 * copy of the field's text laid over it, clear but for that line, which goes
 * once the person types. It's never sent. The field and the copy share one
 * cell, so the field grows with what's written, on a phone too, where the
 * message wraps.
 *
 * Open WhatsApp goes to wa.me with the message as it is now; nothing passes
 * through Nizmo. The tab opens and the dialog closes.
 */
export function ContactWhatsApp({ open, onClose, title, accountant, client, message }: {
    open: boolean
    onClose: () => void
    title: string
    /** The accountant, with a number: there's no button to open this without one. */
    accountant: { name: string; whatsappNumber: string }
    client: string
    /** Written for where it was opened from (lib/contact-message.ts). */
    message: string
}) {
    const { t } = useLanguage()
    const [text, setText] = useState(message)
    // Each time it opens, the message as written for it.
    useAdjustOnChange([open, message], () => setText(message))
    const rows = message.split('\n').length + 1
    const [before, after = ''] = t('contact_accountant_for').split('{client}')

    return (
        <Dialog open={open} onClose={onClose} title={title} closable className="ui-contact-dialog">
            <div className="ui-contact-who">
                <span className="ui-contact-mark" aria-hidden="true">{initials(accountant.name)}</span>
                <div className="ui-contact-who-text">
                    <p className="ui-contact-name">{accountant.name}</p>
                    {/* The client's name kept apart from the words around it, in whichever script it's written. */}
                    <p className="ui-contact-role">{before}<bdi>{client}</bdi>{after}</p>
                </div>
            </div>
            <Field label={t('contact_message_label')} hint={t('contact_message_hint')}>
                {control => (
                    <div className="ui-contact-message">
                        <textarea {...control} className="ui-input ui-textarea ui-contact-text" name="message" autoComplete="off" rows={rows} value={text} onChange={event => setText(event.target.value)} />
                        <div className="ui-input ui-textarea ui-contact-ghost" aria-hidden="true">
                            {`${text}\n`}{text === message ? <span className="ui-contact-ghost-hint">{t('contact_question_here')}</span> : ' '}
                        </div>
                    </div>
                )}
            </Field>
            <div className="ui-contact-actions">
                <ButtonExternal variant="primary" icon={ChatIcon} href={whatsAppLink(accountant.whatsappNumber, text)} onClick={onClose}>
                    {t('contact_open_whatsapp')}
                </ButtonExternal>
                <Button onClick={onClose}>{t('cancel')}</Button>
            </div>
            <p className="ui-contact-foot">{t('contact_foot')}</p>
        </Dialog>
    )
}
