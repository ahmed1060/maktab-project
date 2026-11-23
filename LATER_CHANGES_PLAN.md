# Later changes: plan

This file holds the second of two plans made from the product owner's list
of 21 November 2026: four changes to discuss once the first plan,
`FIRST_CHANGES_PLAN.md`, is done. It is updated with every decision and
enhancement; the change log at the end records each update.

Each part is marked:

- **Decided**: the product owner agreed to it.
- **Proposed**: suggested, waiting for the product owner's answer.
- **Open**: a question that needs answering before that part is built.

Status: **being decided.** The first plan is done (#358 to #362). The
owner answered on 2026-11-22:
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

## 2. Each "manage" permission split (Decided)

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

## 5. Rules between permissions (Decided)

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
    permission.
  - A needed call is met by each permission that opens the screen:
    itself, one it brings (`implies`), or one it needs first
    (`requires`). Anything else fails, naming the screen and the call.
  - Every page is in the table, waiting for it, or outside it (the
    Super Admin's own pages, and one's own). The table comes in parts:
    first the screens the remaining splits change, so each split keeps
    its rows; the rest after.

### 5.2 Order

Each a PR of its own, before the rest of §2's splits, so that each split
from then on names its needs, and before the grant for companies already
there:

1. **The list of needs:** every permission's needs, found by reading what
   each screen asks the server for against the routes' permissions,
   written here as a table for the owner to approve. No code.
2. **The names-only list for pickers** (rule 5), and the four pickers on
   it.
3. **The rules in the role editor and on the server** (rules 1 to 3),
   one PR each: rule 1 first (#372), as it's the one that refuses a
   save; then rule 3's warning (#373); then rule 2's notes (#374).
4. **Roles already saved** (rule 4, #375), after a read-only count of the
   roles in production that break a rule. Counted on 2026-11-22, before
   #372: of the 3 roles in production, none breaks rule 1, and there are
   no templates. Built as #375.
5. **The screen test** ("Kept true" above), decided by the owner on
   2026-11-23 to come before the splits. In parts: #376 for the screens
   the remaining splits change (locations, saved lists, costs, clients,
   employees and payroll); then the splits, each keeping its rows; then
   the rest (tasks, obligations, requests, records, attendance and
   settings).

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

## 6. Status counts on All users (Decided)

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
