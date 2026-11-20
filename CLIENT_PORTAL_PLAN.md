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
is #315, and the upload on a client's page (step 3c) is #316.
`tax.manage` for the companies already there (step 3d) is #317, and
the export button's code in Nizmo, with its tests (§10, step 4a), is
#318. Its page (step 4b) is #319, and the links to it (step 4c) are
#320. Figures getting old (§4.3, step 5) is #321. Client accounts (§5,
step 6) are built in four, and the first, the accounts as they're kept
(step 6a), is #322. The invitation (step 6b) is in two: its link and the
page that sets a password (6b-1) are #324, and its email and Resend
invitation (6b-2) are #325. People who can sign in on a client's page
(6c) are #326 and #329, and `client_accounts.manage` for the companies
already there (6d) is #330. Signing in as a client account (step 7) is
built in four, and the first, keeping a client account out of the
company's app (7a), is #331, signing in finding a client account (7b) is
#332, and Forgot password for client accounts (7c) is #333. The area's
top bar (7d-1) is #334, and Change password (7d-2) is #335. The tax
position page (step 8) is built in four, and the first, what the area
reads of it (8a), is #336. Its building blocks (8b) are #337, and the
page's top (8c) is #338, and the claims by item (8d) are #339.
Contacting the accountant (step 9) is built in four, and the first, the
WhatsApp number on people's profiles (9a), is #340. The rest is built in
the small PRs of §12, each its own PR.

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
- **A client with people who can sign in is archived too** (the owner,
  2026-11-19; #329), as one with a tax position is, though it has no tax
  position, tasks or records: Delete would take their accounts in one
  step. Its menu says Archive in place of Delete, and why, and its
  people can't sign in while it's archived (§5.3). Delete permanently,
  from the archive, says that its people who can sign in go with it,
  with how many for whoever may manage who signs in for a client (by
  their role and their company's package). The audit log says how many
  went, as it does for claims.
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

As built (3c, #316): the upload on a client's page (`DESIGN.md` §5.5,
Uploading the tax portal's file).

- **Upload from the tax portal** is on the Tax position section's
  heading, for whoever holds `tax.manage`, before the first file too.
  An archived client hasn't it. One restored from its own page has it
  again at once, as its tax position is read again then.
- **The browser reads the file,** once what it's checked against has
  loaded. The reader is fetched when a file is picked, not with the
  page. Nothing of the file leaves the browser but its open claims,
  when they're saved.
- **A file refused whole** says why in a dialog: not an Excel file,
  damaged or locked with a password; over 2 MB; nothing in it; more
  than 2,000 rows; a needed column missing, named; several companies,
  named.
- **The check screen** has what this section lists. Claims that stay
  as they were are counted, not listed. What changed of a claim is
  said for its amounts and its last day to pay; anything else is said
  as its details.
- **A row with a problem** stops the save: each is listed with its
  line in the file, its claim number and why.
- **Saving** asks first where the file's company isn't the client's.
  Where the claims changed while the screen was open, it says so and
  checks the file again against them. Saved, the section reads itself
  again.
- **Closing** the upload while a file is being read calls that reading
  off: what's read after isn't shown.
- **How to get the portal's file** links to the export button's page
  (§10, step 4c): at the end of the section's line, or of its empty
  state's, for whoever has the upload; and in a new tab where a file is
  refused whole, or a row has a problem.

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

As built (step 5, #321; `DESIGN.md` §5.5, A client's tax position, for
the company's people):

- **How old** is counted from the day the figures are from to today
  where the client's company is, the same today late is counted to
  (§3.4). 29 days says nothing; 30 and more says how many.
- **On the client's Tax position** the badge comes after the line's
  words, before How to get the portal's file, for everyone who sees the
  section. The section already has both days, so nothing more is read
  for it.
- **On the Clients list** it comes after the client's name, and at the
  top of the client's card on a phone, for whoever may see tax positions
  in a company whose package has the client portal. The server counts
  it, each company's clients to that company's own today, and sends it
  only where there's a badge to show. Nobody else is sent anything of a
  client's tax position by the list. The badge is the one on the
  client's page; on the list it names the tax position to screen
  readers, as nothing around it says what wasn't updated.
- **An archived client has no badge,** on its page or in the archive:
  its figures stay as they were, and no file is due for it.
- **After the next upload** the day is the new file's, so the badge
  goes by itself.

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

As built (step 6a, #322), with no screen yet:

- **The table,** `ClientAccount`: the company and the client, a name, an
  email, the password (none until one is set), when it was invited, when
  it became active (none while it's invited), when it last signed in,
  who added it, by a name kept as it was that day, and the count that
  ends its sessions. It goes with its client, and its company.
- **An email is kept trimmed and in small letters,** so two that differ
  only in capitals are one.
- **One email, one account, held by the database.** A client account is
  refused an email one of the company's people or a Super Admin has,
  capitals aside, and a person or a Super Admin is refused one a client
  account has. Whoever saves an email holds a lock on it until the save
  is done, so two saves at once can't both pass, as usernames are held
  (#185).
- **Said where it's typed.** Adding a client's person, adding one of the
  company's people or a Super Admin, and changing one's own email each
  say the email is someone's already, before the database has to.
- **Up to 20 people for a client** (chosen in building, and easy to
  change): each one added is an invitation emailed.
- **An archived client** takes no new people, as its people can't sign
  in (§5.3). Its people are still listed, and can still be removed.

### 5.2 Adding and removing people (Decided, 2026-11-17)

- On a client's page, **People who can sign in**, with
  `client_accounts.manage` (§9): each person's name, email, and when they
  last signed in, or that they're invited.
- Add person: a name and an email. Nizmo emails an invitation, from the
  address it sends sign-in codes from, with a link to set a password. The
  link works once, for 72 hours; Resend invitation sends a new one.
- **The language they're invited in (Decided, 2026-11-19):** Add person
  asks for Arabic or English, Arabic to start, as the office knows its
  client. The invitation's email is in that language alone, never both
  in one, and the page that sets the password opens in it, as later the
  portal does. The account keeps it, as a staff account keeps its own
  language, and the person can change it in the portal.
- **Who it's from (Decided, 2026-11-19):** sent under the office's name
  alone, from the address Nizmo sends its email from. A reply goes to the
  person in the office who sent it (added the person, or resent the
  invitation), and its "for any questions" line names them and the
  office. Sent by a Super Admin, who isn't one of the office's people, it
  names the office alone and has no reply address. The words are on the
  design canvas, one artboard in each language.
- Remove: their account goes, and so do their open sessions, at once.
- Each add, resend and remove is in the audit log.

As built (step 6a, #322): the routes that list a client's people, add
one and remove one, each for whoever holds `client_accounts.manage`
(§9), in a company whose package has the client portal. Another
company's client reads as not there. Added, a person is invited; the
invitation itself, its email and the page that sets a password, is step
6b, and the section on a client's page is step 6c. Until then nothing
in Nizmo calls these routes.

- **Adding and removing ask for the step-up confirmation** (§9), as
  every use of a high-risk permission that changes something does.
  Listing doesn't.
- **The audit log** has Added a person to a client's portal and Removed
  a person from a client's portal, on the client, with the person's name
  and email.

As built (step 6b-1, #324): the invitation's link and the page that sets
a password, with no email yet (`DESIGN.md` §5.5, Setting a password from
an invitation). Until 6b-2 sends it, nobody receives a link.

- **Each person added gets a link,** which works once, for 72 hours. Its
  secret is 32 random bytes, kept only as its SHA-256, so the database
  holds nothing that opens it.
- **The secret is after a #** in the link (`/invitation#…`), so the
  browser never sends it with the page, and no server, log or referrer
  sees it. The page sends it in the body of its requests, and takes it
  out of the address bar. Another link opened in the same tab, which a
  browser doesn't load as a new page, is read in its place, and the one
  before it, answered late, is left out: the form sets the password for
  the link it was read with.
- **The page** says who invited them, for whom, their email, and asks
  for the password twice, 8 to 72 characters, as every password in
  Nizmo. Set, the account is active, the link stops working, and the
  page says so, with the email to sign in with and Sign in. Signing in
  as a client account is step 7, which may fill the email in: until then
  the sign-in page doesn't take them, and no package has the add-on.
- **A link that can't be used says why:** it has expired; it doesn't
  work any more (used, replaced or the person removed, which aren't told
  apart, as that would say which emails the office invited); or the
  office's portal isn't open to them now, where the client is archived,
  the company's package hasn't the add-on, its subscription has ended or
  it's barred (§5.3).
- **Its two routes,** reading a link and setting the password, are open
  to anyone, as a link in an email has to be. Each place has 10 tries in
  15 minutes between them, as Forgot your password's are counted. The
  password is set holding the client, then the account, in the order
  deleting a client holds them, so two at once set it once, and a client
  archived or deleted meanwhile is refused.
- **The audit log** has Set a password from an invitation, on the
  client, with the person's name and email, by no one of the company's.
- **Asked from a page,** the app's own prompt answers: the authenticator
  code, or, for someone without two-factor sign-in, the way to set it up
  (`ROLES_PLAN.md` §6.15). The prompt said the action moves money or
  can't be undone, which adding a client's person doesn't: it says This
  is a high-risk action, for every high-risk action.

As built (step 6b-2, #325): the invitation's email, and Resend
invitation (`DESIGN.md` §5.5, The invitation's email). Nothing in Nizmo
calls the routes yet: the section on a client's page is step 6c.

- **The account keeps its language,** Arabic or English. Adding a
  person takes it, and Arabic where none is sent, as Add person starts
  on Arabic. The email is in it alone, and the page that sets the
  password opens in it.
- **The email** is from the office by name, at the address Nizmo sends
  its sign-in codes from. A reply goes to the person who sent it, at the
  email their account has that moment; sent by a Super Admin, it has no
  reply address, and names the office alone. Every name in it is
  written as text, never as part of the email's code.
- **Its link is to Nizmo's own address,** never one read from the
  request: `https://nizmo.vercel.app` in production, a preview's own
  address on a preview, and the computer's own only when Nizmo runs on
  it. A link can't be pointed at another site by whoever sends the
  request (chosen in building).
- **It's sent once the save is made** (chosen in building; changed
  after Codex's review of #325). Sent inside the save, an email slower
  than the save's time limit could go out with a link the save, undone,
  never kept. Now the link is saved first, so an email only ever carries
  a link Nizmo keeps. One that can't be sent is taken back: the person
  isn't added, or, sent again, their earlier link works again. Only what
  that save made is taken back: a person who has set their password
  meanwhile stays. The office is told to try again.
- **The audit log keeps what an invitation that couldn't be sent wrote**
  (decided 2026-11-19; #328). The entry the save made stays, and another
  goes after it, written with the take-back: Couldn't send a person's
  invitation, so they weren't added, or Couldn't send a person's
  invitation again, so the link before still works. Each is on the
  client, with the person's name and email, by whoever sent it. The audit
  log is only ever added to, as the privacy policy says. Where nothing is
  taken back, as for a person who has set their password meanwhile, no
  second entry goes: the email reached them after all. An address of the kinds kept for examples
  (`.test`, `.example` and the like) is never emailed, as with every
  email Nizmo sends, and the person is added all the same.
- **Resend invitation** makes a new link, which works once, for 72
  hours, and the earlier one stops working. It's for someone still
  invited: once their password is set they sign in, or use Forgot
  password. It asks for the step-up confirmation, as adding does, and
  each person's invitation can be sent again up to 5 times an hour
  (chosen in building). It holds the client, then the account, in the
  order every other save does.
- **One at a time** (chosen in building, after Codex's second review of
  #325). A person's invitation can be sent again only 2 minutes after
  the link before it was made; sooner, it's refused with "may still be
  on its way". Two sent at once that both failed could otherwise put
  back a link neither sent, and the one the person has would stop
  working. Adding a person and Resend invitation stop within a minute,
  so the email before is sent or given up by then.
- **The audit log** has Sent a person's invitation again, on the
  client, with the person's name and email. One that couldn't be sent
  keeps it, with a second entry after it (#328, above).

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
- **The client's area is at `/portal`** (chosen in building, 2026-11-19,
  and easy to change), its routes under `/api/portal`. Step 7 is built
  in four (§12), the guard that keeps a client account out of the
  company's app first.

As built (step 7b, #332), with the client's area a page saying the tax
position comes there next:

- **Found by its email,** on the sign-in page's Email or username,
  capitals and spaces at its ends aside, as it's kept (§5.1). A username
  is only ever one of the company's people's.
- **The same lock** after too many wrong passwords, counted on the
  account (`lib/sign-in-lock.ts`). Someone invited who hasn't set a
  password yet is refused as a wrong password is, and counted alike: the
  invitation's link is how a password is set.
- **Refused once the password is right,** where the office's portal isn't
  open to its client's people (`portalOpen`, as the invitation's page is
  held to, #324): the company's package hasn't the client portal, or it
  has no package; its subscription has ended; the company is barred; or
  the client is archived. The sign-in page says the office's portal isn't
  open now, and to contact the office. The try is given back, as for one
  of the company's people turned away with the right password.
- **Removed,** an account is no one's, and its email is refused as one
  nobody has.
- **Signed in:** when is kept as the account's last sign-in, shown on
  People who can sign in. The session says it's a client account's, for
  its client and company, with the person's name, email and language; it
  holds no permissions, and two-factor isn't asked (§13).
- **An open session ends** within a minute (the check a person's session
  has) where the portal closes for any reason above, the account is
  removed, or its sessions are ended, as a new password from Forgot
  password will end them (7c). A check that fails ends it, as for a
  person.
- **The audit log** has each sign-in, and each wrong password, under the
  client, naming the person and email, as adding one does (#322). They're
  in the Super Admin's audit log: a company's lists what its own people
  did.
- **The client's area** opens in the account's language, with the
  client's name above Tax position, a line saying the tax position will
  be shown there soon, and Sign out, in both languages, on phones as on
  computers. The top bar and account menu are 7d; the page itself is
  step 8.

As built (step 7c, #333), on the sign-in page's Forgot your password, with
no screen changes:

- **Found by its email,** capitals and spaces at its ends aside, as signing
  in finds it, where no person or Super Admin has the email. It's emailed
  the code a person is, from the same address, in English as theirs is for
  now. The page says the same whoever the email is, as it does today, so it
  tells no one which emails the office invited.
- **Only someone whose password is set** is sent a code. Someone invited
  sets theirs from the invitation's link, which the office can send again
  (§5.2), and gets no code (my choice, easy to change).
- **The new password** ends their open sessions within a minute (7b's
  check) and lifts a sign-in lock, as for a person. The audit log has it
  under the client, naming the person, for the Super Admin, as their
  sign-ins are.
- **Whether the office's portal is open isn't asked:** a new password opens
  nothing by itself, and signing in still says the portal isn't open now.

As built (step 7d-1, #334), the client's area's top bar (`DESIGN.md` §5.5):

- **At its start,** the company's mark and name, as at the top of the
  company's side bar: its logo, or its name's first letter.
- **At its end,** the language switch and the account menu. The menu has
  the person's name, with their client's name under it, then Sign out,
  which moves there from the page. Change password joins it in 7d-2.
- **The language picked there is the account's,** as a person's choice is
  theirs (§5.2): the area opens in it next time, and the emails to them
  will be in it. It's saved by the area's own route, `/api/portal/language`.
- **In the company's brand colour,** its own or the system's default, as
  the company's people see it (`UI_PLAN.md` §4.6). It's read with the
  company's name and logo, once each time a page is drawn.
- **On phones,** the company's name gives way first. The language switch
  shows EN and ع, and the account button the person's initials alone, as
  on the company's top bar, on computers too since the owner's answer of
  2026-11-20.
- No theme switch, notifications or search, as `DESIGN.md` has it.

As built (step 7d-2, #335), Change password, from the account menu, on a
page of the area's own:

- **It asks for the current password,** then the new one twice, as the
  company's people's Change password asks it, its hint saying how long it
  must be: 8 to 72 characters. The server checks the current one, with
  the five wrong tries in fifteen minutes a person's own password has,
  then none until the fifteen minutes are up.
- **The new password ends their other sessions** within a minute (7b's
  check), and keeps the one it was changed from, as a person's does
  (#228). The page goes back to Tax position, saying the password was
  changed.
- **The audit log has it** under the client, naming the person, for the
  Super Admin, as their sign-ins are.
- My choices, easy to change: the current password is a field on the
  page, rather than asked in a window after Save as a person's profile
  asks it, as the page has nothing else to save. Too many wrong tries says
  to try again within 15 minutes, as no one at the office can lift that
  for a client's person.

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
- **By item, and how late:** bars by part. How late starts with what's
  not due yet, then under 6 months, 6 months to a year, 1 to 2 years and
  more than 2 years since the due date (decided 2026-11-19), so the late
  rows hold only what's late.
- **The claims:** by item, opening to each claim, with a total row.
  Each claim has Ask about this claim (§7).
- **A note:** in Egyptian pounds, as they were on the portal that day,
  with penalties for paying late not counted.
- **Before the first upload:** the page says the office hasn't added the
  tax position yet.
- Both languages, and phones as well as computers.

As built (step 8a, #336), what the page is given, from the server
(`lib/portal-tax.ts`, `portalTaxPosition` in
`lib/services/tax-claim.service.ts`), with no screen yet:

- **The session's client's claims alone,** read only where the client is
  the session's company's, whatever else is asked; anything else reads as
  not there.
- **Late counted in the company's own days,** as on the client's page
  (§3.4), so the area and the office agree.
- **What's owed in all:** the original, paid and remaining amounts, how
  many claims are open and late, and the oldest delay in days.
- **By item:** each item's claims, the oldest due first, with what they
  come to, the earliest due date and the badges its claims have; the
  largest remaining first, and items owing the same by name.
- **An item's spellings are one item** (§3.3), matched as the upload
  matches headings and statuses. Each claim keeps the portal's own
  spelling. The item is shown by:
  - its correct spelling, for the usual items: إقرار تجاري, إقرار شهري,
    إقرار ضريبة الدخل, إقرار القيمة المضافة, مساهمة تكافلية - تأمين صحي
    and مساهمة تكافلية لصندوق أسر الشهداء (`USUAL_ITEMS` in
    `lib/portal-tax.ts`);
  - otherwise the spelling the portal wrote most often. Two written as
    often go by text order, so the name doesn't change with the claims'
    order.
- **By how late:** every row, even at nothing, in order: not due yet, then
  under 6 months, 6 months to a year, 1 to 2 years and more than 2 years,
  counted in whole months from the due date. A month too short for the
  day counts from its last day, so 31 August and 6 months is the end of
  February.
- **The day the figures are from,** or none before the first upload.

As built (step 8b, #337), the page's building blocks, from `DESIGN.md`
§3.2 and §5.5, in `components/ui/Bars.tsx`, with no page using them yet:

- **Bars by part** (`BarsByPart`): a row for each part, its name, a bar
  and its amount, the note under the amount; the largest first, or in
  the parts' own order (how late keeps its order). The largest bar fills
  the space and the rest are to scale, at least 4px long; a part at
  nothing has none. Every row takes the list's columns, so every bar is
  drawn against the same width, whatever its amount and note. A name too long for its row is cut short at its own
  end, so an item's Arabic name on the English page keeps its first
  words, and pointing at a row shows it whole with its amount.
- **The share bar** (`ShareBar`): how much is paid in words, the two
  amounts at its end (under it on phones), over the bar.
- **The large figure** (`LargeFigure`): the amount owed in `--text-hero`,
  48px and 36px on phones, its currency after it.
- They're on the Super Admin's building blocks page, in both languages,
  with a client's figures made up for it.

As built (step 8c, #338), the page's top, on the client's area's first
page (`components/portal/PortalHome.tsx`, `app/(portal)/portal/page.tsx`),
where the line saying it comes soon was, as the owner's mockup draws it
(the Client tax position canvas):

- **What it's given:** the session's client's position, read on the
  server with the session's company and client (8a). A client deleted
  since the session's last check ends the session, as an ended session
  does; anything else that goes wrong is an error.
- **The header:** the client's name above Tax position, and "From the Tax
  Authority's portal, last updated" the day the figures are from. The
  accountant joins it with step 9.
- **What's owed,** in a panel headed by its label, What the company owes:
  what remains as the large figure, EGP after it, and under it a Problem
  badge with a warning icon while claims are late, such as "3 claims
  late", or "All open claims are late" where there's more than one and
  all are. Beside it, twice its width (under it on phones), how much of
  the open claims' original amounts is paid, to the nearest whole
  percent and 99% at most while something is left ("16% of the total
  claims paid", "7,365.00 of 46,163.37 EGP"), then, under a line, three
  facts: open claims, paid with its currency, and the oldest delay in
  days, or None. On phones the facts are one to a line, between lines,
  and the share paid's amounts go under its bar.
- **Two cards of bars,** each title with a line under it: what's owed by
  item, the largest first, each with its share of what's owed and its
  claims; and how late, from the last day to pay until today, every row
  in its order with its claims, or No claims. The two usual items with
  long names go by short ones in the bars (تأمين صحي and صندوق أسر
  الشهداء); their full names are there when pointed at and for screen
  readers. The amounts on the page are in the currency the large figure
  names, as the note says.
- **The note,** at the page's end, under the claims' card (8d), in small
  muted text: in Egyptian pounds, as on the portal
  that day, penalties for paying late not counted, and to contact the
  office about any claim until step 9 brings the accountant.
- **Before the first upload,** an empty state says the office hasn't added
  the tax position yet, with no subtitle. **A file with nothing open in
  it** says nothing was owed on the portal that day, under the subtitle,
  with no cards or note.

As built (step 8d, #339), the claims by item, a card under the two cards
of bars and above the note (`components/portal/PortalClaims.tsx`), as the
owner's mockup draws it:

- **On computers, a table** titled Claims, with "Select an item to see
  its claims" at its end: Item, Claims, Original, Paid, Remaining,
  Earliest due date and Status. Each item is a row, the largest
  remaining first, with its claims' badges. The whole row opens its
  claims under it; its name is the button a keyboard and a screen reader
  use, saying whether it's open. The largest item is open at first.
- **Each claim** is a row on the page's colour, set in under its item's
  name: its number in Latin digits, left to right, above its period
  ("Year 2025", "November 2025", or its two days), then its amounts,
  last day to pay and badges. An item's claims go the latest last day to
  pay first.
- **A total row** at the foot: how many claims, and the original, paid
  and remaining amounts in all.
- **On phones, cards:** each item a card that opens, with how many claims
  and what remains with its currency, then its badges; each claim a card
  with its number and badges, its period and last day to pay, and its
  three amounts; then the total ("Total, 5 claims") over the three
  amounts in all.
- **Badges:** Partly paid, then Late, where a claim has both, as every
  artboard of the mockup draws them. The section for the company's people
  (§3.5) has them in the same order now.
- The table is 940px at the least and scrolls sideways in its card on a
  narrower page. Ask about this claim comes with step 9.

---

## 7. Contacting the accountant (Decided, 2026-11-17: WhatsApp)

- Each client gets a **responsible accountant**: one of the company's
  people, picked on the client's page with `clients.manage`. The client
  sees their name.
  - **As built (#343):** `Client.responsibleAccountantId`, a person of
    the client's own company, or none. Picked at the foot of the client's
    Tax position section, as the owner's mockup draws it, by whoever may
    manage clients, and saved as it's picked (`PUT
    /api/clients/accountant`); the same route's GET lists who may be
    picked. In the audit log as `SET_CLIENT_ACCOUNTANT`, with who it was
    and who it is.
  - Who may be picked: one of the client's company's people whose
    contract hasn't ended (not `ARCHIVED` or `DELETED`). The server
    refuses anyone else, an archived client, and a company whose package
    hasn't the client portal (`NOT_IN_PACKAGE`), as the WhatsApp number
    is refused.
  - Whose contract ends stays picked, and the client's people can't
    write to them until another is: the section says so, with the way to
    fix it. A person deleted outright is no one's (`ON DELETE SET
    NULL`).
  - Who the client's people can write to is read by
    `lib/client-accountant.ts`, for the section now and for the client's
    own page with 9c: the accountant, with a WhatsApp number, whose
    contract hasn't ended.
  - A person's Contacting clients card names the clients they answer
    for, an archived client left out.
- **The accountant's own number** (Decided, 2026-11-17): the person who
  answers for the client is the one written to. Each of the company's
  people can have a WhatsApp number on their profile, set by them or by
  whoever can edit their profile, with a hint that the clients they're
  responsible for can write to it.
  - It's typed as an Egyptian mobile (01…) or with its country code
    (+…), and kept with its country code.
  - **As built (#340):** `User.whatsappNumber`, kept as "+201001234567",
    a CHECK holding its shape. Read by `lib/whatsapp-number.ts`, on the
    profile and on the server alike: an Egyptian mobile from 010, 011,
    012 or 015, or any number with its country code (+, or 00), 8 to 15
    digits; spaces, dashes, dots, brackets and Arabic digits are taken as
    typed. Saved with the profile's own save (`PUT /api/users`), so the
    same people may change it and it's in the audit log as a profile
    change; empty takes it away. The server refuses it where the
    company's package hasn't the client portal (`NOT_IN_PACKAGE`), and on
    a Super Admin's, who answers for no client. On the profile's form, a
    card of its own, Contacting clients, with its own Save
    (`components/profile/WhatsAppCard.tsx`).
- **Contact the accountant** opens a dialog (`DESIGN.md` §5.5, Contact
  on WhatsApp): the accountant, and a message ready to send, which can be
  changed. Open WhatsApp opens `https://wa.me/<number>?text=<message>` in
  a new tab: the app on a phone, WhatsApp Web on a computer.
  - **As built (#344):** the client's page reads, with its tax position,
    who its people can write to (`portalAccountant`, from the session's
    client): the accountant's name and number, and nothing of their role
    or account. Their name is in the page's subtitle where they're
    picked and their contract hasn't ended; Contact the accountant is
    there where they have a number, before the first file too. The
    message is Nizmo's own (§7's), in the page's language, from the
    client account's name and the client's, with the day the figures are
    from where there are any (`lib/contact-message.ts`, until step 10's
    templates). The dialog is `components/portal/ContactWhatsApp.tsx`,
    drawn as the owner's mockup draws it (`DESIGN.md` §5.5, Contact on
    WhatsApp); 9d opens it from each claim. Its Open WhatsApp is a new
    building block, `ButtonExternal`: a link that looks like a button, to
    another site, opening in a new tab, which it says to screen readers.
- **Ask about this claim** (Decided, 2026-11-17): on each claim, opening
  the same dialog with that claim's message.
  - **As built (#345):** an icon button after each claim's badges, in
    the table and on the phone's cards, named with the claim's number,
    where Contact the accountant is there. It opens the same dialog,
    titled "Ask about a claim", with Nizmo's own message for the claim
    (`claimMessage` in `lib/contact-message.ts`, until step 10's
    templates): its number in Latin digits, the item as the page names
    it, what remains of the original in the page's digits, and its last
    day to pay. The note under the claims says the message button in a
    claim's row (its card on phones) opens WhatsApp with its number.
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
  (`ROLES_PLAN.md` §6.15). It comes with its routes in #322 (step 6a),
  labelled Lets outsiders in on the role editor. Its grant for the
  companies already there is #330 (step 6d).
- The built-in Admin holds all four. Other roles get them where the Super
  Admin ticks them, as only the Super Admin builds roles.
- They go into `ROLES_PLAN.md`'s tables with the PR that adds them to the
  catalogue, as `lib/plan-docs.test.ts` holds those tables to it.
- The built-in Admin role of each company already there gets them in a
  small PR of its own after the one that adds them, as the terminals'
  (#278) and missions' (#284) permissions did (§12). `tax.view`'s is
  #312: a migration gives it to the built-in Admin alone, company-wide.
  An Admin role holding it already, a new company's, is left as it is;
  the others' holders reload their grants once. `tax.manage`'s is #317
  (step 3d), the same way, once #315's release, whose role editor knows
  it, is live. `client_accounts.manage`'s is #330 (step 6d), the same
  way, once #322's release, whose role editor knows it, is live; what it
  brings with it, `clients.view`, every built-in Admin role holds.

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
- It keeps nothing in the browser from one visit to the next (step 4a,
  #318): the rows it gathers are gone once the portal's page is closed or
  loaded again. The owner's copy kept them there until another company
  was opened or Clear was pressed, so on a shared computer the next
  person could see the last client's claims.
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
  - that the file holds what the portal shows when Download is
    pressed, the button gathering again first where the page has
    changed since;
  - that it keeps nothing in the browser once the portal's page is
    closed.

  The upload's dialogs and the Tax position section link to it, by How
  to get the portal's file. Staff then always drag the newest copy from
  one place, and
  the separate install page goes. The button still runs on the portal's
  page, in the staff's own browser.
- **Its code in Nizmo, as built** (step 4a, #318):
  - the code is `lib/tax-export-button.ts`, kept as text. It runs on
    another site's page, where nothing of Nizmo's is, so it stands
    alone and isn't built with the app. Its panel's words are the
    owner's, as they were;
  - `taxExportBookmark()` makes the bookmark's address from it, for the
    page (step 4b) to show;
  - a claim's number is always text. One with no zero at its start was
    written as a number, which the upload refuses (§15);
  - it keeps nothing in the browser, and removes what an older copy
    kept there, a claim's number among it as a number. Until one of the
    staff drags the new button, their old one still writes numbers so,
    and the upload's check screen says why its file can't be saved;
  - **a file is what the portal shows when it's saved** (from Codex's
    review of #318). The owner's copy held on to what it first read of
    a claim, and to the rows of a filter that showed as many claims as
    the next one, from one visit to the next too:
    - a claim seen again takes the values the portal shows now;
    - every gathering of the pages starts from nothing;
    - holding more rows than the portal counts, it takes the ones it
      had as another filter's, and starts again from the screen. A
      count that can't be the table's, with more rows on one screen
      than it, is left alone, and its panel warns as before;
    - Download saves at once only what was gathered whole, with the
      portal's count, in the last five minutes, and with nothing drawn
      on the portal's page since: one page read alone, or every page
      in one go. Otherwise it gathers again first. Pressed while the
      pages are being gathered, it waits for the last of them; where a
      page doesn't come, it saves no file;
    - a gathering started on a later page goes back to the first, and
      stops where that page doesn't come, as it does for any other
      (from Codex's second review). It used to go on from the page on
      the screen, as if that were the whole table. The pages' buttons
      may mark the one shown as `aria-current="page"` as well as
      `"true"`, so the first page isn't asked for where it's already
      shown;
    - where the rows it holds still aren't as many as the portal
      counts, Download asks before it saves: the panel's own words for
      it, then تنزيل الملف برضه؟ ("download the file anyway?"). Its
      panel's warning used to be there to see before Download was
      pressed. Now that Download may gather again by itself, it might
      first show as the file is saved;
    - the portal's filter isn't read from its page. The button reads
      the table, the count and the pages' buttons, which is all it
      knows of that page, so what it holds is checked against what the
      portal shows instead;
  - **it knows which copy it is** (from Codex's review of #318): its
    version is its own code's fingerprint, so it changes with any
    change to the code. Pressed where the same copy is up, that copy
    gathers again, as before. Pressed where another is up, that one is
    stopped and its panel goes, and this one takes its place. Before
    this, an older copy answered the press itself, and went on writing
    claim numbers as numbers. The owner's first copy knows no way to be
    stopped: its panel goes and nothing more is asked of it, and it's
    gone when the page is next loaded;
  - it's tested in two ways (§15): the part of it that needs no page on
    every push, and the whole of it in a browser, by a run kept with
    the code.
- **Its page, as built** (step 4b, #319; `DESIGN.md` §5.5, The tax
  portal's export button):
  - at `/dashboard/tax-export`, for whoever has `tax.manage` where the
    package has the add-on. It isn't in the side bar: the links to it
    are step 4c, below;
  - the button is dragged from it to the bookmarks bar on a computer,
    and is named Export claims there, in the page's language. For
    whoever can't drag, Copy address gives the bookmark's address, to
    add by hand. A phone has neither, and says the button is added on
    a computer;
  - pressed on Nizmo's own page, the button does nothing but say that
    it's dragged;
  - its steps and what to know are as listed above. It also says that
    each file is one company's, with one filter, and that a bookmark
    keeps the copy it was made from.
- **The links to it, as built** (step 4c, #320): one link, How to get
  the portal's file, in three places, for whoever has the upload. It's
  named for the portal's file, not "this file", as it's read beside a
  file that was refused:
  - on a client's Tax position, at the end of the line under the
    section's title, which names the portal's file, or of the empty
    state's line before the first file. It isn't on the section's
    heading, which the upload's button fills on a phone. An archived
    client hasn't it, as it hasn't the upload;
  - where the upload refuses a file whole for what the file is: not an
    Excel file, over 2 MB, nothing in it, too many rows, a column
    missing, or several companies. It isn't there where the file's
    reader didn't load, or the client's claims couldn't be read, as
    another file wouldn't help;
  - where a row has a problem, at the end of the note that stops the
    save. A file from a copy of the button older than step 4a is
    refused this way, and the page has the new one to drag. The row's
    own words now say so: a claim number kept as a number is what
    Excel leaves on saving the file, or an older copy of the export
    button.

  In the upload's dialogs it opens in a new tab, so the file's check
  stays as it is, and says so to screen readers. On the client's page
  it opens in the same tab. As a file is refused, the focus stays on
  Close, where it was before the dialog had a link. On a phone the link
  is 44px under a finger, laid over its line so no line around it
  moves.

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
     the check screen, and saving. #316.
   - **3d.** `tax.manage` for the built-in Admin of the companies
     already there, from a migration, once #315's release, whose role
     editor knows it, is live. #317.
4. **The export button in Nizmo** (§10), in three:
   - **4a. Its code and tests** in the repository, with the bookmark's
     address made from it. It then writes every claim number as text:
     the owner's wrote one with no zero at its start as a number, which
     the upload refuses as a number that may have lost its zeros (§15).
     Its tests read its file with Nizmo's reader. No screen yet. #318.
     After Codex's review of it, a file is what the portal shows when
     it's saved, nothing is kept in the browser, and a copy knows which
     one it is (§10).
   - **4b. Its page,** The tax portal's export button, for whoever has
     `tax.manage` where the package has the add-on. #319.
   - **4c. The links to it,** How to get the portal's file, from the
     upload's dialogs and the Tax position section. #320.
5. **Figures getting old** (§4.3): the badge on the client's page and the
   Clients list. #321.
6. **Client accounts** (§5), in four:
   - **6a. The accounts, kept:** their table, one email to one account
     across Nizmo, `client_accounts.manage`, and the routes that list a
     client's people, add one and remove one. No screen and no
     invitation yet. #322.
   - **6b. The invitation,** in two:
     - **6b-1.** Its link, which works once for 72 hours, and the page
       that sets a password from it. No email yet. #324.
     - **6b-2.** Its email, from the address Nizmo sends sign-in codes
       from, in the language the person is invited in (§5.2), which the
       account keeps; and Resend invitation, which makes a new link and
       stops the old one. #325.
   - **6c. People who can sign in,** on a client's page, in two:
     - **6c-1 (#326).** The section, after Tax position, with Add person
       and the language they're invited in, Resend invitation and Remove;
       and the privacy policy's line (§5.5), which comes with the first
       screen that sends an invitation.
     - **6c-2 (#329).** Delete permanently (§3.6) says that a client's
       people who can sign in go with it, and how many; and a client
       with people who can sign in is archived on Delete, as one with a
       tax position is (decided 2026-11-19).
   - **6d.** `client_accounts.manage` for the built-in Admin of the
     companies already there, from a migration, once #322's release,
     whose role editor knows it, is live. #330.
7. **Signing in as a client account, and the client's area,** in four,
   each its own PR (split 2026-11-19), the guard first, so no one can
   sign in as a client account before every page and route of the
   company's app refuses one:
   - **7a. Kept out of the company's app.** A client account's session
     is told apart from a person's and a Super Admin's, and nothing
     outside the client's area, at `/portal`, takes it:
     - the proxy sends it from the company's pages, the sign-in page
       and the root to `/portal`, and sends one of the company's people
       from `/portal` to the dashboard;
     - every route through `withStandardHandler` refuses it, unless the
       route is one of the area's own, which says so, and only the
       area's routes, under `/api/portal`, may;
     - the routes that read a session another way take only a Super
       Admin, a cron's secret or no one, and a test holds every route
       to one of these;
     - an error in a route a client account reached is logged with no
       one of the company's people or Super Admins named.

     No sign-in makes such a session yet: the tests make one by hand.
     #331.
   - **7b. Signing in finds a client account,** on the same sign-in
     page, with the same lock after too many wrong passwords, and lands
     in the client's area, on a page saying the tax position comes there
     next. Signing in is refused, and an open session ends, where §5.3
     says, with its words; the account's last sign-in is kept. #332.
   - **7c. Forgot password** for a client account, on the same page, as
     for the company's people. #333.
   - **7d. The area's top bar and account menu** (`DESIGN.md` §5.5),
     with Change password and Sign out, in the company's brand colour,
     in two:
     - **7d-1.** The top bar: the company's mark and name, the language
       switch, which keeps the language picked as the account's, and the
       account menu with the person's name, their client's name and Sign
       out. #334.
     - **7d-2.** Change password in the account menu, on a page of the
       area's own, as for the company's people. #335.
8. **The tax position page,** in four:
   - **8a. What the area reads of it:** the session's client's claims,
     what's owed in all and by item, how late, and the oldest delay,
     late counted in the company's days, as on a client's page. No
     screen; with its tests. #336.
   - **8b. Its building blocks:** bars by part, the share bar, and the
     page's one large figure (`DESIGN.md` §3.2, §5.5). #337.
   - **8c. The page's top:** its header, what's owed, the two cards of
     bars, the note, and the page before the first upload. It replaces
     the line saying the tax position comes soon. #338.
   - **8d. The claims by item:** a table on computers and cards on
     phones, each item opening to its claims, with a total row. #339.

   The accountant's name, Contact the accountant and Ask about this
   claim come with step 9, and Download the statement with step 12.
   Until step 9, the note says to contact the office.
9. **Contacting the accountant on WhatsApp:** the number on people's
   profiles, the responsible accountant, the dialog, Ask about this
   claim, and the messages. In four PRs (split 2026-11-20), each with its
   own `DESIGN.md` block as the owner's mockup draws it:
   - **9a. The WhatsApp number on people's profiles** (§7): a card of its
     own on the profile's form, Contacting clients, where the package has
     the add-on, for the person and whoever may edit their profile. Kept
     with its country code, in the audit log as a profile change. #340,
     as built in §7.
   - **9b. The responsible accountant** (§7): picked on the client's page
     with `clients.manage`; the profile's card names the clients they
     answer for; the Tax position section says why the client can't write
     to them, with the way to fix it. #343, as built in §7.
   - **9c. Contact the accountant** (§6, §7): the accountant's name under
     the client's page title, the button, and the dialog, with Nizmo's
     own message until the templates (step 10). Without a number, the note
     says to contact the office, as now. #344, as built in §7.
   - **9d. Ask about this claim** (§7): on each claim, in the table and on
     the phone's cards, opening the same dialog with that claim's
     message. #345, as built in §7.
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
  the file holds the new filter's claims alone;
- another company opened in the same tab, or on a new visit: it starts
  again by itself, and the file has that company alone;
- pressed twice: no row twice;
- a partly paid claim: its original, paid and remaining;
- the file's name: the company and Cairo's date.

In Nizmo (step 4a, #318), also:

- every claim's number as text, one with no zero at its start too;
- nothing kept in the browser, and what an older copy kept there
  removed and not read;
- a new visit starts from nothing: a claim has what the portal shows
  then, and one paid since isn't in the file, though as many wait as
  before;
- a claim seen again takes the values the portal shows now;
- Download:
  - at once, where every page was gathered a moment ago, and again
    after it;
  - gathering every page again first where the portal drew its table
    again since, where the page was left open for more than five
    minutes, and where rows of two filters were gathered by hand,
    their count the portal's;
  - reading the screen again where the portal drew another filter's
    claim a moment before;
  - waiting for the pages where it's pressed while they're gathered,
    and saving one file where it's pressed twice;
  - no file where a page never comes, the first one it goes back to
    among them;
- a filter that shows as many claims as the one before it, on one page
  and on more;
- a count on the page that can't be the table's: no row is let go for
  it, and Download asks before it saves;
- fewer rows than the portal counts, even gathered again: Download asks
  first, and saves nothing where the answer is no;
- pressed where an older copy is up: this one takes its place. One that
  can be stopped is stopped, and asks the portal for no more pages;
- Clear, which asks first; a page that names no company; and a page
  with no table, where Download saves nothing;
- nothing asked of any other address while it runs.

How it's tested there, as it runs on another site's page. No new package
is added for it (the owner, 2026-11-18):

- **On every push:** its code is read as text, for what it must and
  mustn't have, and the part of it that needs no page is run as it is:
  how a cell's words are read, the file's name, the file it writes,
  which Nizmo's reader reads back, and what it holds of the portal's
  table from one reading of it to the next.
- **In a browser, by a run kept with the code**
  (`scripts/tax-export-browser-run.mjs`): Chromium presses the bookmark
  on a page laid out like the portal's that holds made-up claims, its
  clock at half past midnight in Cairo, and checks the lists above.
  Only when every check passes does it keep the files the button
  saved, with the code's fingerprint, in `lib/tax-export-fixtures`.
- **The two tied together:** every push reads the kept files with
  Nizmo's reader, and checks the fingerprint against the code. Code
  changed since it was tried in a browser fails, until the run is done
  again.

A filter that hides open claims is the one way a file leaves claims out.
Nizmo's check screen then lists them as going, before anything is saved.

Client accounts, as they're kept (step 6a, #322), against a real
Postgres:

- an email is one account's across the company's people, Super Admins
  and client accounts, capitals aside, each way round, and for two
  saves at once;
- adding, listing and removing: for whoever holds the permission, of a
  client in their own company, with the Super Admin for any company's;
- refused, each saying why: no name or one too long, something that
  isn't an email, an email someone has, an archived client, a client
  with 20 people already, another company's client or person;
- an account goes with its client, and the audit log has each add and
  remove.

Setting a password from an invitation (step 6b-1, #324), against a real
Postgres and in a browser:

- a link works once, for 72 hours, and only its own account's;
- the password asked twice, 8 to 72 characters;
- an expired link, a used one, one for a removed person, and the
  office's portal closed, each said as it is;
- two set at once: one sets it, the other is told the link doesn't work;
- the secret never reaches the server in the address, and leaves the
  address bar; another link opened in the same tab is read, and the one
  before it, answered late, is left out;
- a client archived, or deleted, while the password is being set: refused,
  with no one kept waiting;
- both languages, at phone width and on a computer.

And through the running app, as each kind of account: refused without
the add-on, without the permission, and for another company's client;
adding refused until the step-up confirmation is given, with the app's
own prompt coming up on a page; and the permission's row in the role
editor, labelled Lets outsiders in, in both languages.

---

## 16. Open questions

None open.

Answered: an invitation that couldn't be sent keeps its audit log entry,
with a second saying it couldn't be sent (§5.2), on 2026-11-19; a client
with a tax position is archived, and deleted for good from the archive
(§3.6), on 2026-11-18; the messages are templates
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
- **2026-11-18:** The upload on a client's page (#316, §4.1 as built
  3c): Upload from the tax portal on the Tax position section, the file
  read in the browser, a file refused whole saying why, the check screen
  with what's new, changed and going, a row with a problem stopping the
  save, and the confirmation where the file's company isn't the
  client's. Its `DESIGN.md` block is Uploading the tax portal's file.
- **2026-11-18:** From Codex's review of #316: a client restored from
  its own page has Upload from the tax portal again at once, where the
  Tax position section kept it as archived until the page was opened
  again; and closing the upload while another file is being read calls
  that reading off, where the file read after opened the check screen
  again (§4.1).
- **2026-11-18:** The companies already there get `tax.manage`, Update
  clients' tax position from the tax portal's file (#317): a migration
  gives it to every company's built-in Admin role, as a new company's
  has had since #315 (§9, §12 step 3d). Their Admins then have Upload
  from the tax portal on a client's Tax position, where the company's
  package has the client portal.
- **2026-11-18:** The export button's code in Nizmo, with its tests
  (#318, §10, §12 step 4a, §15). Step 4 is in three: the code, its
  page, and the links to it. The code is the owner's, kept as text,
  with a claim's number always text, and what the copy before it kept
  removed from the browser. No new package for its tests (the owner,
  2026-11-18): the part that needs no page is run on every push, and a
  run in a browser, kept with the code, tries the whole of it and keeps
  the files it saved, which every push reads with Nizmo's reader.
- **2026-11-18:** From Codex's review of #318, three findings on the
  export button's code, all fixed (§10, §15):
  - a claim seen again kept what was first read of it, so one paid in
    part since was saved with what was left before, on later visits
    too. It now takes what the portal shows, and nothing is kept in the
    browser from one visit to the next;
  - a filter that showed as many claims as the one before it kept the
    last filter's rows. More rows than the portal counts now start it
    again from the screen, every gathering of the pages starts from
    nothing, and Download gathers again first unless every page was
    gathered a moment ago with nothing drawn on the page since;
  - a new copy pressed where an older one was up left the older one
    answering. A copy now knows which one it is, and takes another's
    place.

  The note for a shared computer goes from the button's page (step
  4b): nothing of a client's stays in the browser. What the button
  holds of the portal's table is in the part that needs no page, so
  it's run on every push, and the browser run has 32 checks. Each rule
  of the fix was taken out in turn, and the run failed without it.
  One thing more than the review asked for: Download asks before it
  saves a file whose rows aren't as many as the portal counts.
- **2026-11-18:** From Codex's second review of #318: a gathering
  started on a later page stops where the first page doesn't come, as
  it does for any other page. It used to go on from the page on the
  screen, so Download could offer that page's rows as the whole table.
  The pages' buttons may mark the one shown either way a browser's
  pages do, so the first page isn't asked for where it's already shown
  (§10, §15).
- **2026-11-18:** The export button's page (#319, §10, §12 step 4b):
  The tax portal's export button, at `/dashboard/tax-export`, with the
  button to drag to the bookmarks bar, Copy address for whoever can't
  drag, its steps and what to know. Its `DESIGN.md` block is The tax
  portal's export button. The links to it are step 4c.
- **2026-11-18:** The links to the export button's page (#320, §10,
  §12 step 4c): How to get the portal's file, at the end of the Tax
  position section's line or its empty state's for whoever has the
  upload, and in a new tab where the upload refuses a file whole or a
  row has a problem. It isn't on the section's heading, which the
  upload's button fills on a phone. A claim number kept as a number is
  said to be Excel's doing or an older copy of the export button's.
- **2026-11-18:** Figures getting old (#321, §4.3, §12 step 5): Not
  updated for N days, from 30 days after the day the figures are from,
  on the client's Tax position and after the client's name in the
  Clients list. It's counted to today where the client's company is.
  An archived client has none.
- **2026-11-19:** Client accounts are built in four (§12 step 6): the
  accounts as they're kept, the invitation, People who can sign in on a
  client's page with the privacy policy's line, and the permission for
  the companies already there. The first is #322 (§5.1, §5.2, §9): the
  `ClientAccount` table, one email to one account across the company's
  people, Super Admins and client accounts, held by the database,
  `client_accounts.manage`, high-risk, and the routes that list, add
  and remove a client's people. Chosen in building: an email is kept in
  small letters, a client has up to 20 people, and an archived client
  takes no new ones.
- **2026-11-19:** The invitation is built in two (§12 step 6b): its link
  and the page that sets a password (6b-1, #324), then its email and
  Resend invitation (6b-2), whose words wait on the owner. Chosen in
  building: the link's secret is after a #, so no server or log sees it;
  a used link, a replaced one and a removed person's are told apart from
  an expired one but not from each other; each place gets 10 tries in 15
  minutes; setting the password sends them to sign in, which takes
  client accounts from step 7; and another link opened in the same tab
  is read in its place.
- **2026-11-19:** Codex's two findings on #324, fixed before it's
  merged: setting a password held the account, then its client, where
  deleting a client holds the client, then its people, so the two could
  each wait on the other and the database end one. It holds the client
  first now. And another link opened in the same tab while the first
  was still being read could have the first's answer arrive last, so
  the form showed one person's email over another's link. The page
  leaves out an answer for a link it no longer has, and the form sets
  the password for the link it was read with.
- **2026-11-19:** Decided with the owner (§5.2): the invitation's email
  is in one language, the one the office picks for the person on Add
  person, Arabic to start; never Arabic and English in one email. The
  page that sets the password, and later the portal, open in it, and the
  account keeps it. The email's words are drafted on the design canvas,
  one artboard in each language; the name it's sent under, where a reply
  goes and whether it names the accountant wait on the owner.
- **2026-11-19:** Decided with the owner (§5.2): the invitation's email
  is sent under the office's name alone, from Nizmo's address; a reply
  goes to the person in the office who sent it, and the email names them
  and the office. Chosen in writing it down: one sent by a Super Admin
  names the office alone, with no reply address.
- **2026-11-19:** The invitation's email and Resend invitation (§5.2,
  step 6b-2) are #325. Chosen in building: the link is to Nizmo's own
  address, never one the request gives; the email is sent as the save
  ends, so one that can't be sent saves nothing; Arabic where no
  language is sent; Resend is for someone still invited, up to 5 times
  an hour for each person.
- **2026-11-19:** Found while building the invitation's email (#325):
  Nizmo's plain email, which payslips, final settlements and subscription
  notices go out in, wrote each line into its HTML as it was, so a name
  with a < or & in it, a person's or a company's, was read as HTML. Each
  line is written as text now, with the same helper the invitation's
  email uses; the plain-text part is as it was.
- **2026-11-19:** Changed after Codex's review of #325: the invitation's
  email is sent once the save is made, not as part of it. Sent inside
  the save, an email slower than the save's time limit could go out with
  a link the save, undone, never kept. One that can't be sent is taken
  back: the person isn't added, or their earlier link works again, and
  the audit log has no entry for it. Only what that save made is taken
  back.
- **2026-11-19:** Changed after Codex's second review of #325: a
  person's invitation is sent one at a time. It can be sent again only 2
  minutes after the link before it was made, and the two routes that
  send it stop within a minute. Two sent at once that both failed could
  otherwise put back a link neither sent.
- **2026-11-19:** Step 6c split in two: 6c-1, People who can sign in on
  a client's page with Add person, Resend invitation, Remove and the
  privacy policy's line; 6c-2, Delete permanently saying how many of a
  client's people go with it.
- **2026-11-19:** 6c-1 built (#326). The section shows for whoever has
  Manage who signs in for a client where the package has the client
  portal, the Super Admin included. My choices, each easy to change:
  what the server refuses is said in the page's language, as its own
  words are English; an invitation that can't be sent says no one was
  added, and a Resend that can't be sent says the link sent before still
  works; a person sent 5 invitations in the hour is told how long until
  the next can go; after any refusal the list is read again, as what
  refused it may be what changed. The privacy policy, with its new line,
  is dated 19 November 2026.
- **2026-11-19:** Decided: an invitation that couldn't be sent keeps
  the audit log entry its save made, and a second entry goes after it,
  saying it couldn't be sent and what that left (§5.2; #328). Until now
  the take-back deleted the entry, where the privacy policy says the
  audit log is only ever added to. The person still isn't added, or their
  earlier link still works, as before.
- **2026-11-19:** Decided: a client with people who can sign in, and no
  tax position, tasks or records, is archived on Delete, as one with a
  tax position is (§3.6; #329). Until now Delete took it and their
  accounts in one step. Delete permanently, from the archive, says its
  people go with it, with how many for whoever may manage who signs in
  for a client. My choices, each easy to change: the count is given as
  the claims' count is, in brackets, "(people: 3)", so it needs no
  plural forms; whoever may manage clients but not who signs in for one
  is told that its people go, without how many.
- **2026-11-19:** 6d (#330): the companies already there get Manage who
  signs in for a client (§9). A migration gives every company's built-in
  Admin role the permission, company-wide, as a new company's has had
  since #322, and its holders reload their grants once. An Admin role
  holding it already, a new company's, is left as it is. It opens
  nothing by itself: People who can sign in shows where the company's
  package has the client portal, and adding or removing one of a
  client's people still asks for the step-up confirmation. No screen
  changes.
- **2026-11-19:** Step 7 split in four (§5.3, §12), the guard first, so
  no one can sign in as a client account before the company's app
  refuses one: 7a, kept out of the company's app (#331); 7b, signing in
  finds a client account; 7c, Forgot password; 7d, the area's top bar
  and account menu. My choice, easy to change: the client's area is at
  `/portal`, and its routes under `/api/portal`.
- **2026-11-19:** 7b (#332): signing in finds a client account, by its
  email, with the same lock after wrong passwords, and lands in the
  client's area, on a page saying the tax position will be shown there
  soon, with Sign out (§5.3). Someone invited who hasn't set a password
  is refused as a wrong password is. Once the password is right, signing
  in is refused where the office's portal isn't open, with its words, and
  an open session ends within a minute the same way, or once the account
  is removed, as the invitation's page holds a barred company's portal
  closed (#324). My choice, easy to change: each sign-in and wrong
  password is in the audit log under the client, for the Super Admin.
- **2026-11-19:** 7c (#333): Forgot password works for one of a client's
  people, by their email, as for a person: the same code, the new password
  ending their open sessions and lifting a sign-in lock, and the same
  answer whoever the email is. My choices, each easy to change: someone
  invited who hasn't set a password gets no code, as the invitation's link
  is how theirs is set; whether the portal is open isn't asked, as signing
  in asks it; the code's email is in English, as a person's is for now.
- **2026-11-19:** 7d split in two (§12): 7d-1, the area's top bar (#334),
  then 7d-2, Change password, which needs a page and a route of its own.
  7d-1 (#334): the company's mark and name, the language switch and the
  account menu, with Sign out, in the company's brand colour (§5.3). A
  language picked there is kept as the account's, as §5.2 has it. My
  choices, easy to change: no theme switch, as `DESIGN.md` has none there;
  Sign out moves from the page into the menu.
- **2026-11-19:** 7d-2 (#335): Change password in the account menu, on a
  page of the area's own, as for the company's people (§5.3): the current
  password, checked by the server with the same limit on wrong tries; the
  new one twice, 12 to 72 characters; their other sessions end within a
  minute, and the one it's changed from stays; the audit log has it under
  the client, for the Super Admin. My choices, easy to change: the current
  password is a field on the page rather than a window after Save; too
  many wrong tries says to wait 15 minutes, as no one at the office can
  lift that for a client's person.
- **2026-11-19:** 7d-2 merged (#335). Step 8 split in four (§12): 8a, what
  the area reads of the tax position; 8b, its building blocks; 8c, the
  page's top; 8d, the claims by item. Decided: how late starts with what's
  not due yet, before under 6 months (§6; `DESIGN.md` §5.5).
- **2026-11-19:** 8a (#336): what the client's area reads of the tax
  position: the session's client's claims alone, late in the company's
  days, what's owed in all, by item and by how late, and the oldest delay
  (§6). No screen yet; 8b and 8c draw it.
- **2026-11-19:** 8a (#336), from Codex's review: by item, an item's
  spellings are one item, shown by a usual item's correct spelling or
  else the one written most often, each claim keeping its own (§3.3,
  §6).
- **2026-11-19:** 8a merged (#336). 8b (#337): the tax position page's
  building blocks, bars by part, the share bar and the large figure in
  `--text-hero`, on the building blocks page (§6). An item's Arabic name
  too long for its row keeps its first words on the English page.
- **2026-11-19:** 8b (#337), from Codex's review: bars by part's rows
  take the list's columns, so every bar is drawn against the same width
  and the bars are on one scale, whatever each row's amount and note
  (§6).
- **2026-11-19:** 8b merged (#337). 8c (#338): the tax position page's
  top, where the line saying it comes soon was: the header with the day
  the figures are from, what's owed, the two cards of bars and the note,
  and the page before the first upload and with nothing open (§6). My
  choices, easy to change: one late claim of one says "1 claim late", and
  "All open claims are late" is for more than one; the share paid is
  rounded down, so it never says 100% while something is left; the
  oldest delay is None where nothing is late; the currency is said once,
  after the large figure.
- **2026-11-20:** 8c (#338), redrawn as the owner's mockup draws it (the
  Client tax position canvas): what's owed is a panel headed by What the
  company owes, with the share paid twice the figure's width beside it
  and the facts under a line; each card's title has a line under it; the
  bars and the share bar are in the mockup's sizes, and on phones the
  share paid's amounts go under its bar. The share paid is now to the
  nearest whole percent, 99% at most while something is left, as the
  mockup's 16% is (it was rounded down). The two usual items with long
  names go by short ones in the bars, their full names when pointed at
  and for screen readers (§6).
- **2026-11-20:** 8c (#338), from Codex's review: the share paid never
  says 100% while something is left (99,999.99 of 100,000 is 99%), and
  it's worked out on whole piasters, so a share just under a half, such
  as 14.49996%, isn't rounded up (§6).
- **2026-11-20:** 8c merged (#338). 8d (#339): the claims by item, a
  table on computers and cards on phones, each item opening to its
  claims, with a total row (§6). My choices, easy to change: the largest
  item is open at first and an item's claims go the latest last day to
  pay first, as the mockup draws them; a claim's period is said as "Year
  2025" or "November 2025" where it's a whole year or month. Partly paid
  now comes before Late where a claim has both, here and in the section
  for the company's people, as the mockup draws them.
- **2026-11-20:** 8d merged (#339). Step 9 split in four (§12): the
  WhatsApp number on people's profiles (9a, #340), the responsible
  accountant (9b), Contact the accountant (9c) and Ask about this claim
  (9d). The messages are Nizmo's own until the templates (step 10).
- **2026-11-20:** 9a as built (#340, §7): the WhatsApp number is kept on
  the person, saved with their profile, and read the same way on the
  profile and on the server. Which clients write to it comes with 9b.
- **2026-11-20 (decided by the owner):** A password is 8 to 72 characters
  in the client's area too, as everywhere in Nizmo (it was 12): setting
  one from the invitation and changing it (#341).
- **2026-11-20 (decided by the owner):** The client's area's top bar is
  on computers as on phones, as the company's is (`UI_PLAN.md`, the app's
  frame and cards as this plan's mockup draws them): the account button
  the person's initials alone, and the language switch EN and ع. Page
  titles, card titles and the room between cards follow the mockup too.
- **2026-11-20:** 9b as built (#343, §7): the responsible accountant is
  kept on the client and picked at the foot of its Tax position section,
  as the owner's mockup draws it, saved as it's picked. Beside it, the
  accountant's WhatsApp number, or why the client's people can't write
  to anyone: no one picked, no number on their profile, or their
  contract has ended, with the way to fix each. A person's Contacting
  clients card names the clients they answer for.
- **2026-11-20:** 9c as built (#344, §7): the client's page names the
  responsible accountant in its subtitle and has Contact the accountant
  where they have a WhatsApp number, opening the dialog as the owner's
  mockup draws it, with Nizmo's own message, ready to change. Open
  WhatsApp opens the conversation in a new tab; nothing passes through
  Nizmo. Without anyone to write to, the note says to contact the
  office, as before.
- **2026-11-20:** 9d as built (#345, §7): each claim has Ask about this
  claim, as the owner's mockup draws it, opening the dialog titled "Ask
  about a claim" with the claim's own message, ready to change. The note
  under the claims points to the button in the claim's row, or its card
  on phones.
