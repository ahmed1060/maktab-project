# Later changes: plan

This file holds the second of two plans made from the product owner's list
of 21 November 2026: four changes to discuss once the first plan,
`FIRST_CHANGES_PLAN.md`, is done. It is updated with every decision and
enhancement; the change log at the end records each update.

Each part is marked:

- **Done**: built and merged.
- **Decided**: the product owner agreed to it.
- **Proposed**: suggested, waiting for the product owner's answer.
- **Open**: a question that needs answering before that part is built.
- **Moved**: carried to another plan.

Status: **the names (§3) next.** Done: the development database (§4),
each "manage" permission split (§2), the rules between permissions with
their screen test (§5, #369 to #395), and status counts on All users (§6,
#384). The names are decided, their design approved and their limit set
(#397, lowered to 30 characters in #402). Of their steps (§3.1), both
languages are kept (#398), Nizmo's list of names and the rules are done
(#399), and so are the company's spellings, learned (#400), and read for
a name's suggestion (#401), and employees' names on Add employee (#402),
on an employee's page and on one's own profile (#403), in a request to
change one's own name (#404), and on the Employees page (#405), and
clients' names in their form (#406) and on the Clients page (#407), and
the company's name in two languages (#408) and shown in the page's
language to its people and clients (#409), and to the Super Admin on its
own screens for companies (#410) and in the company columns and selects
of the other screens (#411). The other screens' names (step 8) started
with the pickers and filters they share (#412) and the tasks screens
(#413) and the bulk upload's template and file (#414); obligations are
next.

The first plan is done (#358 to #362). The owner answered on 2026-11-22:
- the development database (§4) is decided, and comes first;
- the company's name and icon (§1) moved to `THIRD_CHANGES_PLAN.md`;
- the names (§3) are for all three, by a free way;
- §2's split and §3's way, as recommended, approved the same day;
- rules between permissions (§5), as recommended, the same day.

On 2026-11-23 the owner asked for status counts on All users (§6), and
approved them with their canvas the same day. They're built before the
grant for companies already there.

## 1. The company's name and icon (Moved)

Moved to `THIRD_CHANGES_PLAN.md` on 2026-11-22, as the owner asked, with
its open questions.

## 2. Each "manage" permission split (Done)

The owner asked to break up every "manage" permission in the roles system.

- **Today there are 11:**
  - `clients.manage`, `client_accounts.manage`, `client_messages.manage`;
  - `charges.manage`, `lists.manage`, `locations.manage`;
  - `obligations.manage`, `salary_adjustments.manage`;
  - `settlements.manage`, `tax.manage`, `attendance.manage_terminals`.
- **Proposed:**
  - each becomes create, edit and delete, and approve where there's
    something to approve;
  - a table of each split comes to the owner first;
  - built two or three permissions to a PR, with each route, its screen
    and `ROLES_PLAN.md`'s tables.
- **Nobody loses access:** a role that had a "manage" permission is given
  every permission it splits into, in a PR of its own, as grants for
  companies already there always are.
- **Open:**
  - how fine: create, edit and delete for all, or by what each one does;
  - which to split first.
- **Decided (approved by the owner on 2026-11-22):** split each by what it
  does, not create, edit and delete for every one. Some have nothing to
  delete, some have something to approve, and three are one job each:

  | Today | Split into |
  |---|---|
  | `clients.manage` | `clients.create`, `clients.edit` (the responsible accountant too), `clients.delete` |
  | `obligations.manage` | `obligations.create`, `obligations.edit`, `obligations.delete`, `obligations.approve` |
  | `locations.manage` | `locations.create`, `locations.edit`, `locations.archive` |
  | `lists.manage` | `lists.rename`, `lists.merge`, `lists.archive` (restore too); adding stays `lists.add` |
  | `charges.manage` | `charges.set` (the fee, or not charged), `charges.collect` (collected, or not) |
  | `client_accounts.manage` | `client_accounts.view`, `client_accounts.invite` (sending again too), `client_accounts.remove` |
  | `salary_adjustments.manage` | `salary_adjustments.add` (a bonus or a deduction), `salary_adjustments.reverse` |
  | `settlements.manage` | `settlements.view`, `settlements.resend` |
  | `client_messages.manage` | stays one: changing the company's messages and the update email |
  | `tax.manage` | stays one: uploading the tax portal's file |
  | `attendance.manage_terminals` | stays one: setting the terminals up, behind the Super Admin's switch |

  - The ones that move money or let outsiders in stay high-risk, each
    part: `salary_adjustments.*`, `client_accounts.invite`.
  - **The order:** after the development database (§4), two or three to a
    PR: clients and obligations first, as the ones used every day; then
    locations, lists and charges; then client accounts, salary
    adjustments and settlements. Then the grant for companies already
    there, in a PR of its own. Since 2026-11-22, the rules between
    permissions (§5) come before locations, lists and charges.
- **How it's built (2026-11-22):**
  - **One PR for each "manage" permission:** clients first (#365), with
    what every split shares, then obligations (#367), then the rest in
    the order above. Each brings its routes, its screens and
    `ROLES_PLAN.md`'s rows.
  - **Nobody loses access in between.** The old permission stays in the
    catalogue, marked as split into its parts:
    - a role still holding it is read as holding each part, at its
      scope: when a session's grants are loaded, and wherever a role's
      grants are shown or compared;
    - it isn't offered in the role editor any more, and saving a role,
      or a template, writes the parts in its place;
    - the catalogue's version goes up, so every session reloads its
      grants once.
  - **Then the grant for companies already there** rewrites each role's
    rows from the old permission to its parts, and after it the old
    permission is removed and its code retired.
  - **Clients (#365):**
    - `clients.create`: adding a client;
    - `clients.edit`: changing its details, and picking its
      responsible accountant;
    - `clients.delete`: deleting or archiving one, deleting an archived
      one for good, and restoring one from the archive.
    - None is high-risk, as `clients.manage` isn't.
    - **Two names used before:** until 4 November 2026, `clients.edit`
      and `clients.delete` meant editing and deleting records. The
      migrations renamed every role's and template's grants to
      `records.edit` and `records.delete`, and the triggers that kept
      renaming them are gone (`lib/records.db.test.ts`), so no role
      gains anything. Checked read-only on the live database on 22
      November: no role, template, access review or audit-log line names
      either.
  - **Obligations (#367):** an obligation has no details to change once
    it's made, so the parts follow what can be done to one:
    - `obligations.create`: adding one, with its people;
    - `obligations.edit`: handing it to other people, moving it along as
      a manager (back to Pending, archived, or completed for someone
      deleted), and removing other people's attachments;
    - `obligations.approve`: approving or rejecting one handed in, and
      changing one already approved, which takes back its points;
    - `obligations.delete`: deleting one.
    - Each is for the whole company or a team, as `obligations.manage`
      was, and keeps its rules: held for a team, it reaches the team's
      obligations only; held for the company, never one's own to approve
      or delete. The built-in Admin holds all four for the company, the
      Team Leader for their team. None is high-risk.
  - **Locations (#377):** adding one has had a permission of its own since
    the Locations page, `locations.add` (`CLIENTS_PLAN.md` §2.9), so it
    stays, as `lists.add` does: the table's `locations.create` would be
    the same thing twice. `locations.manage` splits into two:
    - `locations.edit`: changing one's name, pin and radius, making one
      its client's HQ, and changing a client's HQ in the client form;
    - `locations.archive`: archiving one, and restoring it.
    - Each is for the company, as `locations.manage` was. The built-in
      Admin holds both, and the Team Leader neither, as before. Neither is
      high-risk.
  - **`locations.add` renamed `locations.create` (#378),** as the owner
    asked on 2026-11-23, to match the table and the other areas' adding.
    It's done as a split into one, with the same machinery, so nobody
    loses access and no migration is needed now:
    - `locations.create` has a code of its own, and does all that
      `locations.add` did: adding a location on the Locations page, a
      client's page or the task form. Its name stays "Add locations".
    - `locations.add` stays in the catalogue, split into
      `locations.create`: a role still holding it, which is every
      company's built-in Admin and Team Leader today, is read as holding
      `locations.create`, and saving it writes the new name.
    - The catalogue's version goes up, so every session reloads once.
    - Its rows are rewritten with the grant for companies already there,
      and its code retired with the others.
  - **Saved lists (#379):** adding a name stays `lists.add`, as the table
    says. `lists.manage` splits into three:
    - `lists.rename`: renaming a name;
    - `lists.merge`: merging a name into another of its list;
    - `lists.archive`: archiving a name, and restoring it.
    - Each is for the company, as `lists.manage` was, and none is
      high-risk. The Saved lists page opens for whoever holds any of the
      three, and its menu offers each name only what's held.
    - **None includes adding.** `lists.manage` did: adding a name isn't
      needed to rename, merge or archive one, so a role given one part
      isn't given adding with it. Nobody loses adding: every role saved
      with `lists.manage` was saved with `lists.add` too, and the page
      offers Add name to whoever holds it. Checked read-only on the live
      database on 23 November: of its 3 roles, the one holding
      `lists.manage` holds `lists.add`, and there are no templates.
      Saving a role or template that still names `lists.manage` keeps
      `lists.add` with its parts, as a split one's `implies` now come with
      its parts.
    - The built-in Admin holds all three; the Team Leader and Employee
      add names, as before.
  - **Charges (#380):** marking charges collected, or not, has had a
    permission of its own since the Charged to clients tab,
    `charges.collect` (`CLIENTS_PLAN.md` §6.6), high-risk as it moves
    money, so it stays. What `charges.manage` did is the table's other
    part, so it's named `charges.set`, as a split into one, as #378 did
    for `locations.add`:
    - `charges.set`: setting a charge's service fee, typed as the fee or
      as the total, and leaving a cost off its client's bill, or charging
      it again;
    - for the company, as `charges.manage` was, and not high-risk. The
      built-in Admin holds it; a role still holding `charges.manage` is
      read as holding `charges.set`, until the grant for companies
      already there.
  - **Client accounts (#381):** `client_accounts.manage` splits into three:
    - `client_accounts.view`: seeing a client's people who sign in to the
      client portal, on its page, and how many go with it where Delete
      permanently names them;
    - `client_accounts.invite`: adding one, as invited, and sending their
      invitation again. It lets someone from outside the company in, so
      it stays high-risk and asks for the step-up code, as the table says;
    - `client_accounts.remove`: removing one, which takes their sign-in
      away. Not high-risk, as the table keeps only inviting so, so it no
      longer asks for the code.
    - Each is for the company, in a package with the client portal, as
      `client_accounts.manage` was. Seeing includes seeing clients;
      inviting and removing include seeing the people. The built-in Admin
      holds all three. Checked read-only on the live database on 23
      November: only the built-in Admin role holds `client_accounts.manage`,
      there are no templates, and no client has people who sign in yet.
  - **Salary adjustments (#382):** `salary_adjustments.manage` splits into
    two, by what each does to someone's pay:
    - `salary_adjustments.add`: adding a bonus or a deduction to someone's
      month;
    - `salary_adjustments.reverse`: undoing one, both ways there are to:
      rolling back one made by mistake, and reversing one that was right
      when it was made. Each stays its own route and its own line in the
      audit log; both take the days off the month the adjustment landed
      on, and neither works once that month is approved.
    - Each moves money, so each stays high-risk and asks for the step-up
      code, as the table says. Each keeps what `salary_adjustments.manage`
      had: for the company, never on one's own pay, including See
      salaries, and needing See employees to reach anyone. Neither
      includes the other: undoing doesn't need adding.
    - The employee list's menu offers Add bonus and Add deduction to
      whoever holds adding; someone's history offers each adjustment's
      Reverse and Roll back to whoever holds reversing.
    - The built-in Admin holds both. Checked read-only on the live
      database on 23 November: only the built-in Admin role holds
      `salary_adjustments.manage`, there are no templates, and no
      adjustment has been made yet.
  - **Settlements (#383):** `settlements.manage` splits into two:
    - `settlements.view`: seeing someone's final settlements in their
      history, and opening the statement;
    - `settlements.resend`: sending the statement by email, or sending it
      again, from the statement's page.
    - Each is for the company, as `settlements.manage` was, and needs See
      employees, as the person is reached from their history. Seeing
      includes See salaries, as `settlements.manage` did; sending includes
      seeing, as it's sent from the statement. Neither is high-risk, as
      `settlements.manage` isn't: a statement moves no money.
    - The statement's page offers Send by email, or Send again, to whoever
      holds sending; whoever holds seeing alone can open it and print it.
    - The built-in Admin holds both. Checked read-only on the live
      database on 23 November: only the built-in Admin role holds
      `settlements.manage`, there are no templates, and no settlement has
      been made yet.
  - **The grant for companies already there (#385):** one migration, for
    every company's roles and for the role templates. It writes down what
    the app has read since each split, so nobody gains or loses anything:
    - each row of a split permission becomes a row for each of its parts,
      at the same scope. A part the role holds already keeps the wider of
      the two scopes;
    - the old rows are deleted, and each role changed goes up a version, so
      its holders reload their grants once;
    - each template naming a split permission names its parts instead, the
      same way;
    - a test checks the parts bring nothing the old permission didn't: what
      each part brings with it or needs first is another part, or something
      the old permission brought or needed too;
    - run again, it finds nothing, and nobody reloads.
    - Access reviews keep the names they were opened with, as they record
      what was held then.
    - The old permissions stay in the catalogue, read as their parts, until
      their codes are retired in a PR of their own (#386).
    - Checked read-only on the live database on 23 November: 13 rows on its
      three built-in roles. The Admin's 9; the Team Leader's `locations.add`
      and `obligations.manage`, for its team; and the Employee's
      `locations.add` and `clients.manage`. No templates. They become 30
      rows of parts, none held already, and the three roles reload once.
    - Reading a role that holds both a split permission and one of its
      parts keeps the wider scope too, as the migration does. Before, the
      app read the part at the split permission's scope, which could be
      narrower. No role on the live database holds both.
    - **It changes the live database** when it's merged, as every
      migration runs as the site is built. Opening it changes only the
      development database, through the preview.
  - **The old permissions retired (#386):** the nine split permissions
    are removed from the catalogue, now that no role or template names
    them. Checked read-only on the live database after #385: none left.
    - Their codes are retired, never handed out again.
    - Reading and writing a split permission as its parts goes too, as
      nothing is split any more. A role or template saved naming one is
      refused, as any name the catalogue doesn't know is.
    - Asking who holds a part asks for the part alone.
    - Their names stay, in both languages, as retired names with their
      codes, so what recorded them still reads in words: two entries of
      the live audit log name one, and an access review opened before
      #385 could too.
    - The catalogue's version isn't raised: every session since each
      split's own raise holds the parts, never the old ones.
    - Nothing changes on the live database. Another database, such as a
      local one, needs #385's migration first, or its roles lose what
      they hold under the old names.

## 3. English and Arabic names (Decided)

The owner asked for names in English and in Arabic, both required, with the
other filled in when one is typed, if that's possible.

- **Today:** a name is kept once, as it was typed: an employee's first and
  last names, a client's name and its owner's, and the company's name.
- **Which names (Decided, 2026-11-22):** all three: employees, clients,
  and the company.
- **Proposed:**
  - each name kept in both languages, and shown in the page's language;
  - required for anything new;
  - one already there is asked for its other language the next time it's
    edited, with a list of the names still missing one.
- **Filling in the other language:** always a suggestion in the field, to
  check before saving, never saved on its own, as one Arabic name has
  several English spellings (Mohamed, Mohammed, Muhammad). Three ways:
  - **rules in the app:** free and needs nothing outside, but weak: Arabic
    is usually written without its short vowels, so محمد comes out as
    "Mhmd";
  - **a list of common names, then the rules:** better for common names,
    and still weak for others;
  - **the Claude API (Anthropic):** the best of the three. It needs an API
    key kept in Vercel, and each name typed is sent to Anthropic, which is
    the owner's decision. It costs a fraction of a cent a name.
- **A free way (Decided, 2026-11-22):** the owner wants one that's free,
  with good results, so not the API, and no name leaves Nizmo.
- **Decided (approved by the owner on 2026-11-22): a list of names, what
  the company saves, then the rules.**
  - **A list written into Nizmo** of about 2,000 common Egyptian and
    Arabic given names, each with its usual Egyptian English spelling
    (محمد Mohamed, أحمد Ahmed, مصطفى Mostafa), and the other way round.
    Written for Nizmo, so there's no outside list or licence to depend on.
  - **Word by word:** an Egyptian full name is a row of given names, its
    father's and grandfather's, so محمد أحمد محمود is Mohamed Ahmed
    Mahmoud. Looking up each word covers most people's full names.
  - **What the company saves teaches it:** each name saved in both
    languages is remembered for that company, word by word, and comes
    first next time. If an office writes Mohammed, it's suggested as
    Mohammed from then on.
  - **Words for businesses,** for clients and the company: شركة Company,
    وشركاه & Partners, للمحاسبة Accounting, للتجارة Trading, مكتب Office,
    and the like.
  - **The rules last,** for a word in neither list, shown as a guess to
    check.
  - **Why:** it's free and instant, works offline, and names stay in
    Nizmo. Most names are common ones, and a rare one corrected once is
    learned.
  - **Weak spots:** rare names and brand names come from the rules and
    need correcting once.
- **A name's length (Decided, 2026-11-23; lowered 2026-11-24):** an
  employee's first and last names take up to 30 characters. They took 15,
  then 40 from #397, which the owner found more than a name needs: a
  first or last name is mostly one word, and at worst a compound of two,
  which fits even spaced (Abd El Moneim Abd El Ghaffar is 28). A name is
  usually longer in English than in Arabic, as its vowels are written
  out: محمد عبد الرحمن is 15 characters, and Mohamed Abdelrahman is 19.
  Lowered in #402, where production's longest was 11.
- **A client's names' length (Decided, 2026-11-24):** a client's name
  takes up to 100 characters, as before, as a business's name can be
  long; its owner's name takes up to 60, lowered from 100, as it's a
  person's whole name, a first and a last name of 30 each. Production's
  one client's are 21 and 15.
- **The design (approved by the owner on 2026-11-23):** the name fields
  drawn on the English and Arabic names canvas, written into `DESIGN.md`
  §5.3: a name in English and in Arabic, and the names still missing a
  language.
- **How a name is kept:**
  - an Arabic column beside each name: an employee's first and last
    names, a client's name and its owner's, and the company's name. The
    column there today keeps the English;
  - a name written in Arabic before today stays where it is, and is
    copied into its Arabic column, so nothing anyone sees changes. Its
    Arabic letters say it has no English yet, so nothing is guessed or
    moved;
  - a client's Arabic name is unique in its company, and a company's
    across Nizmo, as their English names are;
  - a message already sent keeps the name it was written with.

### 3.1 The steps

1. **Both languages kept (Done, #398):**
   - the Arabic columns, and the names written in Arabic copied into
     them;
   - `lib/names.ts`: a name in the page's language (the other one while
     it has only one), and the language a name is missing;
   - the server takes the Arabic names where it takes the English ones,
     not yet asked for. No screen changes.
2. **Nizmo's list of names, and the rules (Done, #399),** in
   `lib/names/` alone:
   - 698 common Egyptian and Arabic given names to start, where about
     2,000 were planned, each with its usual Egyptian English spelling
     first and the others people write (Mohamed, Mohammed, Muhammad),
     read both ways. More can be added at any time, and what the company
     saves fills in the rest (step 3);
   - read as people type a name: without its marks, its hamza or its
     dots, and a name of two words, such as عبد الرحمن, with its space or
     without;
   - the article joined for a person (Elsayed) and spaced for a business
     (El Nour), and El or Al read either way into Arabic, before a name
     of the list or one guessed;
   - business words, each in its place in either language: before the
     name in Arabic and after it in English (شركة Company), after it in
     both (للتجارة Trading), or last in both (وشركاه & Partners);
   - the rules for a word in neither, marked as a guess, a number kept in
     the digits of the language it's written into (النور ٢, El Nour 2);
   - a full name looked up word by word, and nothing suggested for a name
     with any letter of the language asked for already.
3. **What the company saves teaches it,** in two parts:
   - **3a, its spellings learned (Done, #400):**
     - a table of the company's spellings, behind row-level security:
       each word of a name in Arabic beside its English, where it was
       saved (employees' names, clients' names, their owners' names, or
       the company's), and how many names use it;
     - a name is learned once it's saved in both languages, word by
       word: each side split into the words of Nizmo's list, a
       business's words for what it is and does left out, and the two
       paired in order where they have as many. A name of up to three
       words that doesn't pair word by word is learned whole;
     - worked out again from the names themselves whenever one is
       added, changed or deleted, so how many use each is always what's
       saved, and a save that couldn't be learned is caught up by the
       next. Learning never stops a name from being saved;
     - a deleted employee's name isn't counted, and deleting someone
       takes their names in Arabic with them, as it does their English
       ones. From #398 they stayed; production had no one deleted
       since, so there's nothing to clear.
   - **3b, read by the forms (Done, #401):**
     - a name's suggestion with the company's spellings first, the most
       used first, each with how many names use it, and under each word
       its other spellings: the company's, then the usual one;
     - a spelling the company learned whole, of several words, read as
       one, as a name of Nizmo's list is;
     - asked of the server (`GET /api/names/suggest`) by whoever may use
       a form that takes a name: employees' names and the company's by
       anyone in the company, as one's own profile takes a name;
       clients' names and their owners' by whoever may add or edit a
       client. The Super Admin's are the company in view's;
     - no screen asks for it until step 4's forms, and the screen test
       (`lib/screen-asks.test.ts`) lists the call with them.
4. **Employees' names,** in three parts:
   - **4a, the name in two languages on Add employee (Done, #402):**
     - the group of two fields, "In English" and "In Arabic", as a
       building block (`NameFields`, DESIGN.md §5.3): the page's
       language first, on the start side, and one under the other on a
       phone;
     - typed in one, the other offers its suggestion a moment after the
       last key, asked of the server (step 3b): a button to use it, with
       how many names here use it, or "The usual spelling", beside it,
       and a guessed word underlined with dots and said under it.
       Focused, the empty one opens its spellings, picked with the keys
       or a click. Nothing goes in a field until it's used, picked or
       typed;
     - on Add employee, both needed for anyone new, each in its own
       letters, checked by the page and by the server
       (`POST /api/users`). One left empty beside a typed name asks for
       it or the suggestion, and one longer than the limit, as a
       suggestion used may be, asks for it shorter. An edit takes the
       names as before, until step 4b;
     - the screen test follows a building block that asks the server
       itself, and lists the call on Add employee, open to anyone in
       the company;
   - **4b, an employee's page and one's own profile (Done, #403):**
     - the two fields wherever a name is saved straight away: on an
       employee's page, for whoever may edit it, and on one's own
       profile where the name isn't asked for (an Admin's);
     - a name missing a language, as those saved before #402 may be, is
       asked for on its next edit: the note at the top of the form says
       so, and the form isn't saved until it's added. A name written in
       Arabic in its English column shows in the Arabic field, with the
       English empty;
     - the server takes a name's English only in English letters and
       with its Arabic, sent with it or kept, and its Arabic alone may be
       added. An edit that sends no name, such as a status's, leaves them
       as they are. A name sent in Arabic as its English, as a form that
       asked for one name only once did (#398), is refused now that
       every form that saves a name sends both;
     - one's own name on an employee's or a team leader's footing stays
       a request until 4c, which brings the two fields to it;
   - **4c, a request to change one's own name (Done, #404):**
     - the two fields on one's own profile on an employee's or a team
       leader's footing too, where a change to the name is asked for:
       changed, both are needed, each in its own letters, and the
       request carries both;
     - the rest of their profile is saved as before while their name
       misses a language, with no note: it's asked for when they change
       their name, and whoever may edit their page may add it there
       (4b). The owner chose this on 2026-11-24: every employee and team
       leader in production had no Arabic yet, and each would otherwise
       have had to ask for it before saving anything else;
     - the request keeps each name in both languages, and the ones it's
       from: four columns added, empty for a request asked before;
     - the server takes a request only with both, each in its own
       letters, from one character to a person's name's limit, as every
       name field takes it (it asked for two at least before), and
       refuses one that changes neither;
     - approved, the name is saved in both languages, and the company
       learns it. A request asked before is approved as #398 did;
     - on the Requests page, a name change's details show the names
       it's from and for in both languages, and its search finds either.
5. **Employees' names in the page's language** on the Employees page (Done, #405),
   with the ones still missing a language, and its search finding
   either:
   - each name in the page's language, or the one it has, a team
     leader's too, and sorted so: on an Arabic page the names with Arabic
     first, then the rest in English;
   - for whoever may edit people, as they're the ones asked: the note
     above the filter bar saying how many names have only one language,
     over everyone the list is for, and the Names select listing them
     with a Missing column of neutral badges, as the names canvas draws
     them;
   - which names are missing a language is read by the database
     (`lib/names/missing.ts`), with the Arabic letters `lib/names.ts`
     reads, as a Prisma filter can't read letters;
   - the note is a building block (`ListNote`), for the Clients page in
     step 6.
6. **Clients' names (Done, #406, #407):**
   - **6a. In the client's form (Done, #406),** the dialog on the Clients page
     that adds a client or edits one:
     - its name and its owner's, each in English and in Arabic, with the
       suggestion: a business's for its own name, with its business
       words, and a person's for its owner's;
     - each up to its limit: 100 characters for its name, as before, and
       60 for its owner's;
     - both needed for a new client, and on an edit for a name saved
       before in one language, which the note at the top of the form
       names: the client's name, its owner's, or both;
     - the server takes a new client only with both, each in its own
       letters, and an edited name's English only in English letters with
       its Arabic sent or kept, as an employee's (#403). What it refuses
       is said under its field;
     - as built: the form's rules are in `lib/client-form.ts`, and its
       mistakes name which name they're of ("Enter the owner name in
       Arabic, or use the suggestion."). Create and Save are ready once
       each name has one language and the phone number is typed, as they
       were once each was typed; what's still missing is said under its
       field on saving, the first focused. The server asks each name as
       a name change's request does (`nameIn`, #404).
   - **6b. On the Clients page (Done, #407):** the names in the page's language, with
     the ones still missing a language (the note and the Names select, as
     the Employees page has them), and its search finding either:
     - each client's name and its owner's in the page's language, or the
       one it has, and who added it too; on an Arabic page, the clients
       with an Arabic name first, alphabetically in Arabic, then the rest
       as before;
     - for whoever may edit clients: the note counting the clients in use
       with a name in one language only, and the Names select listing
       them with a Missing column of neutral badges (a line of each card
       on a phone). An archived client can't be edited until it's
       restored, so it isn't counted;
     - read from the list the page already has, as its search is: no new
       query.
7. **The company's name:** Company settings and the Super Admin's
   company forms, the note above its fields, and the name in the page's
   language wherever it's shown. Only the Super Admin changes a company's
   name, as today: the owner chose on 2026-11-24 that an Admin's Company
   settings says when the company's name is in one language only, and
   that Nizmo's team adds the other.
   - **7a. Its name in two languages (Done, #408):**
     - the Super Admin's Add company and Edit company dialog: the name in
       English and in Arabic, a business's, with its business words, up
       to 50 characters; the username code still follows the English;
     - both needed for a new company, and on an edit for a name saved
       before in one language, with the note at the top of the dialog;
     - the server takes a new company only with both, each in its own
       letters, and an edited name's English only in English letters
       with its Arabic sent or kept, as a client's (#406). Each takes 2
       characters at least, as the name has until now, which its username
       code is suggested from;
     - an Admin's Company settings: a note above its tabs while the
       company's name is in one language only.
   - **7b. Shown in the page's language, to its people and its clients
     (Done, #409):** the company's name in the page's language, or in the one
     it has while it has only one, wherever its own people and its
     clients see it:
     - the side bar, the phone's top bar and the account menu ("Admin at
       …"), for its people and for the Super Admin previewing one of its
       roles;
     - the side bar's look on its Company settings (its logo card);
     - the client's area's top bar;
     - the documents it issues: a payslip, a settlement, a client's
       statement and a tax position statement, read and printed;
     - the session keeps the name in both languages, and catches it up
       on its minute's check as it does the company's logo, so a name
       Nizmo's team completes or changes shows without signing in again.
       Until now it was read only at sign-in. The side bar and the account
       menu read it from the live session, which the browser reads again
       every 5 minutes, so it shows as the app moves between pages too
       (from #409's Codex review).
     The person's own name beside it in the account menu, and a client's,
     come with the other screens (step 8).
   - **7c. Shown in the page's language, to the Super Admin,** in two
     parts:
     - **7c-1. Its own screens for companies (Done, #410):**
       - the company switcher: each company in the page's language, its
         tile's initials too, found by either language, and on an Arabic
         page the ones with an Arabic name first, in Arabic order, as the
         Clients page lists clients (#407);
       - the side bar's name and mark while looking at one company, from
         the company the page is drawn for, as its logo is, and not from
         the address, which names it in English;
       - the Companies page: each company's name in its table and cards,
         its menu, what's said once it's saved, banned or deleted, and
         the delete question; its search finding either language, and
         Sort by name in the page's language;
       - a company's own pages, its settings and its payments: their
         heading;
       - the preview note ("Previewing … at …").
       The address keeps naming the company in view by its English name,
       as now: it's how a link names it.
     - **7c-2. The company columns and selects of the other screens (Done,
       #411):**
       All users, the audit log, check-ins, clients, places, records, the
       client pickers' company beside each client, Add employee's company,
       Copy roles, role change requests, access reviews and template
       offers:
       - each company in the page's language, the company selects in the
         page's order (as the switcher, #410);
       - All users' search finds a company by either language, as the
         Companies page's does.
8. **The other screens show names in the page's language,** by area:
   tasks, obligations, records, attendance, requests, payroll, the
   client's area, and notifications and messages written from then on.
   As many PRs as it takes, each listing its screens. Each name is in the
   page's language, or in the one it has while it has only one, and a
   list of names to pick from is in the page's order: on an Arabic page,
   the ones with an Arabic name first, in Arabic order, then the rest as
   before, as the Clients page lists clients (#407).
   - **8a. The shared pickers and filters (Done, #412):** the building blocks
     the areas share, so that each area's PR has only its own screens:
     - the people a task or an obligation is for: the assignee checklist
       on New task, its bulk upload's rows and a task's Transfer, and on
       New obligation and an obligation's Edit. Each person in the page's
       language, found by either language, in the page's order; on New
       task and New obligation still grouped by role first;
     - the employee filter of the tasks, obligations, costs and requests
       lists: each person in the page's language, in the page's order;
     - the client filter of the tasks and costs lists, and the client
       beside each place in their place filter;
     - the client pickers: on New task and a task's Edit details, and on
       the places' filter, Add place and the charges' filter: each client
       in the page's language, in the page's order.
   - **8b. The tasks screens (Done, #413):**
     - the tasks list: each task's assignees, or who assigned it on one's
       own list, and the client in the line under its title, with its
       location's client;
     - a task's page: its assignees, who assigned it, its client and its
       location's client, and the note when someone it's for was deleted;
     - its sections and dialogs: Edit details' assignees and location,
       Transfer's lines on the money held for it, the costs' settlements,
       and the penalty's person.
   - **8c. The bulk upload's template and file (Done, #414):**
     - the template, in the language it's downloaded in: its people
       ("Name (username)") and its clients, each in that language, or the
       one they have, in that language's order, and each location's
       client in that language;
     - a file's client found by its English or its Arabic name, any case,
       so a file filled in from either template reads the same. Its people
       are found by username, and its locations by the template's own list,
       as before.
   - **Then, by area,** one PR or more each: obligations, records and the
     documents, attendance, requests, payroll with the costs and charges
     lists, the client's area, and last, names written from then on:
     notifications and messages, who last changed a status, a cost's or a
     location's author, and one's own name in the account menu.

## 4. A development database (Done)

- **Today:** a preview build runs its migrations on the production
  database, so a change being tried touches the real one.
- **Proposed:**
  - a second Supabase project for previews and development;
  - Vercel's preview environment points to it, and production is migrated
    only from `main`;
  - its keys live in Vercel and GitHub's secrets only, as every key does;
  - done before §2 and §3, which both add migrations.
- **Decided (2026-11-22):**
  - the second project is on Supabase's free plan;
  - it starts empty, with made-up data, so no real name or figure leaves
    production.
- **On the free plan:** a project that isn't used for a week is paused,
  and a preview waits for it to be woken; it holds up to 500 MB, plenty
  for made-up data.
- **What's there today** (looked at on 2026-11-22, reading only):
  - the Supabase organisation is on the free plan, with one project
    active, Nizmo's, and two paused ("maktab drill" and "shsd website").
    The free plan allows two active, so there's room for one more;
  - Vercel has 16 database settings, each one value shared by
    production, previews and development. The app reads 7 of them:
    `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`,
    `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
    `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` and
    `DATABASE_URL`, where it's set;
  - every build runs `prisma migrate deploy` before it builds, so a
    preview migrates whichever database its settings name;
  - files go to Storage's `app-assets` bucket, and live updates sign
    their tokens with the project's JWT secret, so a preview pointed at
    the new project needs both there too.
- **Built in steps,** each confirmed by the owner before it touches
  anything outside the repo:
  1. **The project:** "nizmo dev", as the owner named it, on the free
     plan, in the same organisation and region as production
     (`eu-west-1`), made from here. **Done on 2026-11-22**, for $0.
  2. **Its storage and secret:** the `app-assets` bucket made on it, and
     whether it still has a legacy JWT secret checked. If it hasn't, live
     updates don't work on previews until they're signed another way,
     which is its own decision. **Done on 2026-11-22:** the bucket is
     public with no limits, as production's is, and the project has its
     legacy keys (HS256), so live updates can sign as they do now.
  3. **Vercel's settings, by the owner,** with a guide: each setting the
     app reads kept for production alone, and a value for previews and
     development added from the new project. Its keys go from Supabase's
     page to Vercel's and nowhere else, never through the chat or the
     repo. **Done on 2026-11-22:** production's 16 settings are kept for
     production alone (its store's allowed environments), and "nizmo
     dev" is connected to previews from Vercel's Storage Integrations:
     the same 16 names, no prefix, no Supabase preview branches, each
     marked sensitive. Not to development: Vercel can't mark those
     sensitive, and Nizmo run on a computer uses its own local database.
     Development can be added later, unmarked.
  4. **The first preview:** a PR's preview migrates the new project, and
     the made-up data goes in after. **The owner's sign-in
     (2026-11-22):** the protected Super Admin is copied from
     production, its email, names and password, as the owner asked; its
     email stays checked, and it has no two-step code, since previews
     don't have production's key for those codes or a way to send email.
     Everything else is made up. **Done on 2026-11-22:** #363's preview
     (cc71ac6) applied all 122 migrations to it, with no errors. The
     made-up data went in after: one company, with two Admins, an
     employee, two clients with tax claims, and its attendance rules.
     Their passwords are known to no one; the Super Admin resets one to
     sign in as them.
  5. **Checked:** the preview works against it, and production's
     database got nothing from it. **Done on 2026-11-22:** the owner
     signed in on the preview, and the sign-in is in "nizmo dev"'s
     audit log. Production's database has had no migration since
     #362's deploy.
- **Names (the owner, 2026-11-22):** the new project is "nizmo dev".
  Renaming production's Supabase project ("maktab project") and the
  Vercel project to Nizmo changes only their labels; their addresses and
  keys stay. The GitHub repository keeps its name for now: the Super
  Admin's backup and restore buttons call it by name.
- **The rest of the renaming (decided 2026-11-22):** the owner chose all
  three:
  1. **The Vercel project** becomes "nizmo", made from here. Only
     Vercel's own addresses change (`maktab-project-…vercel.app` to
     `nizmo-…vercel.app`); nizmo.vercel.app, which the app, the mobile
     app and the terminals use, stays.
  2. **The GitHub repository** becomes "nizmo", renamed by the owner.
     GitHub forwards the old name's links and API calls, so nothing
     stops; then one PR names it anew where the code does: the Super
     Admin's backup and restore buttons, the payroll-clearing script and
     the README.
  3. **New backups are named `nizmo_…`,** in the same PR. Older
     `maktab_…` backups still restore: the restore takes the newest by
     how a name ends, and the clean-up goes by age.
- **Previews hold no production secret (2026-11-22):** `CRON_SECRET` is
  for production alone, since only production runs the scheduled jobs,
  and the Development copies of it and of `NEXTAUTH_SECRET`, which
  nothing used, are deleted.
- **"maktab drill":** the paused project the restore drill writes into
  (`DRILL_DATABASE_URL`), holding a restored copy of real data from
  17 September 2026. Nothing ran on it by itself: only a restore run by
  hand with the target "drill". **Deleted by the owner on 2026-11-22,**
  with `DRILL_DATABASE_URL` and the unused MongoDB store. A drill run
  now stops before touching anything; the next one needs a fresh free
  project and the secret set again. The payroll-clearing script's check
  still finds the drill that passed on 17 September.
- **"nizmo dev" in Vercel:** its store is named `nizmo-dev`, since Vercel
  allows no spaces, and the Supabase project followed.
- **IDs that can't change:** HERE's project ID (`maktab-project`) and
  Google Cloud's (`maktab-backups`) keep the old name, as those services
  never let an ID change; their names say Nizmo. So does
  `maktab-project-zeta.vercel.app`, kept on purpose: it forwards to
  nizmo.vercel.app, for any old link or device still using it.
- **To know:** a free project is paused after a week without use; a
  preview built then fails at its migrations until it's woken, from
  Supabase's page or from here.
- **Also to know:** saving the production store's settings in Vercel can
  make Supabase restart production's database. On 2026-11-22 a save at
  10:25:13 UTC was followed six seconds later by a restart, and the app
  couldn't reach its database for about 90 seconds; no data was lost.
  Those settings are best changed at a quiet time.
- **Kept apart (2026-11-22):** previews and production shared
  `NEXTAUTH_SECRET`, so a session made on a preview was one production
  accepted until its next check, a minute at most, and the owner's copy
  had their production ID and no two-step code. Now previews have their
  own `NEXTAUTH_SECRET`, the copy in "nizmo dev" has its own ID, and
  previews are behind Vercel Authentication (Standard Protection), so
  only the Vercel team opens them; nizmo.vercel.app stays open.

## 5. Rules between permissions (Done)

The owner asked on 2026-11-22 for rules when the Super Admin makes a role
or changes one: some permissions can't be given without others first.
Approved as recommended the same day.

- **Today:** a permission can imply another (`implies` in
  `lib/permissions/catalogue.ts`). Ticking it ticks the other at the same
  scope, and the other can't be unticked while it's needed. Nearly all of
  them stay inside one area, and the Super Admin isn't told why one was
  ticked.
- **Found missing (22 November):**
  - adding or reassigning an obligation or a task needs the person
    picker, which asks for the employee list (`employees.view`): without
    it, nobody can be picked;
  - the places in a file of tasks need `locations.view`;
  - a company-wide permission whose picker is held for a team offers the
    team only;
  - the person filter on four lists, fixed in #368 (`UI_PLAN.md`).

### 5.1 The rules

They work together, each for a different case.

1. **Another area's: ticked first.** A permission that can't work without
   one from another area stays greyed in the role editor, with "Needs
   *See locations* first", until that one is ticked. The server refuses
   to save a role that breaks it, naming what's missing. Nothing is
   ticked for the Super Admin: across areas, that would give access
   nobody chose. Example: "Create tasks" needs "See locations" first.
2. **Its own area's: ticked for you, and says why.** As today, with a
   note on the row: "Added because *Approve obligations* needs it".
   Unticking it asks "*Approve obligations* needs it. Remove both?"
   As built in #374:
   - The row isn't greyed any more. Unticking it asks, in a
     confirmation over the role editor: "Remove *See obligations*?",
     then who needs it, then Cancel and "Remove both", or "Remove all"
     where more than one needs it.
   - What it removes is everything ticked that needs it, all the way
     down: unticking See salaries takes See payroll and Prepare payroll
     with it, as See payroll would only bring it back.
   - The same for one another area's permission needs (rule 1): its
     note stays "Needed by *Create tasks*", as the Super Admin ticked it,
     and unticking it asks the same.
   - Nothing is asked for a row nothing needs, and the server is
     unchanged: it still adds what's implied, as it always has.
3. **Works with less: a warning on saving.** A permission that works
   without another, but with less, is saved once the Super Admin confirms
   a warning naming what's missing, as the separation-of-duties pairs are
   (`ROLES_PLAN.md` §6.11). Example: "Create tasks" without "See
   clients" saves with "Create tasks without See clients: no client can
   be picked for a task." As built in #373:
   - The role editor lists, under the matrix, each one the role holds,
     in the Waiting on someone colour a warning takes (`DESIGN.md` §2.3).
   - One that a save newly brings needs "I understand, keep it this way"
     ticked. The server refuses it otherwise, as it does an
     unacknowledged pair, and records the decision. One the role or
     template held before isn't asked again.
   - Held or not: how wide it's held doesn't count here, as scope is for
     rules 1 and 2. A permission another held one brings with it carries
     none, as for rule 1: "See salaries", brought by "See payroll", warns
     of nothing.
   - Applying a template and copying a company's roles don't ask again,
     as for the pairs: it was decided when the template or role was saved.
4. **Roles already saved: marked, and fixed by hand.** A role that breaks
   rule 1 says what's missing ("Can't place a task file's tasks: needs
   *See locations*"), with a button that adds it once the Super Admin
   confirms; the Super Admin's roles list shows which roles need it.
   Nothing widens anyone's access on its own. As built in #375:
   - The company's roles, and the role templates, mark each that breaks
     rule 1 with a "Needs a permission" badge in the Problem colour, and
     a line for each need: "Create tasks needs *See locations* first".
   - In the role editor, the row, ticked and in red since #372, has a
     button beside its note, "Add *See locations*", which ticks it, at
     the narrowest scope that's wide enough. It changes the form only:
     Save, with what it reaches, is the Super Admin's confirmation, and
     nothing is written until then.
5. **People pickers: names only.** The four pickers that hand work to
   someone (Add obligation, reassigning one, Create task, and
   reassigning or transferring a task) ask a list of their own instead of
   the employee list:
   - asked only by whoever holds that action's permission;
   - names only: no phone, email, status or profile;
   - the people that permission may hand work to: held for a team, the
     team, without the company's Admins; held for the company, the
     company; never another company's people or a deleted account.
   - The server's check on saving (`checkAssignees`) stays the lock, and
     a test holds the list and the check to the same people. So these
     need no "See employees", as Attendance's picker already doesn't
     (`/api/attendance/people`).
   - **Transferring a task** had a check of its own: held for a team, it
     went to anyone but the company's Admins. It now goes to the team, as
     creating and reassigning do, through the same check (decided
     2026-11-22).
   - **A deleted account** isn't offered, and the check on saving refuses
     handing work to one. Someone deleted who is already on the work
     stays until it's reassigned, as now.

- **Scope:** a needed permission is held at least as wide as what needs
  it, in rules 1 and 2. A company-wide one needs a company-wide one.
- **Everywhere a role is written:** making or editing a role, a template,
  applying a template to roles, an Admin asking for a role, and the grant
  for companies already there (§2).
- **Kept true:** each need is written in the catalogue: `implies` for its
  own area's, a `requires` list for another area's, and a list of the
  softer ones for rule 3. A test reads what each screen asks the server
  for against the permission that opens it and that permission's needs,
  so a screen that quietly needs another permission fails in CI. As
  built from #376 (`lib/screen-asks.test.ts`), a table checked against
  the code:
  - For each screen, every call it makes, a method and a path, found in
    the page and the components it uses, is in the table, and nothing
    else: a new call, or a new method at a path already there, fails
    until it's written down.
  - Each call is one of: **needed** whenever the screen is open, naming
    the permissions its route answers; asked only **when** the viewer
    holds one, quoting the code that decides it, in the screen or, where
    the server gives a button what it needs only for its holders, in the
    server; open to **anyone** in the company; or the **Super Admin's**
    only, such as the company picker, with its code quoted too. That
    method's handler, or a service it names, names each permission the
    table gives it, and each quoted gate is in the code, naming its
    permission. Since #387, a call can also be **not here**: in a
    component the screen uses, but never sent from this screen, with the
    code that shows why quoted, as the location form's editing is from a
    task's place picker, which only adds. Since #389, a call built from a
    table of paths in the same file is read where the table is used, so
    Requests' decisions and withdrawals are checked, and the table's
    entries aren't taken for calls. Since #391, a call's method is read
    from the call its path is given to, whether fetch, a helper such as
    attendance's `send`, or one a screen writes, such as its `act`, and
    from `method: …` or `json('POST', …)` after the path, so a write sent
    through a helper isn't taken for a read. Since #392, a call not made
    here because the screen imports only part of a file is checked both
    ways: the import quoted is in the code, and no file of the screen
    takes anything else from that file, so a second import of it can't
    leave real calls marked as not made. Since #393, the test also
    follows a `lib` file that sends through a sender the screen gives it
    (`post: Post`, as `lib/mobile` does for check-in), and reads each call
    through that sender as POST, as the screen's senders send JSON by
    POST; other `lib` files aren't followed, as tables of paths such as
    `lib/features/routes.ts` aren't calls. Since #394, a path a function
    builds, in the screen's files or a file they import, such as
    `assigneesUrl(…)` from `lib/assignees-url.ts`, is read where it's
    used, with the method of the call it's given to, not where it's
    built; and a method given as an argument of its own, as the attendance
    calendar's helper takes it (`send(path, 'DELETE', …)`), is read too.
    Since #395, a function handed to a component as a prop that builds a
    path, `saveUrl={(kind, language) => companyMessageApi(…)}`, is read by
    the prop's name where the component calls it, as the message editor
    saves with `fetch(saveUrl(…), { method: 'PUT' })`.
  - A needed call is met by each permission that opens the screen:
    itself, one it brings (`implies`), or one it needs first
    (`requires`). Anything else fails, naming the screen and the call.
    A screen anyone in the company opens, showing each person what they
    may see, such as Tasks, has no needed call (#387): each is asked
    only of whoever holds its permission.
  - Every page is in the table, waiting for it, or outside it (the
    Super Admin's own pages, and one's own). The table comes in parts:
    first the screens the remaining splits change, so each split keeps
    its rows; the rest after. Since #395 none waits: every page is in
    the table or outside it, and a new page fails until it's one or the
    other.

### 5.2 Order

Each a PR of its own, before the rest of §2's splits, so that each split
from then on names its needs, and before the grant for companies already
there:

1. **The list of needs** (Done, #369): every permission's needs, found
   by reading what each screen asks the server for against the routes'
   permissions, written here as a table for the owner to approve. No
   code.
2. **The names-only list for pickers** (Done, #371) (rule 5), and the
   four pickers on it.
3. **The rules in the role editor and on the server** (Done) (rules 1
   to 3), one PR each: rule 1 first (#372), as it's the one that refuses
   a save; then rule 3's warning (#373); then rule 2's notes (#374).
4. **Roles already saved** (Done) (rule 4, #375), after a read-only
   count of the roles in production that break a rule. Counted on
   2026-11-22, before #372: of the 3 roles in production, none breaks
   rule 1, and there are no templates. Built as #375.
5. **The screen test** (Done, #395) ("Kept true" above), decided by the owner on
   2026-11-23 to come before the splits. In parts: #376 for the screens
   the remaining splits change (locations, saved lists, costs, clients,
   employees and payroll); then the splits, each keeping its rows; then
   the rest, about 220 calls on 29 screens, in parts by area: the task
   screens (#387); obligations, records and documents (#388); Requests
   (#389); the people screens (#390); attendance (#391); check-in
   (#393); then paths a function builds, which the test couldn't see,
   found missing on five screens already in the table (#394); and
   settings with the home page (#395), the last. A page that only sends
   you on to another is outside the table. Before check-in, #392 moves the helper that 15
   files borrowed from the Super Admin's roles card, for a refusal's
   words, into a file of its own, so Roles and access no longer reaches
   the card's calls.

The two screens found to fix in §5.3 go in one PR of their own, as #368
did, after the list is approved and before step 2: #370.

### 5.3 The list of needs (Decided, 2026-11-22)

Found by reading what each screen asks the server for, against the
permission that opens it, and where each permission's buttons are.
Approved by the owner as written on 2026-11-22.

**How a need is worked out:**
- **Where it's used:** a permission needs what lets its holder reach the
  screen it acts on, and what that screen asks the server for.
- **Brought with another:** a permission that another one brings with it
  carries no needs of its own. "See debts", brought by "Waive debts",
  doesn't need "See employees", as waiving happens on Payroll.
- **Already brought today:** a permission already brought from another
  area keeps being brought, as it shows nothing the first doesn't. "See
  payroll" brings "See salaries", "See tax positions" brings "See
  clients", "Manage client accounts" brings "See clients", and "Set up
  fingerprint terminals" brings "See company settings". Rule 1 is for
  needs that would show more.

**Rule 1, another area's, ticked first:**

| Permission | Needs | Why |
|---|---|---|
| `tasks.create` | `locations.view` | A task needs a place, picked from the saved ones, and a file of tasks names its places |
| `salary.edit` | `employees.view` | Changed on an employee's profile, which only "See employees" opens |
| `dayoff.adjust_credit` | `employees.view` | The same |
| `salary_adjustments.manage` | `employees.view` | Added from the Employees list or an employee's history |
| `settlements.manage` | `employees.view` | On an employee's history only |
| `debts.view` | `employees.view` | On an employee's history only, unless brought by "Waive debts" |
| `costs.view` | `employees.view` | Somebody else's costs show on their history only |
| `requests.reset_points` | `employees.view` | On the Employees list only |
| `debts.waive` | `payroll.view` | Waived on the Payroll page only |

Each held at least as wide: all of these are for the company.

**Rule 2, its own area's, ticked with a note:** every `implies` today,
unchanged (`lib/permissions/catalogue.ts`), such as any obligation
permission bringing "See obligations". None found missing.

**Rule 3, works with less, a warning on saving:**

| Permission | Without | It works, but |
|---|---|---|
| `tasks.create` | `clients.view` | no client can be picked for a task |
| `salary.view` | `employees.view` | salaries don't show on the Employees list or a profile, only where a page shows them without it, such as Attendance's days and exceptions |
| `settings.edit` | `salary.view` | the attendance policy's preview shows days, not money |

**Rule 5, the names-only list,** for four pickers, so none of them needs
"See employees":

| Permission | Picker |
|---|---|
| `obligations.create` | Add obligation |
| `obligations.edit` | Reassign an obligation |
| `tasks.create` | Create task |
| `tasks.transfer` | Transfer a task |

**Found along the way, to fix like #368, not rules:**
- **Suggested names:** listed at first, wrongly. The saved names a picker
  suggests, and the Tasks and Costs lists' title and cost-name filters,
  are for anyone in the company: `GET /api/lists` asks no permission, and
  nobody is refused (`lib/saved-lists.db.test.ts`). Nothing to fix.
- **An employee's history** asks for the person, their day off and their
  costs whatever the viewer holds: someone who may see salaries alone gets
  no name in the title and two tabs that say they didn't load. Each part is
  now asked for only when its route answers the viewer, and its tabs are
  those parts (`lib/history-parts.ts`, #370).
- **The history link** on the Employees list is offered by "See salaries"
  only, though its tabs are for day off, costs, debts and settlements too.
  It's now offered to who sees any of them on that person's history: a
  permission held for a team counts only for the people its holder leads,
  as the routes check; without See employees, or when looking them up
  fails other than by a refusal, who leads them isn't known, so the route
  decides (#370).

## 6. Status counts on All users (Done)

The owner asked, on 2026-11-23, for badges at the top of the Super Admin's
All users page, each saying how many people have one status. Approved the
same day as drawn in the All users: status badges canvas
(https://claude.ai/artifact/Hhwmkp6AxkidZz9uSAX9FU), and described in
`DESIGN.md` §5.5, Status counts.

- **Where:** All users, on the At work tab, between the tabs and the
  filter bar.
  - The Left tab has none: everyone on it has the same status.
  - A company's own Employees list has none, for now.
- **The badges:** Online, Offline, Suspended and Archived, in that order,
  each with its count, in its status's colours.
  - Each is there at 0 too, so the row doesn't move.
  - Inactive gets none. Nothing sets it, and checked read-only on the live
    database on 23 November, nobody has it: every person there is stored
    as active.
- **What they count:**
  - everyone at work in the company picked, or in every company, on every
    page of the list, counted by the server;
  - the search doesn't change them;
  - Online is whoever has a tab open now, as the list's badges say
    (`lib/presence.ts`); Offline is everyone else at work, apart from
    those suspended or archived.
- **Pressed:**
  - a badge shows only its status in the list, from its first page, with
    the company and the search as they are;
  - the address keeps it, as it keeps the tab, so a reload or a shared
    link shows the same;
  - a line under the row says so, such as "Showing online people only.",
    with Show everyone;
  - pressed again, it shows everyone.
- **Live:** as people come and go, Online and Offline change in place, as
  the list's badges do. When someone's tab goes quiet with nothing heard,
  the counts are fetched again with the list, when the first person
  counted online would stop counting (`REALTIME_PLAN.md`, part 6b).
  - With every company, the page hears each company the picker lists, not
    only those on the page shown, so a count changes for someone on
    another page too. It's the Check-ins page's way, with the same known
    limit: about 95 companies (`REALTIME_PLAN.md`, part 4c). There's one
    company on the live database today.
- **How it's built (#384):**
  - `GET /api/users` answers with `statusCounts` when asked for them, for
    the Super Admin only. They're counted over the same company and tab as
    the list, without its search or status: one count for each status,
    Online and Offline as the list's own status filter asks
    (`presenceWhere`).
  - Asked for counts, its `onlineRunsOutInMs` covers everyone counted
    online, not only the people on the page shown.
  - A pressed badge asks the list for its status with the `status` the
    route already takes: `ACTIVE`, `OFFLINE`, `SUSPENDED` or `ARCHIVED`.
  - The words: the badges' group, "People by status", and the line, in
    both languages.
- **Then** the grant for companies already there (§2), as #385.

## Not here

- The client portal's later ideas stay in `CLIENT_PORTAL_PLAN.md` §13.

## Change log

- **2026-11-21:** Plan written from items 7 to 10 of the owner's list:
  the company's name and icon, splitting each "manage" permission, names
  in both languages, and a development database. To discuss after
  `FIRST_CHANGES_PLAN.md`.
- **2026-11-22:** The owner's answers: the development database on
  Supabase's free plan, starting empty with made-up data, comes first; the
  company's name and icon move to `THIRD_CHANGES_PLAN.md`; names in both
  languages for all three, by a free way. Recommended, for the owner: each
  "manage" permission split by what it does, three left whole, clients
  and obligations first; and names suggested from a list written into
  Nizmo, what each company saves, then the rules.
- **2026-11-22:** The owner approved both recommendations: each "manage"
  permission split by what it does, and names suggested from a list,
  what each company saves, then the rules. The development database is
  next.
- **2026-11-22:** The development database's first two steps done: "nizmo
  dev" made on the free plan, with the `app-assets` bucket and its legacy
  keys. The owner's names, and "maktab drill" for the owner to delete.
- **2026-11-22:** The development database's third step done: previews
  have "nizmo dev"'s 16 settings, and production keeps its own. The
  owner's sign-in for it is their protected Super Admin, copied from
  production without the two-step code.
- **2026-11-22:** The development database is done: #363's preview
  migrated "nizmo dev", the made-up data went in, and the owner signed in
  on the preview. Production's database got nothing from it. The parts'
  headings say what was decided. Saving the production store's settings
  restarted production's database for about 90 seconds; noted, with
  when to change them.
- **2026-11-22:** Previews and production kept apart: previews have
  their own `NEXTAUTH_SECRET` and are behind Vercel Authentication, and
  the owner's copy in "nizmo dev" has its own ID.
- **2026-11-22:** #363 merged. The rest of the renaming decided: the
  Vercel project and the GitHub repository become "nizmo", and new
  backups are named `nizmo_…`. Previews hold no production secret now.
- **2026-11-22:** #364 merged. "maktab drill" deleted by the owner, with
  `DRILL_DATABASE_URL` and the unused MongoDB store; the development
  database's store is named `nizmo-dev`.
- **2026-11-22:** The renaming finished outside the code too: HERE,
  Google Cloud, Drive, cron-job.org and Sentry say Nizmo, and the IDs
  that can't change are noted. How the "manage" split is built: one PR
  each, clients first, the old permission read as its parts until the
  grant for companies already there.
- **2026-11-22:** Clients split (#365): `clients.create`,
  `clients.edit` and `clients.delete` reuse two names records had until
  4 November; nothing stored keeps the old meaning, apart from older
  audit-log lines.
- **2026-11-22:** #365 merged. A fix found at the first customer's goes
  first, as #366 (`ATTENDANCE_PLAN.md` §14, §17.13): choosing who an
  employee number is, and the HR officer's own. The obligations split is
  #367.
- **2026-11-22:** #366 merged. What each part of `obligations.manage`
  covers, for #367: an obligation's details don't change once it's made,
  so editing is handing it to other people and moving it along.
- **2026-11-22:** #367 merged. The person filter on four lists, found in
  its walk-through, is fixed first, as #368 (`UI_PLAN.md`); then
  locations, lists and charges.
- **2026-11-22:** #368 merged. Rules between permissions (§5), approved
  as recommended: another area's needed permission ticked first, its own
  area's ticked with a note, softer needs a warning, roles already saved
  marked, and a names-only list for the four people pickers. They come
  before the rest of §2's splits: first the list of needs, for the
  owner's approval.
- **2026-11-22:** The list of needs (§5.3), proposed for the owner's
  approval: nine needs across areas, three softer ones, the four pickers,
  and three screens to fix as #368 was.
- **2026-11-22:** #369 merged, and the list of needs (§5.3) approved as
  written. The three screens it found are fixed first, as #370.
- **2026-11-22:** Checked against the code before building #370, the
  suggested names weren't refused after all: `GET /api/lists` gives them,
  and the filters' names, to anyone in the company. Two screens to fix,
  not three: an employee's history and its link on the Employees list.
- **2026-11-22:** Codex on #370: a permission held for a team reaches
  only the people its holder leads, so the History link and the page's
  tabs count it only for them; and a Salary tab without months says when
  its debts and settlements didn't load, rather than that there are none.
- **2026-11-22:** Codex on #370 again: without See employees, the page
  can't look the person up to know who leads them, so what's held for a
  team is asked for and its route, which looks them up, decides.
- **2026-11-22:** Codex on #370, a third time: when looking the person up
  fails other than by a refusal, the page doesn't know who leads them
  either, so the route decides there too, rather than the page saying it
  can't be opened.
- **2026-11-22:** #370 merged. Step 2, the names-only list for pickers,
  is next, as #371. Transferring a task held for a team was found to go
  to anyone but the company's Admins, where creating and reassigning keep
  to the team; the owner decided it keeps to the team too. And the check
  on saving now refuses a deleted account, as the list never offers one.
- **2026-11-22:** #371 merged. Step 3 goes one rule at a time, rule 1
  first, as #372. A read-only count first: none of production's 3 roles
  breaks rule 1, and it has no templates, so nobody's role stops saving.
- **2026-11-23:** #372 merged. Rule 3's warning is next, as #373. A
  read-only count first: of production's 3 roles, one would show it, the
  built-in Employee, which holds See salaries for the company without See
  employees. Nothing is refused for it: the note shows, and only a save
  that newly brings one asks to confirm. The owner was told. Rule 3's
  "It works, but" for See salaries now says what's lost, as an
  employee's history also shows salaries without See employees since
  #370.
- **2026-11-23:** #373 merged. Rule 2's notes are next, as #374, which
  also lets a row another one needs be unticked, asking first, where it
  was greyed: rule 1's needed rows too, as #372 kept them as rule 2's
  were.
- **2026-11-23:** #374 merged, and step 3 is done. Step 4 is next, as
  #375. Counted again, read-only: of production's 3 roles, still none
  breaks rule 1, and there are no templates, so nothing shows the mark
  today.
- **2026-11-23:** #375 merged. Before the splits, the owner chose the
  screen test the rules promised ("Kept true", §5.1), as step 5. Found
  to be about 280 calls on 45 company screens, it comes in parts: #376
  first, for the screens the remaining splits change.
- **2026-11-23:** Codex on #376: one path can carry two calls needing
  different permissions (reading a month's payroll, and saving it), and
  a "when" checked only that its permission was named somewhere on the
  screen. Each call is now a method and a path, and each "when" quotes
  the code that decides it.
- **2026-11-23:** #376 merged. The splits resume with locations, as #377.
  Adding a location has had its own permission, `locations.add`, since
  the Locations page, so it stays, as `lists.add` does, and
  `locations.manage` splits into two: `locations.edit` (details, pin and
  radius, and which is a client's HQ) and `locations.archive` (archiving
  and restoring).
- **2026-11-23:** #377 merged. The owner asked for `locations.add` to be
  named `locations.create`, as the table had it. It's done as #378, as a
  split into one with the splits' own machinery: a role still holding
  `locations.add` holds `locations.create`, so nobody loses access, and
  the rows are rewritten with the grant for companies already there.
- **2026-11-23:** #378 merged. Saved lists next, as #379: `lists.manage`
  splits into `lists.rename`, `lists.merge` and `lists.archive`, and
  adding stays `lists.add`. Unlike `lists.manage`, none of the three
  includes adding, as none needs it.
- **2026-11-23:** #379 merged. Charges next, as #380. `charges.collect`
  already has its own permission, so what `charges.manage` did, the
  service fee and leaving a cost off the bill, is named `charges.set`,
  as a split into one.
- **2026-11-23:** #380 merged. Client accounts next, as #381:
  `client_accounts.manage` splits into `client_accounts.view`,
  `client_accounts.invite` and `client_accounts.remove`. Inviting stays
  high-risk and asks for the step-up code; removing, which the table
  doesn't keep high-risk, no longer does.
- **2026-11-23:** #381 merged. Salary adjustments next, as #382:
  `salary_adjustments.manage` splits into `salary_adjustments.add` and
  `salary_adjustments.reverse`, which covers rolling back and reversing.
  Both stay high-risk.
- **2026-11-23:** #382 merged. Settlements next, as #383, the last of the
  table's splits: `settlements.manage` splits into `settlements.view` and
  `settlements.resend`. Then the grant for companies already there.
- **2026-11-23:** #383 merged, the last of the table's splits. The owner
  asked for status counts on All users and approved them with their
  canvas: §6, built next as #384, before the grant for companies already
  there.
- **2026-11-23:** #384 merged. The grant for companies already there
  next, as #385: one migration that replaces each role's and template's
  split permissions by their parts. Then the old codes are retired.
- **2026-11-23:** #385 built. Its database test found that reading a role
  holding both a split permission and one of its parts could narrow the
  part, so reading now keeps the wider scope, as the migration does. No
  role on the live database holds both.
- **2026-11-23:** #385 merged and live: the three built-in roles hold 30
  rows of parts, and no old rows. The old permissions retired next, as
  #386.
- **2026-11-23:** #386 merged and live, and §2 is done. The screen test
  goes on with the task screens, as #387. The rest, found to be about
  220 calls on 29 screens, comes in parts by area. Two kinds of row are
  added for them: a screen anyone in the company opens, which needs
  nothing, and a call not made here.
- **2026-11-23:** #387 merged. The obligation, record and document
  screens next, as #388, with the two tax pages, which ask the server for
  nothing: the statement is drawn on the server, and the export page
  gives a bookmark to run on the tax portal's own site.
- **2026-11-23:** #388 merged. Requests next, as #389, on its own: its
  attendance calls are built from a table of paths, which the test read
  as lists the page never asks for, missing its decisions and
  withdrawals. The test now reads such a table where it's used. The
  people screens follow.
- **2026-11-23:** #389 merged. The people screens next, as #390: a
  profile, one's own or someone else's; someone's cash advance; and Roles
  and access, which imports only a helper from the Super Admin's roles
  card, so the card's calls aren't made from it.
- **2026-11-23:** #390 merged. Attendance next, as #391, and check-in
  after it, as #392. Attendance sends its writes through a helper, `send`,
  and one of its tabs through its own, `act`, so the test reads a call's
  method from the call its path is given to; check-in's own calls are made
  from `lib/mobile`, through a sender the screen passes in, which #392
  teaches the test to follow. Attendance imports two of Requests' dialogs,
  asking for a permission and reporting a missing punch, from the file
  that also decides and withdraws: that file's other calls aren't made
  from it.
- **2026-11-23:** The owner agreed to two fixes before check-in, as #392,
  so check-in becomes #393. Roles and access borrowed one helper,
  `refusalOf`, from the Super Admin's roles card, as 14 other files did,
  so the test counted the card's 10 calls as the screen's, written down
  as not made here. The helper moves into `lib/api-error-text.ts`, beside
  the one it's like, and those rows go. And a not-here row whose reason
  is an import only checked that the import was there: a second import
  of the same file, taking more, would have left real calls marked as
  not made. The test now checks that the screen takes nothing else from
  that file, which keeps attendance's request dialog rows honest too.
- **2026-11-23:** #392 merged. Check-in next, as #393. Its own calls,
  registering a phone, checking in, face keys and photos, and the push
  token, are made from `lib/mobile`, through a `post` the screen passes
  in. Following every `lib` file was tried and dropped: it took tables of
  paths for calls, 20 on Tasks alone. So the test follows only a `lib`
  file that sends through a `post: Post` it's given, which is exactly
  `lib/mobile`'s three. Check-in imports one dialog from attendance's
  Requests tab, asking for a permission when late, so that tab's other
  calls aren't made from it.
- **2026-11-23:** #393 merged. Reading settings for the last part
  showed two forms the test couldn't see. A path a function builds, such
  as `nizmoAgainApi(…)`, wasn't read where it's used, and the builders in
  `lib` weren't read at all: six calls were missing on five screens
  already in the table, the assignee lists on new task, a task, new
  obligation and an obligation, the raw template on new task, and a
  client's people. Each turned out gated as it should be, so nothing in
  the app was open; the test was blind to them. And the attendance
  calendar's helper takes its method as an argument of its own,
  `send(path, 'DELETE', …)`, which the test read as GET. #394 teaches the
  test both and writes the six calls down; settings and the home page
  follow as #395, the last part.
- **2026-11-23:** #394 merged. Settings and the home page next, as #395,
  the last part: settings' 64 calls, its client message page's 2 and
  terminal guide's 1, and the home page, which asks the server for
  nothing. The client message page hands the editor a function that
  builds the save path as a prop, so the test learns that form too:
  read by the prop's name where the editor calls it, as a PUT, not as a
  read where it's handed over.
- **2026-11-23:** #395 merged: the screen test is done, and with it the
  rules between permissions (§5). §5 and status counts on All users (§6,
  #384) marked done, with §5.2's steps. The names (§3) next, starting with
  a mockup of the name fields for the owner.
- **2026-11-23:** #396 merged. The name fields drawn for the owner, who
  asked for names of up to 40 characters, where they were 15: #397, before
  the rest of §3.
- **2026-11-23:** #397 merged: names of up to 40 characters. The owner
  approved the name fields' design the same day, written into
  `DESIGN.md` §5.3, and §3 is split into its steps (§3.1), starting with
  both languages kept (#398).
- **2026-11-23:** #398 merged: both languages kept (§3.1, step 1). From
  its Codex review, an unchanged name sent back with a form leaves a
  corrected Arabic as it is, and a company's Arabic name is in its audit
  log. Nizmo's list of names and the rules next, as #399.
- **2026-11-24:** #399 merged: Nizmo's list of names and the rules
  (§3.1, step 2), with 698 names where about 2,000 were planned. From its
  Codex review, El spaced before a guessed name is read as joined, and a
  number is kept. Step 3 split in two: the company's spellings learned
  (#400), then read by the forms (#401).
- **2026-11-24:** #400 merged: the company's spellings, learned (§3.1,
  step 3a), and a deleted employee's names in Arabic going with them.
  Their reading next, as #401: the server asked, as no screen asks until
  step 4, so the screen test lists the call with step 4's forms.
- **2026-11-24:** #401 merged: a name's suggestion, the company's
  spellings first (§3.1, step 3b). From its Codex review, a business's
  spellings are looked up without its business words. Step 4 split in
  three: Add employee (#402), an employee's page and one's own profile
  (#403), and a request to change one's own name (#404).
- **2026-11-24:** #402 merged: each name in English and in Arabic on Add
  employee (§3.1, step 4a), the two fields a building block. In it, the
  owner lowered a name's limit to 30 characters, from 40. From its Codex
  review, a suggestion longer than a name may be is asked to be
  shortened, and a new list of spellings starts with nothing under the
  keys. An employee's page and one's own profile next, as #403.
- **2026-11-24:** #403 merged: each name in English and in Arabic on an
  employee's page and one's own profile (§3.1, step 4b), with the note
  above a name missing a language as a building block. For a request to
  change one's own name, next as #404, the owner chose that the rest of
  one's own profile is saved as before while the name misses a language.
- **2026-11-24:** #404 merged: a request to change one's own name in
  English and in Arabic (§3.1, step 4c), which finishes employees' names
  in the forms. Its approval saves both, the Requests page shows both,
  and the rest of one's own profile is saved as before. From its Codex
  review, one's session keeps their name as it's stored where it's asked
  for. The flow found, and the PR fixed, a name saved before in Arabic
  only blocking every save of one's own profile. The Employees page next,
  as #405.
- **2026-11-24:** #405 merged: employees' names on the Employees page in
  the page's language (§3.1, step 5), with the ones still missing a
  language and a search finding either, the note above the list a
  building block. The owner chose a client's names' limits: 100
  characters for its own, as before, and 60 for its owner's. Clients'
  names in their form next, as #406.
- **2026-11-24:** #406 merged: a client's name and its owner's in English
  and in Arabic in its form (§3.1, step 6a), up to 100 and 60 characters,
  the note at the top naming which is in one language only. The Clients
  page next, as #407.
- **2026-11-24:** #407 merged: clients' names on the Clients page in the
  page's language (§3.1, step 6b), with the ones still missing a language
  and a search finding either, which finishes clients' names. The
  company's name next, as #408.
- **2026-11-24:** #408 merged: the company's name in English and in
  Arabic (§3.1, step 7a), in the Super Admin's company dialog, 2 to 50
  characters, and an Admin's Company settings saying while it's in one
  language only that Nizmo's team adds the other, as the owner chose. The
  company's name shown in the page's language next (step 7b).
- **2026-11-24:** #409 merged: the company's name in the page's language
  to its people and its clients (§3.1, step 7b): the side bar, the account
  menu, Company settings' logo card, the client's area's top bar, and the
  payslip, settlement, client statement and tax position statement. The
  session keeps it in both languages and catches it up on its minute's
  check, and, from its Codex review, the side bar and the account menu
  read the live session, so a name Nizmo's team completes shows without
  signing in again. The Super Admin's screens next, as #410 (step 7c).
- **2026-11-24:** #410 merged: the company's name in the page's language
  on the Super Admin's own screens for companies (§3.1, step 7c-1): the
  company switcher, found by either language and in the page's order, the
  side bar's name while looking at one company, from the company the page
  is drawn for, the Companies page, its search in either language and Sort
  by name in the page's language, a company's settings and payments
  headings, and the preview note. The company columns and selects of the
  other screens next, as #411 (step 7c-2).
- **2026-11-24:** #411 merged: the company's name in the page's language
  in the company columns and selects of the other screens (§3.1, step
  7c-2): All users, the audit log, check-ins, clients, places, records,
  the client pickers, Add employee, Copy roles, role change requests,
  access reviews and template offers, the selects in the page's order, and
  All users' search finding a company by either language. This finishes
  the company's name (step 7). The other screens' names next (step 8).
- **2026-11-24:** #412 merged: the pickers and filters the screens share
  name people and clients in the page's language (§3.1, step 8a): the
  assignee checklist on New task, its bulk upload's rows, Transfer, New
  obligation and an obligation's Edit; the employee filter of the tasks,
  obligations, costs and requests lists; the client and place filters of
  the tasks and costs lists; and the client pickers of New task, Edit
  details, places and charges. Each list in the page's order, a person
  found by either language. The tasks screens next.
- **2026-11-24:** #413 merged: the tasks screens name people and clients
  in the page's language (§3.1, step 8b): the tasks list's assignees, or
  who assigned it on one's own list, and the client under each title; a
  task's page, its assignees, who assigned it, its location's client, its
  client and the note on someone deleted; Edit details, the costs'
  settlements, the penalty's person, and Transfer's lines on the money
  held for it, whose preview now gives each name in both languages. The
  bulk upload's template and file next.
- **2026-11-24:** #414 merged: the bulk upload's template lists its people
  and clients in the language it's downloaded in, in that language's order,
  and each location's client in it; a file's client is found by its
  English or its Arabic name, any case (§3.1, step 8c). Obligations next.
