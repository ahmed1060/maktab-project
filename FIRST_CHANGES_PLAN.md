# First changes: plan

This file holds the first of two plans made from the product owner's list
of 21 November 2026, after the fingerprint terminal setup guide (#356,
#357): six changes, done first, one PR at a time. The second plan,
`LATER_CHANGES_PLAN.md`, holds the rest, to be discussed once this one is
done. It is updated with every decision and enhancement; the change log at
the end records each update.

Each part is marked:

- **Decided**: the product owner agreed to it.
- **Proposed**: suggested, waiting for the product owner's answer.
- **Open**: a question that needs answering before that part is built.

Status: **decided, being built.** The order is in §7. Step 1, absence 3
days and bands of 1½ and 2 days (§1, §2), is #358. Step 2, the trial and
grace notes for Admins only (§3), is #359. Step 3, the Arabic template's
clients sheet (§4), is #360.

## 1. Absence: 3 days (Decided)

- **Today:** the attendance policy's "Deducted for each day absent" offers
  Nothing, 1, 1½ or 2 days (`components/attendance-policy/PolicyDialog.tsx`).
  The policy's rules already take up to 3 (`absenceSchema` in
  `lib/attendance/policy.ts`), and the engine charges what's picked as it
  is.
- **The change:** 3 days is offered too. Nothing else is added: 3, not
  2½, as the owner chose.
- `ATTENDANCE_PLAN.md` §6.5, which lists 1, 1.5 and 2, lists 3 with them.
- **Built in #358:** the policy keeps the list (`ABSENCE_MULTIPLIERS` in
  `lib/attendance/policy.ts`), and its rules take up to the most on it, so
  the choice and the check can't differ. 3 days is "3 days" in English and
  «٣ أيام» in Arabic, as the policy counts days.

## 2. Bands: 1½ and 2 days (Decided)

- **Today:** a band of lateness or early leave costs ¼, ½, ¾ or 1 day
  (`components/attendance-policy/RuleFields.tsx`), and the policy's rules
  refuse more than 1 day (`bandSchema`).
- **The change:** the rules take up to 2 days, and the choice adds 1½ days
  and 2 days, for lateness and early leave alike, as both are bands. They're
  written as the policy shows its other costs, in the page's digits.
- Escalation for repeats and the monthly cap still apply on top, as today:
  a capped rule stops at its cap.
- Policies already saved don't change: the rules only take more than before.
- **Built in #358:**
  - the policy keeps the list (`BAND_COSTS`), and its rules take up to the
    most on it;
  - 1½ days is named as the other costs are, "1½ days" («يوم ونصف»), and 2
    days is counted as days are, "2 days" («يومان»);
  - the dialog and the policy's card name a cost the same way, from one
    function (`dayCost`), where each had its own and showed a cost it didn't
    name as a bare number.

## 3. The trial and grace notes: Admins only (Decided)

- **Today:** the note above every page saying when the company's free
  trial ends, or its grace (`components/SubscriptionNote.tsx`), shows to
  everyone in the company.
- **The change:** only people whose role is Admin see it. The grace note
  goes the same way, as proposed with it and agreed.
- It's a check on the role's name, so it's listed in
  `lib/permissions/role-check-guard.test.ts`.
- **Built in #359:**
  - the note shows nothing to anyone whose role isn't Admin, a Team
    Leader and an Employee included, as it shows nothing to the Super
    Admin;
  - grace always says renewing it keeps everyone's access, and the line
    telling everyone else that an Admin can renew it is gone, in both
    languages (`note_grace_others`);
  - `DESIGN.md` §5.5, A note above the page, says so first.

## 4. The Arabic task template's clients sheet (Decided)

- **Today:** the Arabic template made for a company names its sheet of
  clients «الموردين», which means suppliers
  (`lib/services/template-generator.service.ts`). This is the wrong name the
  owner had in mind.
