# Client portal: plan

This file holds the plan for the client portal: a package add-on that
lets each of a company's clients sign in and see what the company keeps
for them, starting with their tax position. It is updated with every
decision and enhancement; the change log at the end records each update.

Each part is marked:

- **Decided**: the product owner agreed to it.
- **Proposed**: suggested, waiting for the product owner's answer.
- **Open**: a question that needs answering before that part is built.

Status: **being built.** The plan and its `DESIGN.md` blocks were merged
in #309 on 2026-11-17, and the add-on on packages (§2, §12 step 2a) in
#310 the same day. The claims on a client's page (§3.5, §12 step 2b)
were merged in #311 that day too, and `tax.view` for the companies
already there (step 2c) is #312. A client with a tax position archived
instead of deleted (§3.6, step 2d) is #313, and the rules for reading
the portal's file (§4.1, step 3a) are #314. Saving the file (step 3b)
is #315. The rest is built in the small PRs of §12, each its own PR.

---

## 1. What it is (Decided)

A company that does tax work for its clients, such as an accounting
office, keeps each client's open claims from the Tax Authority's portal
(بوابة الممول) in Nizmo. The client's own people sign in and see them as
their **tax position** (الموقف الضريبي): what they owe, by item, how
late it is, and each claim.

- The company's people keep it up to date by uploading the Excel file
  their export button makes from the portal (§4.1), the only way claims
  come in (§4.2).
- The client's people only look, and contact their accountant on
  WhatsApp (§7).
