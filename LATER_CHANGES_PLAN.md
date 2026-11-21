# Later changes: plan

This file holds the second of two plans made from the product owner's list
of 21 November 2026: four changes to discuss once the first plan,
`FIRST_CHANGES_PLAN.md`, is done. Nothing here is decided yet. It is
updated with every decision and enhancement; the change log at the end
records each update.

Each part is marked:

- **Decided**: the product owner agreed to it.
- **Proposed**: suggested, waiting for the product owner's answer.
- **Open**: a question that needs answering before that part is built.

Status: **proposed, to discuss after the first plan.**

## 1. The company's name and icon (Proposed)

The owner asked that once someone signs in, the browser tab shows their
company's name and icon rather than Nizmo's. The same should go for the
website added to a phone's home screen, and for the mobile app once it's
released: installed as Nizmo, then showing the company's name and icon
after sign-in.

- **The browser tab:**
  - after sign-in, it shows the company's name and its logo;
  - the Super Admin keeps Nizmo's;
  - a client signed in to the client area sees their accounting office's.
- **The tab title bug:** a page reached by clicking a link has "Nizmo" as
  its tab title, though it's right when opened by its address (found in
  #356). It's fixed in the same work.
- **The website on a home screen:**
  - there's no web app manifest yet. One served for the signed-in person's
    company would carry its name and logo, as a square icon;
  - it takes the name and icon at the moment it's added, so it must be
    added after signing in;
  - an iPhone never updates them afterwards, and Android updates the icon
    from time to time.
- **The installed app** (`mobile/`, Capacitor around the website):
  - an app's name and icon are fixed in the build in the stores;
  - iOS and Android can only switch between icons built into the app, and
    iOS shows the person a message when it does;
  - neither can use a logo it downloads later, and the name can't change.
- **The ways for the app:**
  - **(a), proposed:** the store icon stays Nizmo's, and the company's logo
    shows inside the app after sign-in;
  - **(b):** a build of the app for each company, each with its own store
    listing and much more upkeep.
- **Open:**
  - (a) or (b);
  - what a company without a logo shows, such as its first letter on the
    brand colour.

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

## 3. English and Arabic names (Proposed)

The owner asked for names in English and in Arabic, both required, with the
other filled in when one is typed, if that's possible.

- **Today:** a name is kept once, as it was typed: an employee's first and
  last names, a client's name and its owner's, and the company's name.
- **Open: which names.** Employees, clients, the company, or all three.
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
- **Open:**
  - which way;
  - with the API, whether names may leave Nizmo.

## 4. A development database (Proposed)

- **Today:** a preview build runs its migrations on the production
  database, so a change being tried touches the real one.
- **Proposed:**
  - a second Supabase project for previews and development;
  - Vercel's preview environment points to it, and production is migrated
    only from `main`;
  - its keys live in Vercel and GitHub's secrets only, as every key does;
  - done before §2 and §3, which both add migrations.
- **Open:**
  - the Supabase plan for the second project;
  - whether the preview database starts empty with made-up data, or from a
    copy with every real name and figure replaced.

## Not here

- The client portal's later ideas stay in `CLIENT_PORTAL_PLAN.md` §13.

## Change log

- **2026-11-21:** Plan written from items 7 to 10 of the owner's list:
  the company's name and icon, splitting each "manage" permission, names
  in both languages, and a development database. To discuss after
  `FIRST_CHANGES_PLAN.md`.
