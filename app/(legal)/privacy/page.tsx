import type { Metadata } from 'next'

export const metadata: Metadata = {
    title: 'Privacy Policy — Nizmo',
    description: 'What Nizmo collects, where it is stored, who can see it, and how long it is kept.',
}

/**
 * Written from the schema and the services rather than from a template, so
 * every claim here is checkable against the code: the field list mirrors
 * prisma/schema.prisma, the retention windows are the --min-age values in
 * .github/workflows/*.yml, and the third parties are the ones the app
 * actually calls out to (Supabase, Vercel, HERE, Google, Gmail).
 *
 * Keep it that way. A policy that drifts from the system it describes is
 * worse than none, because it is a written promise nobody is keeping.
 */
export default function PrivacyPolicy() {
    return (
        <>
            <h1>Privacy Policy</h1>
            <p className="legal-updated">Last updated 17 September 2026</p>

            <p className="legal-lede">
                Nizmo is workplace software sold to employers. Most of the personal data in it is put
                there by your employer about you, rather than by you about yourself. This page explains
                what the system holds, where it lives, who can reach it and how long it is kept.
            </p>

            <h2>Who is responsible for your data</h2>
            <p>
                Your employer decides what goes into Nizmo and what it is used for. We operate the
                software and keep it running on their behalf. In data-protection terms your employer is
                the controller of the information about you, and we are a processor acting on their
                instructions.
            </p>
            <p>
                This means requests about your own records — seeing them, correcting them, asking for
                them to be removed — go to your employer first. We will help them answer, but we do not
                change a company&rsquo;s records on request from outside that company.
            </p>

            <h2>What the system holds</h2>
            <dl>
                <dt>Who you are</dt>
                <dd>
                    First and last name, email address, username, gender, and a profile picture if one
                    is uploaded. Your role, and which company you belong to.
                </dd>

                <dt>How you sign in</dt>
                <dd>
                    Your password is stored only as a hash, never as text. If two-factor authentication
                    is switched on, its secret is stored encrypted, because the server has to read it
                    back to check a code. One-time email codes and &ldquo;remember this device&rdquo;
                    tokens are stored as hashes only, so a copy of the database does not hand anyone a
                    working code.
                </dd>

                <dt>Your work</dt>
                <dd>
                    Tasks assigned to you, what you submitted against them, notes you wrote, costs you
                    recorded, and files you attached. Leave requests and your remaining leave balance.
                    Requests you raised.
                </dd>

                <dt>Your pay</dt>
                <dd>
                    Your salary, the monthly salary record it produces, and any bonus, deduction or
                    penalty recorded against it, with the reason given at the time.
                </dd>

                <dt>Where you were</dt>
                <dd>
                    When you check in on a task, the system records your position at that moment. See
                    the section below.
                </dd>

                <dt>What was done, and by whom</dt>
                <dd>
                    An audit record of changes made in the system — who changed which record, when, and
                    what changed. This is deliberately append-only: it is what lets a disputed change be
                    settled, so it is not edited after the fact.
                </dd>

                <dt>Your settings</dt>
                <dd>Your language and light or dark theme preference.</dd>
            </dl>

            <h2>Location</h2>
            <p>
                Nizmo does not track you. It has no background location access and cannot see where you
                are between check-ins. Your position is read <strong>only</strong> at the moment you
                press Check In on a task, and only if your browser and device permit it — you can
                refuse, and the browser will not ask again until you change that.
            </p>
            <p>
                What is recorded is the coordinates at that moment, and a street address derived from
                them. If your employer has switched location verification on, the system compares that
                position with the task&rsquo;s own location against a distance threshold their
                administrator sets, and marks the check-in as matching or not matching. That mark is
                visible to your managers and can be reviewed by a person.
            </p>
            <div className="legal-note">
                <p>
                    To turn coordinates into a readable address we send them to HERE, a mapping
                    provider. We send the position only; we do not send your name, your email or
                    anything identifying you alongside it.
                </p>
            </div>

            <h2>Where it is stored</h2>
            <p>
                Records are held in a PostgreSQL database and uploaded files in object storage, both
                provided by Supabase. The application itself runs on Vercel. Connections between your
                browser and the service are encrypted in transit.
            </p>

            <h2>Backups</h2>
            <p>
                The database and uploaded files are copied on a nightly schedule. Each copy is
                encrypted before it leaves the machine that made it, and is stored in a private Google
                Drive folder that only this system writes to.
            </p>
            <ul>
                <li>Nightly copies are kept for <strong>7 days</strong>.</li>
                <li>A weekly copy is kept for <strong>28 days</strong>.</li>
                <li>A monthly copy is kept for <strong>365 days</strong>.</li>
                <li>
                    A safety copy taken immediately before any restore is kept for{' '}
                    <strong>30 days</strong>.
                </li>
            </ul>
            <p>
                Because of this, a record deleted from the live system can still exist inside an
                encrypted backup until the windows above have passed. Backups are never browsed or
                searched; they exist to be restored after a failure.
            </p>

            <h2>Who can see what</h2>
            <p>
                Access follows the role your employer gave you. Companies are separated from each
                other: a person in one company cannot see another company&rsquo;s people, tasks or pay.
            </p>
            <ul>
                <li>You can see your own profile, your tasks, your leave and your own records.</li>
                <li>
                    Managers and administrators within your company can see the records of the people
                    they are responsible for, including pay where their role allows it.
                </li>
                <li>
                    Our own staff can reach the underlying systems only when it is needed to operate the
                    service — investigating a fault, restoring a backup, or acting on your
                    employer&rsquo;s instructions.
                </li>
            </ul>

            <h2>Cookies</h2>
            <p>
                Nizmo sets cookies only to make the product work. There is no advertising cookie and
                nothing is sold or shared with advertisers.
            </p>
            <ul>
                <li>A session cookie, so you stay signed in.</li>
                <li>
                    A device cookie, if you chose to skip two-factor authentication on a device you
                    trust.
                </li>
                <li>Your language and theme, so the app opens the way you left it.</li>
            </ul>
            <p>
                We also use Vercel Web Analytics to count page views and understand which screens are
                used. It is configured to measure traffic rather than individuals, and it does not
                build a profile of you or follow you to other websites.
            </p>

            <h2>Services we rely on</h2>
            <dl>
                <dt>Supabase</dt>
                <dd>Database and file storage.</dd>

                <dt>Vercel</dt>
                <dd>Application hosting and the page-view analytics described above.</dd>

                <dt>Google Drive</dt>
                <dd>Storage of the encrypted backups described above.</dd>

                <dt>HERE</dt>
                <dd>Turning a set of coordinates into a street address.</dd>

                <dt>Gmail</dt>
                <dd>
                    Sending sign-in codes, password resets and notifications to your email address.
                </dd>
            </dl>
            <p>
                We do not sell personal data, and we do not share it with anyone beyond the services
                above and your own employer.
            </p>

            <h2>How long it is kept</h2>
            <p>
                Your records are kept for as long as your employer keeps their account, because they
                are your employer&rsquo;s business records. When someone leaves, their account is
                archived rather than erased: the login stops working, but their name, work history and
                pay records remain so that past months stay explainable and payslips can be reissued.
            </p>
            <p>
                If your employer closes their account and asks for their data to be deleted, we delete
                it from the live system. Encrypted backups then age out on the schedule above.
            </p>

            <h2>Security</h2>
            <p>
                Passwords are hashed. Two-factor authentication is available and can be required.
                Backups are encrypted before they leave the machine that creates them. Administrative
                actions are recorded in the audit log.
            </p>
            <p>
                No system is perfectly secure, and we would rather say so than imply otherwise. If you
                believe an account has been compromised, tell your employer&rsquo;s administrator
                immediately and change your password.
            </p>

            <h2>Children</h2>
            <p>
                Nizmo is workplace software and is not intended for anyone under the legal working age
                in their country. We do not knowingly create accounts for children.
            </p>

            <h2>Changes to this policy</h2>
            <p>
                If this policy changes in a way that affects you, the date at the top changes and the
                updated version appears here. Continuing to use Nizmo after that means the new version
                applies.
            </p>

            <h2>Contact</h2>
            <p>
                Questions about this policy, or about how Nizmo handles data, can be sent to{' '}
                <a href="mailto:maktab.system@gmail.com">maktab.system@gmail.com</a>. Questions about
                your own records should go to your employer&rsquo;s administrator first.
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