- The page is the owner's mockup of 2026-11-17, redrawn on the building
  blocks (`DESIGN.md` §5.5, A client's tax position). The redrawn mockup
  is a private design canvas.

---

## 2. Sold as a package add-on (Decided, 2026-11-17)

- A new bundle, **Client portal** (بوابة العملاء), switched on per package
  by the Super Admin (`Package.hasClientPortal`). It's off for every
  package until then, so no company sees anything new.
- It's sold only on top of Company Management, where clients are, as the
  attendance add-ons are only on top of HR (`lib/features/bundles.ts`).
  `PackageService` refuses it without Company Management, and turning
  Company Management off turns it off.
- A new module, `TAX_POSITION`, owned by the bundle. Without it:
  - nothing of it is on a client's page or the Clients page;
  - its routes refuse, as any module's do when the package hasn't it;
  - a client account can't sign in (§5.3).
- Turning it off keeps the claims and the client accounts. Turning it on
  again brings them back as they were.
- **A company with no package** (Decided, 2026-11-17) hasn't it. Such a
  company has every other bundle, as it was there before packages
  (`lib/features/bundles.ts`), but the client portal lets people from
  outside the company in, so it opens only where the Super Admin puts the
  company on a package that has it. The Super Admin sees it for every
  company, to show it.
- **As built (#310):** the switch on a package, "Client portal", under
  the other bundles in the package's dialog, greyed without Company
  Management, with the same rule in `PackageService` and the database. A
  package's card and a company's row name it among what the package has.
  Nothing else changes yet. The `TAX_POSITION` module comes with the
  route that asks for it (step 2b), as no module is gated that nothing
  routes to.

---

## 3. The claims

### 3.1 What's kept (Decided, 2026-11-17)

One row per claim, for one client (`TaxClaim`):

- the claim number (رقم المطالبة), as text, so its leading zeros stay. A
  client has each number once;
- the tax (نوع الضريبة), such as دخل;
- the item (نوع بند السداد), as the portal wrote it;
- the registration type (نوع التسجيل الضريبي), which may be empty;
- the original amount, paid and remaining, to the piastre;
- the currency, as the portal wrote it;
- the status, as the portal wrote it;
- the tax period's first and last days;
- the last day to pay before the penalty (آخر موعد للسداد قبل الغرامة).

And for each client: the day its claims are from, and who uploaded them
last. Row-level security on the new tables, as on every table.

As built (#311): `TaxClaim`, and `ClientTaxPosition` for the day and the
uploader, whose name is kept as it was that day. The database holds a
claim to its number once for its client, its amounts adding up, and
something left to pay. They go with their client when it's deleted for
good (§3.6).

As built (#315): `ClientTaxPosition` also keeps the company the client's
last file named, and how many files have been uploaded for it, which a
save is checked against (§4.1).

### 3.2 Only open claims (Decided, 2026-11-17)

The tax position is what's still owed: claims waiting to be paid (في
انتظار السداد) and partly paid (مسدد جزئيًا). A claim with nothing left to
pay isn't kept. Read from a file, it's left out, and the check screen
counts it (§4.1).

### 3.3 The items' names (Decided, 2026-11-17)

The portal spells the same item more than one way: أقرار and إقرار,
مساهمه تكافليه and مساهمة تكافلية, a dash with and without spaces.

- Each item is kept as the portal wrote it.
- It's grouped, and shown, by a tidied name. Spellings match with spaces,
  dashes, Arabic's letter forms (أ إ آ ا, ة ه, ى ي), its vowel marks and
  the stretch line (ـ) set aside, as the client statement's cost names do
  (`DESIGN.md` §5.5, Client statement).
- A short list in the code gives the usual items their correct spelling.
  Any other item is shown as the portal wrote it most often.
- The items stay in Arabic on the English page too: they're the portal's
  names, and the client sees them there in Arabic.

### 3.4 Late, and the badges (Decided)

- A claim is late when its last day to pay has passed, in the company's
  time zone, and something is left to pay. How late is counted in days,
  to today.
- Its badges: Partly paid where something is paid, and Late where it's
  late. A claim can have both; the owner's mockup showed only one.

### 3.5 On the client's page, for the company's people (As built, #311)

A client's page gets a section, Tax position, after the client's details
(`DESIGN.md` §5.5, A client's tax position, for the company's people):

- **Who sees it:** whoever has `tax.view` (§9), in a company whose
  package has the client portal (§2). The Super Admin sees it on any
  company's client.
- **What it says:** the day the figures are from, and who uploaded the
  portal's file and when; what's owed, how many claims are open, how
  many are late, and what's paid; then the claims, the longest overdue
  first.
- **Five claims to start with,** so the client's other sections stay in
  reach, then Show all claims, 20 to a page, as a client can have up to
  2,000 (§4.1).
- **Late** is counted on the server, in the company's time zone (§3.4),
  so this page and the client's own agree.
- **Before the first upload,** it says there's no tax position yet. A
  file with no open claim in it leaves the day and the totals, at 0.
- **An archived client's** is still shown: it's what the portal said.
- **When it didn't load,** the section's place says so, with Try again.
  A page of claims that didn't load says so too: the claims kept up from
  another page don't stand in for it. A page gone back to is read again,
  as what was kept of it may be an earlier file's.

### 3.6 A client with a tax position, deleted (Decided, 2026-11-18)

The owner's answer to §16's question: archive it, with a way to delete
it for good after.

- **Archived instead of deleted.** A client with a tax position is
  archived when it's deleted, as one with tasks or records is
  (`CLIENTS_PLAN.md` §4.3): its tax position is as much its history as
  its records are. A tax position is a file uploaded for it, with claims
  open or none. Its menu says Archive in place of Delete, and why. That
  it has one is told only to whoever may manage clients, whose menu it
  changes.
- **Delete permanently,** from the archive. An archived client with no
  tasks and no records gets it in its menu, for whoever may manage
  clients. It asks first, in the danger colour: that its tax position
  goes with it, with how many claims are open for whoever may see tax
  positions (by their role and their company's package), and that it
  can't be undone. Its claims and the day they're from go with it, as
  its people who sign in will (§5).
- **One with tasks or records stays in the archive,** as today (the
  owner, 2026-11-18): deleting it would take its records and their
  files, and leave its tasks without it.
- **Only from the archive.** A client in use is archived first, so
  deleting for good is always a second, separate step.
- **Refused, it says why,** in the reader's language: tasks or records
  came to hold it, or it was restored, since the list was read. Nothing
  is deleted, and the list is read again.
- The audit log says who deleted it and how many claims went with it.
- It only shows. Uploading the portal's file comes in step 3 (§12).

---

## 4. Keeping it up to date

### 4.1 Uploading the portal's file (Decided)

The owner's export button reads the claims table on the portal's
Payments page and makes an Excel file. Nizmo reads that file as the
button writes it (§10), one company's file at a time.

- **Who:** whoever has `tax.manage` (§9).
- **Where:** only on a client's page, in its Tax position: Upload from
  the tax portal. The file is that client's (Decided, 2026-11-17), so
  nothing in it is matched to clients.
- **Reading it:**
  - Its first sheet. The columns are found by their headings, not where
    they are, as the button writes the headings the portal's table has.
  - Needed: الشركة, رقم المطالبة, نوع بند السداد, آخر موعد للسداد قبل
    الغرامة, and the amounts, as every row needs them. Where any claim in the
    file was partly paid, the button writes قيمة المطالبة الأصلية, المسدد
    and المتبقي; where none was, a single قيمة المطالبة, which is then both
    the original and what remains. Either is read.
  - Read when there: the rest of §3.1's columns.
  - A needed column missing refuses the file, naming the column.
  - Dates are the sheet's dates, or dd/mm/yyyy written as text. Amounts
    are numbers, or text with either kind of digits and thousands
    separators.
- **Each row is checked**, as `DESIGN.md` §5.5's rows read from a file
  are:
  - a claim number, an item and a last day to pay;
  - paid and remaining adding up to the original, to the piastre;
  - a claim number only once in the file.

  A row with nothing left to pay is left out and counted (§3.2).
- **One company to a file:** every row's الشركة must name the same
  company. The export button holds one company at a time (§10), so its
  file always does. A file naming several, such as one from an older copy
  of the button, is refused, naming the companies in it.
- **The right client:** Nizmo keeps the company's name from the last file
  uploaded for the client. Where the file's company is neither that name
  nor the client's own, matched as §3.3 matches items, the check screen
  says so, and saving asks to confirm it's this client's file, so one
  client's claims don't replace another's. Once saved, the file's name is
  kept for next time.
- **The check screen**, before anything is saved:
  - how many claims and what remains, against what's shown now;
  - what's new, what changed, and what isn't in this file and will go;
  - the rows with a problem, each with why;
  - the day the figures are from: the date in the file's name, which the
    button writes, or today without one. It can be changed.
- **Saving:**
  - The client's claims become the file's: **each upload replaces the
    last** (Decided, 2026-11-17). A claim the new file hasn't goes, which
    the check screen says before saving.
  - In one go, so the page never shows part of one file and part of
    another.
  - The audit log gets an entry: who uploaded, the file's name, and how
    many claims are new, changed and gone.
- **Keeping a replace safe** (Decided, 2026-11-17), as an upload
  replaces all of a client's claims:
  - **A row with a problem stops the save.** Saving the other rows would
    delete that row's claim from Nizmo. The check screen lists each
    problem, and the file is fixed or exported again.
  - **Many claims going:** the check screen lists them before saving,
    with no second question (the owner, 2026-11-17).
  - **The portal's filter** (Decided, 2026-11-17): staff export with the
    filter they need, as the export button's page says. A claim the filter
    hides isn't in the file, so, as each upload replaces the last, it's
    among those the check screen lists as going.
  - **Two uploads at once:** saving checks that the client's claims are
    still as the check screen read them. If someone changed them in the
    meantime, it says so, and the file is checked again.
  - **The server checks again:** the browser reads the file for the check
    screen, and the server checks every row again before saving, trusting
    nothing it's sent.
  - **Limits:** an `.xlsx` file of up to 2 MB and 2,000 rows. The day the
    figures are from can't be after today.

As built (3a, #314): the rules the check screen and the server share,
in `lib/tax-file.ts`, with the file itself opened in
`lib/tax-file-read.ts`. No screen or route uses them yet.

- **Headings, companies and statuses** are matched as §3.3 matches
  items. The file's first row with anything in it is its headings.
- **Left out and counted:** a row with nothing left to pay, and, where
  the file has the status column, a row whose status is neither في
  انتظار السداد nor مسدد جزئيًا (§3.2). A fully paid claim can still show
  its amount where the file has the one amount column, so its status
  says it. Each status left out is named with how many rows it had, for
  the check screen to say: one that's still owed is then seen before
  saving.
- **A claim number** keeps its digits as Latin ones, so the same claim is
  one claim from one upload to the next.
- **Never a guess:** a number in a date's column, a date written any
  other way than dd/mm/yyyy, and an amount finer than a piastre are
  problems that say what the file had. So is an amount whose comma or
  point isn't where a thousands separator or the decimal point goes,
  such as 12,50 or 1.000,00: it's another way of writing, not 1,250
  or 1.
- **The company:** the button's غير محدد, for a page with no company
  name, counts as no name, so saving asks to confirm. Rows with no
  company among rows that name one aren't another company.
- **The day in the file's name** is the last date in it, so a copy the
  browser numbered still has it. One after today isn't taken.
- **What's new, changed and gone** is told by claim number: a claim is
  changed when anything kept of it differs, to the piastre.

As built (3b, #315): saving, with no screen yet. `tax.manage` comes with
it (§9), and two addresses under the claims' own, both for whoever holds
it:

- **What a file is checked against**
  (`GET /api/tax-claims/upload?clientId=`): every claim the client has
  now, the company its last file named, today where the company is, and
  how many files have been uploaded for it.
- **Saving** (`POST /api/tax-claims/upload`) takes the claims the
  browser read from the file, never the file itself, with the day the
  figures are from, the file's name and the company it names.
- **The server checks again,** by the same rules (`lib/tax-file.ts`):
  every claim, each number once, only open claims, 2,000 at most, and
  the day not after today where the company is. Anything wrong refuses
  the whole save.
- **Still as the check screen read them:** a save says how many files
  the client had when its claims were read, and is refused, saying so,
  where another was saved since. Each save holds the client's row, so
  two at once go one after the other, and the second is refused.
- **The right client:** where the file's company is neither the
  client's name nor the one its last file named, the save is refused
  until it's sent as confirmed. A file that names no company leaves the
  name kept from an earlier one.
- **In one go:** the claims the file hasn't go, the new and the changed
  are written, and the day, who uploaded and the count of files are
  set: all of it, or none. A claim that didn't change keeps its row.
- **An archived client's, or another company's,** is refused, as is one
  archived while the check screen was open.
- **The audit log:** Updated tax position, on the client: the file's
  name, the day the figures are from, how many claims were added,
  changed and removed, and how many it has now.
- **Never too long:** a claim number over 50 characters, or an item, a
  tax, a registration type or a currency over 200, is a problem like
  any other, on the check screen and on the server. The portal's are
  far shorter, and a file that passed the check is then never one the
  database can't hold.
- **Only what's seen:** control characters, and half of a character's
  pair, are set aside as spaces are tidied, in what the file has and in
  what's sent, as the database refuses them. An address that isn't an
  id is nobody's client.

### 4.2 Only from the portal's file (Decided, 2026-11-17)

Claims come in only by uploading the portal's file: there's no adding,
editing or deleting a claim by hand. So a client's tax position is always
what the portal showed on the file's day. (Planned earlier as Add claim,
with Edit and Delete in each claim's row menu; the owner dropped it.)

### 4.3 Figures getting old (Decided, 2026-11-17)

- The day the figures are from changes with each upload, to the day the
  check screen says.
- From 30 days after it, counted in the company's time zone as late is,
  the client's Tax position says how long it's been, for the company's
  people: a Waiting on someone badge by the day, "Not updated for 34
  days". The Clients list has the same badge in the client's row, so
  whose file is due shows at a glance.
- The client's own page shows the day, as always, with no badge.

### 4.4 Telling the client's people by email (Decided, 2026-11-17)

- A switch on the company's Client portal tab (§7.1): "Email the
  client's people when their tax position is updated", off to start,
  changed by whoever holds `client_messages.manage` (§9).
- With it on, each upload saved sends one email to each of that client's
  people who has set a password; those still invited have their
  invitation already.
- It says, in Arabic and then English, that the office (by name) updated
  the tax position, with the day the figures are from and a link to sign
  in. No amounts, so nothing owed travels by email.
- At most one email a day for a client, however many uploads it has.
- Sent from the address that sends sign-in codes. An email that fails
  doesn't undo the upload: it's noted, and the upload's audit log entry
  says how many were sent.

---

## 5. Client accounts

### 5.1 Separate from the company's people (Decided, 2026-11-17)

- A **client account** belongs to one client. It isn't one of the
  company's people: it's never in Employees, payroll, attendance,
  requests, the notifications the company's people get, or anything
  else that lists them.
- A client can have several, one for each of its people, so each has
  their own sign-in, and removing one leaves the others.
- `ClientAccount`: the company, the client, a name, an email, the
  password, invited or active, when it was invited and last signed in,
  who added it, and what ends its sessions (as a person's does).
- Its email is used by no one else in Nizmo, among the company's people,
  Super Admins and client accounts alike, so signing in finds one
  account.

### 5.2 Adding and removing people (Decided, 2026-11-17)

- On a client's page, **People who can sign in**, with
  `client_accounts.manage` (§9): each person's name, email, and when they
  last signed in, or that they're invited.
- Add person: a name and an email. Nizmo emails an invitation, from the
  address it sends sign-in codes from, with a link to set a password. The
  link works once, for 72 hours; Resend invitation sends a new one.
- Remove: their account goes, and so do their open sessions, at once.
- Each add, resend and remove is in the audit log.

### 5.3 Signing in (Decided, 2026-11-17)

- On the same sign-in page, with their email and password. The same lock
  after too many wrong passwords, and the same Forgot password, as for
  the company's people.
- Their session says it's a client account's, for which client. Every
  page and route of the client's area reads the client from the session,
  never from the address, and shows only that client's.
- The proxy keeps a client account in the client's area: every other
  page and route refuses it. The company's people aren't sent to the
  client's area; they see the same claims on the client's page.
- A client account can't sign in, and its open sessions end, when:
  - the company's package hasn't the add-on (§2);
  - the company's subscription has ended, as for its people;
  - the client is archived;
  - the account is removed.

  Signing in then says the office's portal isn't open to them now, and
  to contact the office.
- Two-factor sign-in isn't asked of them for now (§13).

### 5.5 The privacy policy (Decided, 2026-11-17)

The privacy policy (`app/(legal)/privacy`) gets a line saying Nizmo also
keeps the name and email of each of a client's people the office invites
to the portal, and emails them their invitation and, where the office
turns it on, a note when their tax position is updated (§4.4).

### 5.4 What a client account never sees (Decided)

Anything else of the company's: its people, other than their
accountant's name, and the accountant's WhatsApp number once WhatsApp
opens (§7); its tasks, costs, charges and records; and its other
clients.

---

## 6. What the client sees (Decided, 2026-11-17)

The owner's mockup, redrawn on the building blocks (`DESIGN.md` §5.5,
The client's area and A client's tax position).

- **The client's area:** a top bar alone, with the company's mark and
  name, the language switch, and the account menu (Change password, Sign
  out), in the company's brand colour.
- **The page header:** the client's name above Tax position, then where
  the figures come from, the day they're from, and the responsible
  accountant. Contact the accountant, and Download the statement.
- **What's owed:** what remains in all, how many claims are late, how
  much is paid of the open claims' original amounts, how many are open,
  and the oldest delay.
- **By item, and how late:** bars by part.
- **The claims:** by item, opening to each claim, with a total row.
  Each claim has Ask about this claim (§7).
- **A note:** in Egyptian pounds, as they were on the portal that day,
  with penalties for paying late not counted.
- **Before the first upload:** the page says the office hasn't added the
  tax position yet.
- Both languages, and phones as well as computers.

---

## 7. Contacting the accountant (Decided, 2026-11-17: WhatsApp)

- Each client gets a **responsible accountant**: one of the company's
  people, picked on the client's page with `clients.manage`. The client
  sees their name.
- **The accountant's own number** (Decided, 2026-11-17): the person who
  answers for the client is the one written to. Each of the company's
  people can have a WhatsApp number on their profile, set by them or by
  whoever can edit their profile, with a hint that the clients they're
  responsible for can write to it.
  - It's typed as an Egyptian mobile (01…) or with its country code
    (+…), and kept with its country code.
- **Contact the accountant** opens a dialog (`DESIGN.md` §5.5, Contact
  on WhatsApp): the accountant, and a message ready to send, which can be
  changed. Open WhatsApp opens `https://wa.me/<number>?text=<message>` in
  a new tab: the app on a phone, WhatsApp Web on a computer.
- **Ask about this claim** (Decided, 2026-11-17): on each claim, opening
  the same dialog with that claim's message.
- **The messages** (Decided, 2026-11-17), in the page's language, from
  the client account's name, written from templates that can be changed
  (§7.1). Nizmo's own start as these:
  - From Contact the accountant:

    ```
    السلام عليكم،
    أنا منى فؤاد من شركة النموذج للتجارة والتوريدات.
    استفسار عن الموقف الضريبي بتاريخ ١٦ نوفمبر ٢٠٢٦:
    ```

  - From a claim:

    ```
    السلام عليكم،
    أنا منى فؤاد من شركة النموذج للتجارة والتوريدات.
    استفسار عن المطالبة رقم 000372722603:
    البند: إقرار تجاري
    المتبقي: ١٣٬٧٢٣٫٢٦ جنيه من ٢١٬٠٨٨٫٢٦
    آخر موعد للسداد: ٣٠ أبريل ٢٠٢٦
    ```

  - In English: "Hello, / This is Mona Fouad from <client>. / A question
    about the tax position as of 16 November 2026:", and for a claim "A
    question about claim 000372722603: / Item: … / Remaining: EGP
    13,723.26 of 21,088.26 / Last day to pay: 30 April 2026".
  - The claim number in Latin digits, as it's typed into the portal. The
    person writes their question under it, here or in WhatsApp.
- **Without a number:** where the client has no responsible accountant,
  or theirs has no WhatsApp number or their contract has ended, the
  client's page has no Contact the accountant and no Ask about this
  claim, and its note says to contact the office. On the client's page
  for the company's people, the Tax position says why, with the way to
  fix it: pick a responsible accountant, or add their WhatsApp number on
  their profile.
- Nothing passes through Nizmo, and nothing of the conversation is kept.
- Turned down: an email form, and one number for the whole company
  (§14).

### 7.1 The messages' templates (Decided, 2026-11-17)

Two messages, Contact the accountant and Ask about this claim, each in
Arabic and English.

- **Nizmo's own:** the Super Admin writes them, in Templates, Client
  messages, beside the role and policy templates. They start as §7's.
- **A company's own:** whoever holds `client_messages.manage` (§9)
  changes the company's copy, in Company settings, on a Client portal tab
  shown where the package has the add-on. Until a company changes a
  message, it uses Nizmo's, with the Super Admin's later changes. Use
  Nizmo's message puts it back.
- **Who may change a company's:** the Super Admin ticks
  `client_messages.manage` on the roles they choose, as only the Super
  Admin builds roles (`ROLES_PLAN.md` round 5). The built-in Admin role
  holds it, as it holds every permission and can't be changed
  (`ROLES_PLAN.md` §4.2, rule 7), so a company's Admins can change its
  messages (Decided, 2026-11-17: no switch to stop them, §14).
- **Fields:** put in with buttons, never typed, and shown by their names
  in the page's language: the person's name, the client's name and the
  day the figures are from; for a claim, also its number, item, what
  remains, its original amount and its last day to pay. They're filled in
  when the dialog opens. A field the message can't fill (a claim's number
  in Contact the accountant) is refused on saving.
- **Checks:** a preview with made-up figures beside the text; up to 1,000
  characters; not empty. Each change is in the audit log, with before and
  after.
- **Kept in** `ClientMessageTemplate`: the company (none for Nizmo's),
  which message, the language, the text, and who changed it and when,
  with row-level security.
- The client's person can still change the message in the dialog before
  sending.
- Its `DESIGN.md` block, a text with fields put in by buttons, comes with
  its PR (§12).

---

## 8. Download the statement (Decided, 2026-11-17)

Download the statement opens the client's tax position as a document in
a new tab, to print or save as a PDF from the browser's print, as the
client statement is (`DESIGN.md` §5.5, Document). Nothing is kept or
sent: it's drawn from the claims as they are.

- On it: the company's mark and name; Tax position statement; the
  client's name, the day the figures are from and the responsible
  accountant; what remains in all and how many claims are late; the
  claims by item, each with its number, period, last day to pay,
  original, paid and remaining amounts and its badges; each item's total
  and the total in all; the note (Egyptian pounds, as on the portal that
  day, penalties for paying late not counted); and the day it was
  printed.
- In the page's language. Saved as a PDF, it's named for the client and
  the day the figures are from.
- The same document opens from the client's Tax position for the
  company's people, with `tax.view`.

---

## 9. Permissions (Decided, 2026-11-17)

| Permission | What it allows | Scope |
|---|---|---|
| `tax.view` | Seeing a client's tax position on its page; implies `clients.view`, as that's where it is | Company |
| `tax.manage` | Uploading the portal's file; implies `tax.view` | Company |
| `client_accounts.manage` | Adding and removing a client's people, and resending invitations; implies `clients.view` | Company |
| `client_messages.manage` | Changing the company's copy of the WhatsApp messages (§7.1), and the update email's switch (§4.4) | Company |

- All four are in the `TAX_POSITION` module (§2).
- Each comes with the route that asks for it, as the catalogue offers no
  permission that nothing checks: `tax.view` with the claims (step 2b),
  `tax.manage` with the upload's route (step 3b, #315), and the other
  two with theirs (§12).
- `client_accounts.manage` is high-risk, as it lets people from outside
  the company in: it asks for the step-up confirmation
  (`ROLES_PLAN.md` §6.15).
- The built-in Admin holds all four. Other roles get them where the Super
  Admin ticks them, as only the Super Admin builds roles.
- They go into `ROLES_PLAN.md`'s tables with the PR that adds them to the
  catalogue, as `lib/plan-docs.test.ts` holds those tables to it.
- The built-in Admin role of each company already there gets them in a
  small PR of its own after the one that adds them, as the terminals'
  (#278) and missions' (#284) permissions did (§12). `tax.view`'s is
  #312: a migration gives it to the built-in Admin alone, company-wide.
  An Admin role holding it already, a new company's, is left as it is;
  the others' holders reload their grants once. `tax.manage`'s is step
  3d, after #315.

---

## 10. The export button (Decided)

- Changed on 2026-11-17 at the owner's ask, to fit the upload on a
  client's page (§4.1), and tried on a page laid out like the portal's:
  - it holds one company at a time. Opening another company starts it
    again by itself, with no Clear (مسح) to press, so each file is one
    company's;
  - its file's name has Cairo's date, not UTC's, which was the day before
    between midnight and 2 or 3 in the morning. Nizmo takes the day the
    figures are from from it.
- Changed again on 2026-11-17, with the portal's filter kept in its steps
  at the owner's ask: changing the filter on the same company starts it
  again by itself, as another company does, so the file holds what the
  portal shows with the filter chosen. Its panel says all were gathered
  only when the count equals the portal's "إجمالي النتائج", and warns
  when there are more. Before this, rows gathered before the filter
  changed stayed in the file, with the panel saying all were gathered.
- The rows it gathers stay in the browser until another company is opened
  or Clear is pressed, so on a shared computer the next person can see the
  last client's claims.
- Its staff install it by dragging it to the bookmarks bar from its page;
  no store or paid account is needed. A bookmark keeps the copy it was
  made with, so after a change each of them drags the new one once.
- **In Nizmo** (Decided, 2026-11-17): the button's code moves into
  Nizmo, with its tests on a page laid out like the portal's that holds
  made-up claims. Nizmo makes the bookmark from it and shows it on a page
  of its own, **The tax portal's export button**, for whoever has
  `tax.manage` where the package has the add-on:
  - the button to drag to the bookmarks bar, on a computer;
  - the steps: open the portal's Payments page for the client's company,
    choose the filter needed, press the button, which gathers every page,
    then Download, and upload the file on that client's page in Nizmo;
  - that a claim the filter hides isn't in the file, and the upload lists
    it as going (§4.1);
  - what it does: it reads the table on the screen and saves a file on
    the computer. It sends nothing to Nizmo or anywhere else;
  - the note for a shared computer, and Clear.

  The upload's dialog (How to get this file) and the Tax position section
  link to it. Staff then always drag the newest copy from one place, and
  the separate install page goes. The button still runs on the portal's
  page, in the staff's own browser.

---

## 11. What it costs to run (Decided)

Little, on Vercel Hobby and Supabase Free alike: a client opening the
page is one or two function calls, an upload is one, and a client has a
few dozen claims. Each invitation is one email, from the account that
sends sign-in codes, and so is each update email (§4.4), at most one a
day for a client.

---

## 12. Build order (Decided, 2026-11-17)

Each a small PR, tests first, the flows in both languages and at phone
width:

1. **The plan and its `DESIGN.md` blocks.** #309.
2. **The add-on and the claims,** in three:
   - **2a. The add-on on packages:** the package switch and the bundle,
     off for a company with no package (§2). #310.
   - **2b. The claims:** the `TAX_POSITION` module, `tax.view`, the
     claims' tables, and the Tax position section on a client's page
     showing them (§3.5). The module and the permission come with the
     route that asks for them, as the gate offers no module that nothing
     routes to and the catalogue no permission that nothing checks. #311.
   - **2c.** `tax.view` for the built-in Admin of the companies already
     there, from a migration, once #311's release, whose role editor
     knows it, is live. #312.
   - **2d.** A client with a tax position is archived instead of
     deleted, and deleted for good from the archive where it has no
     tasks or records (§3.6). Before the upload lets claims in. #313.
3. **Uploading the portal's file** on a client's page, in four:
   - **3a. Reading the file:** the rules of §4.1 that the check screen
     and the server share: finding the columns, reading and checking
     each row, one company to a file, whether it's this client's, the
     day in its name, and what's new, changed and gone. No screen yet.
     #314.
   - **3b. Saving it:** `tax.manage`, the route that takes a checked
     file, the server checking every row again, replacing in one go,
     and the audit log. No screen yet. #315.
   - **3c. The upload on a client's page:** Upload from the tax portal,
     the check screen, and saving.
   - **3d.** `tax.manage` for the built-in Admin of the companies
     already there.
4. **The export button in Nizmo** (§10): its code and tests in the
   repository, its page, and the links to it. It then writes every
   claim number as text: today's writes one with no zero at its start
   as a number, which the upload refuses as a number that may have lost
   its zeros (§15). Its tests read its file with Nizmo's reader.
5. **Figures getting old** (§4.3): the badge on the client's page and the
   Clients list.
6. **Client accounts:** their table, People who can sign in,
   `client_accounts.manage`, the invitation and setting a password, and
   the privacy policy's line (§5.5).
   - **6b.** `client_accounts.manage` for the built-in Admin of the
     companies already there.
7. **Signing in as a client account, and the client's area:** sign-in
   finding them, their session, the proxy keeping them in the area, and
   its top bar and account menu.
8. **The tax position page.**
9. **Contacting the accountant on WhatsApp:** the number on people's
   profiles, the responsible accountant, the dialog, Ask about this
   claim, and the messages.
10. **The messages' templates** (§7.1): the Super Admin's, the company's
    copy, and `client_messages.manage`.
    - **10b.** `client_messages.manage` for the built-in Admin of the
      companies already there.
11. **Telling the client's people by email** (§4.4).
12. **Download the statement.**

---

## 13. Later

- **Send to Nizmo** from the export button: it would open Nizmo's upload
  in a new tab and hand the rows over, to the same check screen, with no
  key kept in the button. First a test on the portal, as its own security
  settings may stop it.
- **Documents:** a section of the client's records shared with the
  client.
- **Returns and payments:** the mockup's other two pages.
- **Two-factor sign-in** for client accounts.
- **See it as the client does:** for the company's people, from the
  client's page.
- **Undo the last upload** (proposed, 2026-11-17): Nizmo keeps the claims
  the last upload replaced, and Undo puts them back, while no newer
  upload has followed.
- **The button's copy in its file:** the export button would write which
  copy it is into its file, so the upload could say when a file comes
  from an old one, with the link to drag the new one.

---

## 14. Turned down

- **Nizmo signing in to the portal itself** (2026-11-17): it would keep
  every client's portal password, the portal's verification codes would
  stop it, and it would break whenever the portal changes.
- **Matching by the tax registration number** (2026-11-17): the portal
  doesn't give the export button the number.
- **One upload for several clients** (2026-11-17), from the Clients page,
  matching each company in the file to a client: the upload is on a
  client's page, and the file is that client's.
- **Client accounts as people with a new role** (2026-11-17): they would
  appear wherever the company's people are listed, and each list would
  have to leave them out.
- **An email form for contacting the accountant** (2026-11-17): WhatsApp
  was chosen. It can come back if a written record is wanted.
- **One WhatsApp number for the whole company** (2026-11-17): the
  accountant who answers for the client is the one written to (§7).
- **Asking once more when many claims go** (2026-11-17): the check
  screen lists them before saving (§4.1).
- **Adding, editing or deleting claims by hand** (2026-11-17): the
  portal's file is the only way, so Nizmo always shows what the portal
  showed (§4.2).
- **A switch for whether a company's Admins may change the messages**
  (2026-11-17): the built-in Admin holds every permission, as everywhere
  else in Nizmo (§7.1).

---

## 15. How it's tested (Decided, 2026-11-17)

Each part's PR has its own tests, written first. The upload button's,
from the screen to the database:

1. **Who may use it**
   - With `tax.manage`, the button is there; with `tax.view` alone, the
     claims are there without it; with neither, the section isn't.
   - A company whose package hasn't the add-on: no section, and its
     routes refuse.
   - An archived client: no button, and the route refuses.
   - A client account: always refused, even calling the route itself.
   - Another company's client: refused, whatever the address says.
2. **The file**
   - The owner's sample file: 20 claims, 38,798.37 remaining.
   - Either amount layout: the original, paid and remaining columns, or
     the one amount column.
   - Columns in another order, or extra ones: read.
   - Refused, each saying why:
     - not an Excel file, damaged, empty or password-protected;
     - over 2 MB or 2,000 rows;
     - a needed column missing, named.
   - Dates as dates or as dd/mm/yyyy text, and amounts with either kind
     of digits: read.
   - Empty rows at the end: left out.
3. **The rows**
   - Each of these is a problem that stops the save:
     - paid and remaining not adding up to the original;
     - a negative amount;
     - an impossible date;
     - no claim number, item or last day to pay;
     - a claim number twice;
     - a claim number stored as a number, which Excel shortens by
       dropping its leading zeros.
   - Nothing left to pay: left out and counted.
4. **The company**
   - The file names the client, or the name kept from its last upload:
     nothing asked.
   - Another name, or none (the button writes غير محدد): saving asks to
     confirm. Once saved, that name is kept.
   - Several companies: refused, naming them.
5. **Replacing**
   - The first upload: every claim new.
   - The same file again: nothing changed but the day the figures are
     from.
   - A claim now partly paid: changed, with Partly paid.
   - A claim not in the new file: listed as going, then gone.
   - Many claims going: listed on the check screen, with no second
     question.
   - Cancel: nothing changes.
   - A failure while saving: nothing changes, with Try again.
   - Two people saving at once: the second is told the claims changed.
   - Save pressed twice: saved once.
6. **After saving**
   - One audit log entry, with the counts.
   - The client's page and the client's own page show the new figures and
     day, with what remains in all equal to the claims' sum.
   - Late counted in the company's time zone: a claim due today isn't
     late, one due yesterday is.
   - Items spelled two ways on the portal are one group.
   - Figures getting old: no badge at 29 days, the badge at 30, and none
     again after the next upload.
   - The update email (§4.4): none with the switch off; with it on, one
     to each person who has set a password and none to those invited; a
     second upload the same day sends none; an email that fails leaves
     the upload saved.
7. **On screen:** the check screen in both languages, and at phone width.

The export button, tried on a page laid out like the portal's on
2026-11-17, and to be tried on the portal itself when the owner can. The
upload (PR 3) isn't held for it (the owner, 2026-11-17): what a try
finds is fixed in the button, and nothing is saved before the check
screen:

- one company's rows, on one page or across several, with the count
  matching the portal's total;
- a filter chosen before pressing it: the file holds the filtered claims
  alone, from every page, with the count matching the filtered total;
- the filter changed on the same company: it starts again by itself, and
  the file holds the new filter's claims alone. A new visit with the same
  filter keeps what was gathered, and with another starts again;
- another company opened in the same tab, or on a new visit: it starts
  again by itself, and the file has that company alone;
- pressed twice: no row twice;
- a partly paid claim: its original, paid and remaining;
- the file's name: the company and Cairo's date.

A filter that hides open claims is the one way a file leaves claims out.
Nizmo's check screen then lists them as going, before anything is saved.

---

## 16. Open questions

None open.

Answered: a client with a tax position is archived, and deleted for good
from the archive (§3.6), on 2026-11-18; the messages are templates
(§7.1) and the export button moves into Nizmo (§10), on 2026-11-17.

---

## Change log

- **2026-11-17:** The plan written (#309), from the owner's mockup of a
  client's tax position, the Excel file the owner's export button makes
  from the Tax Authority's portal, and the button's code. The owner
  decided: a package add-on; contacting the accountant on WhatsApp; no
  tax registration number; only open claims kept; and each upload
  replacing the last. The page's blocks are in `DESIGN.md` §5.5.
- **2026-11-17:** The upload is on a client's page alone (#309, the
  owner): the file is the open client's, one company to a file, with a
  confirmation where its company isn't the client's. Uploading one file
  for several clients from the Clients page is turned down (§4.1, §14).
- **2026-11-17:** The export button holds one company at a time (#309,
  the owner): opening another company starts it again by itself, with no
  Clear to press, and its file's name has Cairo's date (§4.1, §10).
- **2026-11-17:** How it's tested (§15), at the owner's ask, the upload
  button's from the screen to the database and the export button's;
  keeping a replace safe (§4.1, proposed); three small items for later
  (§13); and the questions still open (§16).
- **2026-11-17:** The owner's answers (#309): a row with a problem stops
  the save; no second question when many claims go; each accountant's own
  WhatsApp number, not the company's; figures getting old in the build
  (§4.3); Ask about this claim on each claim, its message to be agreed
  (§7); and the proposed parts agreed. With them: what Download the
  statement holds (§8), the export button moving into Nizmo (§10,
  proposed), the build order in ten PRs (§12), and the questions still
  open (§16).
- **2026-11-17:** The owner's answers (#309): the export button moves
  into Nizmo (§10); its steps keep the portal's filter, and the button
  now starts again by itself when the filter changes on the same company,
  tried on a page laid out like the portal's (§10, §15); claims come in
  only from the portal's file, with no adding, editing or deleting by hand
  (§4.2, §14); and the WhatsApp messages are templates the Super Admin
  writes, with a company's own copy for those the Super Admin gives
  `client_messages.manage` (§7.1, §9). The build order is eleven PRs
  (§12).
- **2026-11-17:** The owner's answers on the review of the whole plan
  (#309): the built-in Admin of the companies already there gets each new
  permission in a small PR after the one that adds it (§9, §12); the item
  and the last day to pay are needed columns (§4.1); the export button's
  sections are no longer called outside Nizmo (§10, §15); an email to the
  client's people when their tax position is updated, behind a switch,
  off to start (§4.4); a line in the privacy policy (§5.5); and no switch
  to stop a company's Admins changing its messages (§7.1, §14). Twelve
  PRs, with three small ones for the permissions (§12).
- **2026-11-17:** A company with no package hasn't the client portal (the
  owner): it opens only on a package that has it, and the Super Admin
  sees it for every company (§2). Step 2 is built in three, the add-on
  on packages first (#310), with the module and the permissions moved
  to the PR whose route asks for them (§12).
- **2026-11-17:** The claims on a client's page (#311): the section as
  built (§3.5), and the tables (§3.1). `tax.view` implies `clients.view`,
  as the tax position is on the client's page (§9). `tax.manage` comes
  with the upload, whose route asks for it, and its grant after it, as
  3b (§9, §12). One open question: a client with claims being deleted
  (§16).
- **2026-11-17:** From Codex's review of #311: a page of claims that
  didn't load says so, with Try again, where the claims kept up from
  another page stood in for it (§3.5).
- **2026-11-17:** The companies already there get See clients' tax
  position (#312): a migration gives every company's built-in Admin role
  `tax.view`, as a new company's has had since #311 (§9, §12 step 2c).
  And the owner's answer on the export button: the upload isn't held for
  a try of it on the portal itself (§15).
- **2026-11-18:** The owner's answer on a client with a tax position
  being deleted (§3.6, §16): it's archived, as one with tasks or records
  is, and an archived client with no tasks and no records can be deleted
  for good from the archive. Built as step 2d (#313), before the upload
  lets claims in (§12).
- **2026-11-18:** The upload is built in four (§12 step 3): reading the
  file, saving it, the upload on a client's page, and `tax.manage` for
  the companies already there. Reading the file as built (#314, §4.1):
  a row whose status isn't an open one is left out as one with nothing
  left to pay is; what isn't read is never guessed. The export button
  is to write every claim number as text once it's in Nizmo (§12 step
  4).
- **2026-11-18:** From Codex's review of #314: an amount written with a
  decimal comma, such as 12,50 or 1.000,00, is a problem that says what
  the file had, where it was read as 1,250 and 1; and a third decimal is
  one however large the amount, where 2,000,000,000.001 was read as
  2,000,000,000 (§4.1).
- **2026-11-18:** Saving the portal's file (#315, §4.1): `tax.manage`,
  what a file is checked against, and the save, which the server checks
  again and writes in one go, with an audit log entry. A save is refused
  where another file was saved for the client since its claims were
  read, and, until it's confirmed, where the file's company isn't the
  client's. A claim number over 50 characters, or a name over 200, is a
  problem on the check screen and the server alike. No screen yet: the
  upload on a client's page is step 3c (§12).