- **The change:** «العملاء». The client column's dropdown, whose formula
  names the sheet, follows it. The English template doesn't change.
- **Open, settled in the build:** whether the upload reads that sheet by its
  name. If it does, a template downloaded before still uploads.
- **Built in #360:**
  - the sheet is «العملاء», and the client column's dropdown names it by
    the sheet's own name, as it always has, so it follows;
  - the upload doesn't read the clients sheet at all: it reads the first
    sheet, and the locations sheet by its name in either language
    (`app/(dashboard)/dashboard/tasks/new/page.tsx`). A template downloaded
    before, with «الموردين», still uploads as it did.

## 5. Fingerprint terminals without a refused request (Decided)

- **Today:** for a company whose package has fingerprint terminals but not
  the mobile app, the Attendance settings tab asks for the mobile app's
  check-in locations (`GET /api/attendance/locations`). That's refused
  (403), and the browser logs an error. Nothing on the page looks wrong.
  Found in #355.
- **The change:** the tab doesn't ask for them when the package has no
  mobile app.

## 6. Public holidays off for a company (Decided; its look Proposed)

- **Today:** the Super Admin keeps the central calendar of public holidays
  (`ATTENDANCE_PLAN.md` §7.2). A company can work through them one at a
  time (`CompanyHolidayExclusion`), and only someone allowed to change the
  Attendance settings tab can do that: the Super Admin, and a company's
  Admin when the Super Admin has given them that tab.
- **The change:** one switch for the company, "Public holidays apply", on to
  start with.
- **Who can turn it off (Decided):** the same people who can work through
  one holiday today: the Super Admin, and the company's Admin when the
  Super Admin has given them the Attendance settings tab.
- **What changes while it's off:**
  - every central holiday is a normal workday for the company, including
    ones the Super Admin adds later;
  - not coming in is an absence, and work that day is overtime at the
    workday rate, not the holiday rate.
- **The company's own holidays still apply (Decided).**
- **Holidays the company already works through stay as they are,** so
  turning the switch back on returns to them.
- **From when (Proposed):**
  - from a date chosen, today to start with, and days before it keep their
    holidays;
  - a date in a month whose payroll is approved is refused, as working
    through one holiday is today;
  - attendance is worked out again from that date, as it is for one holiday.
- **Recorded:** each change goes in the audit log, with who did it and from
  when.
- **Open, for the mockup:**
  - where the switch sits on the Holidays section;
  - how the central holidays show while it's off;
  - how a day off over a public holiday counts while it's off.
- **Built in two:** the mockup first, for the owner to approve, then the
  switch.

## 7. Order

One PR at a time, each merged before the next opens.

| Step | What | Item |
|---|---|---|
| 1 | Absence 3 days; bands 1½ and 2 days | §1, §2 |
| 2 | The trial and grace notes for Admins only | §3 |
| 3 | The Arabic template's clients sheet | §4 |
| 4 | Fingerprint terminals without a refused request | §5 |
| 5 | Public holidays off: the mockup, then the build | §6 |

## Change log

- **2026-11-21:** Plan written from the owner's answers on the list of
  ideas: absence adds 3 days alone; bands add 1½ and 2 days; the trial
  note, and the grace note with it, for the Admin role only; the wrong
  name in the template is the Arabic «الموردين»; the refused request on
  Fingerprint terminals goes; public holidays can be turned off by the
  Super Admin and by a company's Admin the Super Admin allows, with the
  company's own holidays still applying. Items 7 to 10 of the list are in
  `LATER_CHANGES_PLAN.md`.
- **2026-11-21:** Step 1 built in #358: absence 3 days, and bands of 1½
  and 2 days, the lists kept beside the rules that check them.
- **2026-11-21:** Step 2 built in #359: the trial and grace notes for the
  Admin role only.
- **2026-11-21:** Step 3 built in #360: the Arabic template's clients
  sheet is «العملاء»; the upload never read it by name, so older templates
  still upload.
