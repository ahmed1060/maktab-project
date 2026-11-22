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
- §2's split and §3's way, as recommended, approved the same day.

## 1. The company's name and icon (Moved)

Moved to `THIRD_CHANGES_PLAN.md` on 2026-11-22, as the owner asked, with
its open questions.

## 2. Each "manage" permission split (Proposed)

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
    there, in a PR of its own.

## 3. English and Arabic names (Proposed)

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

## 4. A development database (Proposed)

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
  1. **The project:** "maktab preview", on the free plan, in the same
     organisation and region as production (`eu-west-1`), made from here.
  2. **Its storage and secret:** the `app-assets` bucket made on it, and
     whether it still has a legacy JWT secret checked. If it hasn't, live
     updates don't work on previews until they're signed another way,
     which is its own decision.
  3. **Vercel's settings, by the owner,** with a guide: each setting the
     app reads kept for production alone, and a value for previews and
     development added from the new project. Its keys go from Supabase's
     page to Vercel's and nowhere else, never through the chat or the
     repo.
  4. **The first preview:** a PR's preview migrates the new project, and
     the made-up data goes in after.
  5. **Checked:** the preview works against it, and production's
     database got nothing from it.
- **To know:** a free project is paused after a week without use; a
  preview built then fails at its migrations until it's woken, from
  Supabase's page or from here.

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
