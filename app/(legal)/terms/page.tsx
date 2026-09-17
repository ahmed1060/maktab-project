import type { Metadata } from 'next'

export const metadata: Metadata = {
    title: 'Terms of Service — Nizmo',
    description: 'The terms under which companies and their staff use Nizmo.',
}

/**
 * Companion to /privacy. Google's consent screen does not require this one —
 * only the privacy policy is on its list — but the two were written together
 * on purpose: they share a layout, they are read by the same person in the
 * same sitting, and a terms page written six months later never gets the
 * same care as one written alongside the policy it refers to.
 *
 * The subscription section describes the billing model already in the schema
 * (Package with monthly and annual prices, a trial, CompanyPayment, and the
 * locked state a lapsed company lands in), not an aspirational one.
 */
export default function TermsOfService() {
    return (
        <>
            <h1>Terms of Service</h1>
            <p className="legal-updated">Last updated 17 September 2026</p>

            <p className="legal-lede">
                These terms cover the use of Nizmo. They apply both to the company that subscribes and
                to the people it gives accounts to.
            </p>

            <h2>Agreeing to these terms</h2>
            <p>
                Using Nizmo means accepting these terms. If you are accepting them for a company, you
                are confirming that you are allowed to commit that company to them.
            </p>
            <p>
                If you were given an account by your employer, these terms still apply to you, but the
                agreement about payment and data is between us and your employer, not with you.
            </p>

            <h2>Accounts</h2>
            <p>
                Accounts are created by a company administrator and belong to the company, not to the
                person using them. Sign-in details are personal and must not be shared. Tell your
                administrator immediately if you think someone else has your password.
            </p>
            <p>
                Everything done through an account is treated as done by its holder, which is why the
                audit log records the account rather than the device.
            </p>

            <h2>What you may not do</h2>
            <ul>
                <li>Use Nizmo to break the law, or to hold data you have no right to hold.</li>
                <li>
                    Try to reach another company&rsquo;s data, or another person&rsquo;s records beyond
                    what your role allows.
                </li>
                <li>
                    Probe, scan or attempt to interfere with the service, or work around any limit or
                    access control in it.
                </li>
                <li>
                    Falsify a record — including submitting a location you are not at, or altering a
                    figure to misrepresent work done or pay owed.
                </li>
                <li>Upload anything that contains malware, or that you have no right to distribute.</li>
                <li>Resell or sublicense access to the service.</li>
            </ul>

            <h2>Your data stays yours</h2>
            <p>
                The records a company puts into Nizmo remain that company&rsquo;s. We do not claim
                ownership of them and we do not use them for anything except operating the service for
                that company. How they are handled is set out in the{' '}
                <a href="/privacy">Privacy Policy</a>.
            </p>
            <p>
                A company can ask for an export of its data while its account is active.
            </p>

            <h2>Subscriptions and payment</h2>
            <p>
                Access is sold as a subscription per company, priced monthly or annually, and may
                include a trial period. Fees are agreed before the subscription starts and are payable
                in advance for the period they cover.
            </p>
            <p>
                If a subscription lapses, the company&rsquo;s account is locked rather than deleted:
                staff can no longer sign in, the administrator sees an explanation, and{' '}
                <strong>nothing is erased</strong>. Access resumes when the subscription is renewed.
            </p>
            <p>
                Prices may change. An existing subscription keeps its price until the end of the period
                it has paid for.
            </p>

            <h2>Availability</h2>
            <p>
                We work to keep Nizmo available and its data safe, but we do not offer a guaranteed
                uptime figure and would rather say so plainly than promise one we have not committed
                to. The service may be unavailable during maintenance, or because of a failure at one
                of the providers it runs on.
            </p>
            <p>
                When the system is deliberately taken offline for maintenance, people signing in are
                shown a notice saying so.
            </p>

            <h2>Suspension and termination</h2>
            <p>
                We may suspend an account that is being used in breach of these terms, or that is
                putting the service or other customers at risk. Where it is safe and practical to do so
                we will say why first.
            </p>
            <p>
                A company may stop using Nizmo at any time. Ending a subscription stops future billing;
                it does not refund a period already paid for unless we have agreed otherwise in
                writing.
            </p>
            <p>
                After an account is closed, data is handled as described in the{' '}
                <a href="/privacy">Privacy Policy</a> — removed from the live system on request, with
                encrypted backups ageing out on their normal schedule.
            </p>

            <h2>The software is provided as it is</h2>
            <p>
                Nizmo is provided without warranties beyond those the law requires and cannot waive. In
                particular, figures it produces — including salary calculations, deductions and
                payslips — are an aid to the people responsible for them, not a substitute for their
                judgement. <strong>Check them before acting on them.</strong>
            </p>
            <p>
                Nothing here limits liability for death or personal injury caused by negligence, for
                fraud, or for anything else that cannot lawfully be limited. Beyond that, our liability
                for any claim arising from the service is limited to the fees paid for it in the twelve
                months before the claim, and we are not liable for indirect or consequential loss,
                including lost profits or lost business.
            </p>

            <h2>Changes to these terms</h2>
            <p>
                We may update these terms. The date at the top changes when we do, and the current
                version is always the one on this page. Continuing to use Nizmo after a change means
                accepting it.
            </p>

            <h2>Governing law</h2>
            <p>
                These terms are governed by the laws of the Arab Republic of Egypt, and the courts of
                Egypt have jurisdiction over any dispute arising from them.
            </p>

            <h2>Contact</h2>
            <p>
                Questions about these terms can be sent to{' '}
                <a href="mailto:maktab.system@gmail.com">maktab.system@gmail.com</a>.
            </p>

            <div className="legal-note">
                <p>
                    This document is published in English, and the English version governs. Any
                    translation is provided for convenience.
                </p>
            </div>
        </>
    )
}
