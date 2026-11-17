# Client portal: plan

This file holds the plan for the client portal: a package add-on that
lets each of a company's clients sign in and see what the company keeps
for them, starting with their tax position. It is updated with every
decision and enhancement; the change log at the end records each update.

Each part is marked:

- **Decided**: the product owner agreed to it.
- **Proposed**: suggested, waiting for the product owner's answer.
- **Open**: a question that needs answering before that part is built.

Status: **not built.** The plan and its `DESIGN.md` blocks are #309. It's
built in the small PRs of §12, each its own PR.

---

## 1. What it is (Decided)

A company that does tax work for its clients, such as an accounting
office, keeps each client's open claims from the Tax Authority's portal
(بوابة الممول) in Nizmo. The client's own people sign in and see them as
their **tax position** (الموقف الضريبي): what they owe, by item, how
late it is, and each claim.

- The company's people keep it up to date, by uploading the Excel file
  their export button makes from the portal (§4.1), or by hand (§4.2).
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

---

## 3. The claims

### 3.1 What's kept (Proposed)

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

And for each client: the day its claims are from, who last changed them,
and whether by an upload or by hand. Row-level security on the new
tables, as on every table.

### 3.2 Only open claims (Decided, 2026-11-17)

The tax position is what's still owed: claims waiting to be paid (في
انتظار السداد) and partly paid (مسدد جزئيًا). A claim with nothing left to
pay isn't kept. Read from a file, it's left out, and the check screen
counts it (§4.1).

### 3.3 The items' names (Proposed)

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

---

## 4. Keeping it up to date

### 4.1 Uploading the portal's file (Decided)

The owner's export button reads the claims table on the portal's
Payments page and makes an Excel file. Nizmo reads that file as it is,
with no change to the button, one company's file at a time.

- **Who:** whoever has `tax.manage` (§9).
- **Where:** only on a client's page, in its Tax position: Upload from
  the tax portal. The file is that client's (Decided, 2026-11-17), so
  nothing in it is matched to clients.
- **Reading it:**
  - Its first sheet. The columns are found by their headings, not where
    they are, as the button writes the headings the portal's table has.
  - Needed: الشركة, رقم المطالبة, and the amounts. Where any claim in the
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

### 4.2 By hand (Decided)

The owner asked for a form as well as the upload.

- On a client's Tax position: Add claim, and Edit and Delete in each
  claim's row menu, with `tax.manage`.
- The fields are §3.1's. Remaining is worked out from the original and
  paid. The status is worked out from them too, as a typed status could
  say something else.
- A claim changed by hand stays as it is until the next upload replaces
  the client's claims. The section says so under its title, and the check
  screen counts those claims among what changes or goes.
- Each add, edit and delete is in the audit log.

---

## 5. Client accounts

### 5.1 Separate from the company's people (Proposed)

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

### 5.2 Adding and removing people (Proposed)

- On a client's page, **People who can sign in**, with
  `client_accounts.manage` (§9): each person's name, email, and when they
  last signed in, or that they're invited.
- Add person: a name and an email. Nizmo emails an invitation, from the
  address it sends sign-in codes from, with a link to set a password. The
  link works once, for 72 hours; Resend invitation sends a new one.
- Remove: their account goes, and so do their open sessions, at once.
- Each add, resend and remove is in the audit log.

### 5.3 Signing in (Proposed)

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

### 5.4 What a client account never sees (Decided)

Anything else of the company's: its people, other than their
accountant's name; its tasks, costs, charges and records; and its other
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
- The number is the company's WhatsApp number for clients, in Company
  settings (Proposed), so no one's own number is shown.
- Contact the accountant opens a dialog (`DESIGN.md` §5.5, Contact on
  WhatsApp): the accountant, and a message ready to send, naming the
  client and the day the figures are from, which can be changed. Open
  WhatsApp opens `https://wa.me/<number>?text=<message>` in a new tab:
  the app on a phone, WhatsApp Web on a computer.
- Nothing passes through Nizmo, and nothing of the conversation is kept.
- Without a number set, the button isn't there.
- Turned down for now: an email form (§14).

---

## 8. Download the statement (Proposed)

A document to print or save as a PDF, as the client statement is
(`DESIGN.md` §5.5, Document): the client's open claims as of the day
they're from, by item, with each item's total and the total in all. The
same document opens from the client's Tax position for the company's
people.

---

## 9. Permissions (Proposed)

| Permission | What it allows | Scope |
|---|---|---|
| `tax.view` | Seeing a client's tax position on its page | Company |
| `tax.manage` | Uploading the portal's file, and adding, editing and deleting claims; implies `tax.view` | Company |
| `client_accounts.manage` | Adding and removing a client's people, and resending invitations; implies `clients.view` | Company |

- All three are in the `TAX_POSITION` module (§2).
- `client_accounts.manage` is high-risk, as it lets people from outside
  the company in: it asks for the step-up confirmation
  (`ROLES_PLAN.md` §6.15).
- The built-in Admin holds all three. Other roles get them as the Admin
  sets them.
- They go into `ROLES_PLAN.md`'s tables with the PR that adds them to the
  catalogue, as `lib/plan-docs.test.ts` holds those tables to it.

---

## 10. The export button (the owner's, outside Nizmo)

- Changed on 2026-11-17 at the owner's ask, to fit the upload on a
  client's page (§4.1), and tried on a page laid out like the portal's:
  - it holds one company at a time. Opening another company starts it
    again by itself, with no Clear (مسح) to press, so each file is one
    company's;
  - its file's name has Cairo's date, not UTC's, which was the day before
    between midnight and 2 or 3 in the morning. Nizmo takes the day the
    figures are from from it.
- The rows it gathers stay in the browser until another company is opened
  or Clear is pressed, so on a shared computer the next person can see the
  last client's claims.
- Its staff install it by dragging it to the bookmarks bar from its page;
  no store or paid account is needed. A bookmark keeps the copy it was
  made with, so after a change each of them drags the new one once.

---

## 11. What it costs to run (Decided)

Little, on Vercel Hobby and Supabase Free alike: a client opening the
page is one or two function calls, an upload is one, and a client has a
few dozen claims. Each invitation is one email, from the account that
sends sign-in codes.

---

## 12. Build order (Proposed)

Each a small PR, tests first, the flows in both languages and at phone
width:

1. **The plan and its `DESIGN.md` blocks.** #309.
2. **The add-on and the claims, by hand:** the package switch, the bundle
   and module, `tax.view` and `tax.manage`, the claims' tables, and the
   Tax position section on a client's page with Add, Edit and Delete.
3. **Uploading the portal's file** on a client's page: reading it,
   checking it's that client's, the check screen, replacing, and the
   audit log.
4. **Client accounts:** their table, People who can sign in,
   `client_accounts.manage`, the invitation and setting a password.
5. **Signing in as a client account, and the client's area:** sign-in
   finding them, their session, the proxy keeping them in the area, and
   its top bar and account menu.
6. **The tax position page.**
7. **Contact the accountant on WhatsApp:** the responsible accountant,
   the company's number and the dialog.
8. **Download the statement.**

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
