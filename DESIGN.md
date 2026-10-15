# Nizmo design rules

How Nizmo looks, in English and Arabic, on phones and computers. Every new
or reworked screen follows this file, and so does every agent that builds
one. When a design tool's advice disagrees with it, this file wins. If the
tool turns out to be right, this file is changed first, in its own commit
(`UI_PLAN.md` §7.3).

The look is **style A, "Polished"**, picked from screenshots of the Tasks
page in three styles (`UI_PLAN.md` §7.2). It's adapted from Stripe's
design write-up in the awesome-design-md collection. Nizmo keeps its own
name, logo and brand colour; nothing of Stripe's brand is copied.

The names used on screen are in `UI_PLAN.md` §3.

---

## 1. What Nizmo is, and what the design is for

- **The product:** an operations and HR system for service companies,
  covering tasks for clients at places like tax offices and banks,
  attendance, costs, payroll and requests.
- **Who uses it:**
  - office Admins and Team Leaders, mostly on computers, scanning lists
    and deciding things;
  - employees, mostly on phones, checking in and moving their own tasks
    on.
- **Its job:** show what's due, let people act on it in one step, and keep
  money and status correct.

So the design is **calm, dense and exact**:

- calm: one accent colour, quiet surfaces, nothing moving on its own;
- dense: many rows on screen without feeling cramped;
- exact: numbers line up, statuses read the same way everywhere, and
  nothing depends on colour alone.

**The one bold thing is the brand colour.** It marks the main action and
where you are. Everything around it stays quiet.

---

## 2. Colour

### 2.1 Brand colour

The brand colour is a setting (`UI_PLAN.md` §4.6). The Super Admin sets the
default in System Settings, and each company can choose its own in Company
Settings → Branding. Screens never use a fixed hex for it, only the tokens
below, which are all worked out from the one chosen colour.

| Token | What it is | Used for |
|---|---|---|
| `--brand` | The chosen colour, darkened if needed until white text on it reads at 4.5:1 or better | Primary button fill, the active page in the pager, counts in the side bar, the logo tile |
| `--brand-hover` | `--brand` 8% darker | Primary button on hover |
| `--brand-press` | `--brand` 16% darker | Primary button while pressed |
| `--brand-text` | The brand as text: 4.5:1 or better on the page and on panels, in each theme | Links, the selected side bar item, selected tabs, focus rings |
| `--brand-tint` | 9% brand on the panel colour | Behind the selected side bar item and selected rows |
| `--brand-tint-strong` | 14% brand on the panel colour | Avatars with initials |

- **The default is Nizmo's own indigo, `#6366f1`.** White text on it is
  4.47:1, just under the rule, so it's used as `#6063ea` (4.70:1).
- **In dark mode:**
  - `--brand-text` is lightened until it reads at 4.5:1 or better on dark
    panels;
  - `--brand` stays the same for buttons while it stands out from a dark
    panel at 3:1 or better. The default indigo does. A very dark choice,
    such as navy, is lightened until it does, and if white text then
    reads under 4.5:1 on it, the button text switches to dark ink.
- **One filled brand button per area.** A page has one primary action. Other
  actions are secondary or quiet buttons (§5.2).

### 2.2 Neutrals

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--page` | `#f6f9fc` | `#0a1220` | The page behind everything |
| `--panel` | `#ffffff` | `#0f1a2b` | Panels, tables, cards, the side bar, the top bar |
| `--panel-raised` | `#ffffff` | `#16233a` | Menus, pop-ups, dialogs, toasts |
| `--ink` | `#0d253d` | `#e6edf5` | Main text: titles and row content |
| `--ink-2` | `#273951` | `#b8c4d4` | Secondary text in rows and forms |
| `--muted` | `#5d6b82` | `#8a9ab0` | Helper text, labels, table headers, empty states |
| `--rule` | `#e3e8ee` | `#24324a` | Lines between rows; panel edges |
| `--field-line` | `#828e9f` | `#65758d` | The edge of a field, checkbox or toggle (3:1 or better on the page and on panels) |

- Text is navy, never pure black. Dark mode is deep navy, never pure black
  either.
- `--muted` was darkened from the reference's `#64748d`, which was 4.49:1
  on the page. Now it's 5.11:1 on the page and 4.70:1 on the brand tint.

### 2.3 Status and meaning

These never follow the brand colour, because their meaning has to stay the
same in every company.

| Meaning | Statuses | Light (background / text) | Dark (background / text) |
|---|---|---|---|
| Neutral | Pending, Draft | `#ebeef1` / `#3c4257` (8.6:1) | `#26324a` / `#d0d8e4` (8.9:1) |
| In motion | In Progress | `#e0ecff` / `#0b4bb3` (6.6:1) | `#16305e` / `#a9c7ff` (7.6:1) |
| Waiting on someone | Pending Confirmation, Due | `#fcedb9` / `#7a4b0a` (6.3:1) | `#3d2c08` / `#f5cf7a` (9.0:1) |
| Done or good | Approved, Completed, Paid, Collected | `#d7f7c2` / `#05690d` (5.9:1) | `#123d1c` / `#93e3a0` (8.0:1) |
| Problem | Rejected, Overdue, errors | `#ffe7f2` / `#b3093c` (6.0:1) | `#4a1226` / `#ffa3bd` (8.0:1) |

- **Colour is never the only signal.** A status always has its word. Overdue
  always has the warning icon and the word "Overdue" too.
- **Danger text** on white is `#b3093c` (6.95:1).
- **An overdue row** gets a faint red background (`#fff8fa` in light mode,
  `#241729` in dark) and a 3px red bar on its start edge.
- **A brand colour close to the problem red** gets a warning when it's
  chosen (`UI_PLAN.md` §4.6).

---

## 3. Text

### 3.1 Fonts

- **English: Inter.** **Arabic: Noto Sans Arabic.** Both are free, and both
  are loaded by the app itself, so text looks the same on every device.
  Today no Arabic font is loaded, so Arabic text uses whatever each device
  has.
- **One font stack everywhere:** `Inter, "Noto Sans Arabic", system-ui,
  sans-serif`. An Arabic name inside an English page picks up Noto Sans
  Arabic by itself.
- **Weights:** 400 for reading, 500 for emphasis (row titles, buttons,
  selected items), and 600 only for the numbers in total tiles. Nothing
  heavier.

### 3.2 Sizes

One scale. Every size in the app is one of these.

| Token | Size / line height | Used for |
|---|---|---|
| `--text-xs` | 12 / 16px | Status badges, counts, fine print |
| `--text-sm` | 13 / 18px | Side bar group names, table headers, helper text, secondary lines |
| `--text-md` | 14 / 20px | Body text, rows, fields and buttons on computers |
| `--text-lg` | 16 / 24px | Body text, fields and buttons on phones; dialog text |
| `--text-xl` | 18 / 26px | Section and panel titles |
| `--text-2xl` | 22 / 28px | Page titles on phones; values in total tiles |
| `--text-3xl` | 28 / 34px | Page titles on computers |

- **Page titles** are weight 400, with -0.4px letter spacing in English.
  This light, slightly tight title is what gives style A its polish.
- **Arabic is never letter-spaced.** Spacing breaks the joins between
  letters. Arabic lines get a little more height: body text at 1.6 rather
  than 1.45.
- **Fields on phones use 16px text,** so phones don't zoom in when a field
  is tapped.
- **Lines of reading text stay under about 80 characters.** Forms and long
  text sit in a column no wider than 720px.

### 3.3 Numbers

- **Money, counts, dates and times in lists and tables use even-width
  digits** (`font-variant-numeric: tabular-nums`), so columns line up.
- **Arabic uses Arabic-Indic digits** (`ar-EG`), as the app does today.
  Dates and numbers are always formatted with `Intl` for the page's
  language, never built by hand.
- **Codes, phone numbers and emails stay left to right** inside Arabic
  text, using `<bdi>` or `unicode-bidi: isolate`.

### 3.4 Case and wording

- **Sentence case everywhere,** including side bar group names, table
  headers and buttons. No ALL CAPS, since Arabic has no capitals and the
  two languages should match.
- **Words follow `UI_PLAN.md` §3:**
  - one word per idea;
  - buttons start with a verb;
  - statuses are short adjectives;
  - personal pages start with "My".
- **A button says what will happen,** and the confirmation repeats it:
  "Delete client" leads to "Client deleted".
- **An error says what happened and how to fix it.** It doesn't apologise
  and isn't vague.
- **An empty screen invites the next step:** "No tasks yet", with the button
  to create one.
- **No decorative separators in text,** such as "A · B · C", "→" after a
  button label, or a label line above every heading.

---

## 4. Space, shape and depth

### 4.1 Spacing

A 4px base, and only these steps: **4, 8, 12, 16, 24, 32, 48**.

| Where | Computer | Phone |
|---|---|---|
| Page edge | 32px | 16px |
| Between sections of a page | 24px | 16px |
| Inside a panel | 16px | 12px |
| Table cell | 12px top and bottom, 16px at the sides | (cards instead) |
| Between a field's label and the field | 8px | 8px |

Component heights (buttons, fields, bars) are set in §5, not from this
scale.

### 4.2 Corners

One corner size for each level, so the level shows at a glance:

| Level | Corner |
|---|---|
| Buttons, status badges, counts, filter chips | Fully round (pill) |
| Panels, tables, cards, dialogs | 12px |
| Menus, pop-ups, toasts | 8px |
| Fields, side bar items, pager buttons | 6px |

### 4.3 Depth

| Level | Light | Used for |
|---|---|---|
| 0 | Flat | The page, rows inside a table |
| 1 | `0 1px 3px rgba(13,37,61,.08)` and a `--rule` edge | Panels and cards resting on the page |
| 2 | `0 8px 24px rgba(13,37,61,.12), 0 2px 6px rgba(13,37,61,.06)` | Menus, pop-ups, dialogs, toasts |

- **In dark mode,** shadows don't show. Depth comes from `--panel-raised` and
  the hairline edge instead.
- **No panel inside a panel.** Sections within a panel are split by
  hairlines, not by more cards with more shadows.
- **No gradients as decoration.** The logo tile is solid `--brand`.

---

## 5. Building blocks

These are built once, in the building-blocks PR, and every page uses them
(`UI_PLAN.md` §4.2). A page never re-styles them inline.

### 5.1 The app shell

- **Side bar** (computer):
  - 248px wide, on the start side (right in Arabic);
  - `--panel` background with a hairline edge;
  - groups as in `UI_PLAN.md` §2.1, each with a `--text-sm` group name in
    `--muted`;
  - a group is hidden when the person can't see anything in it;
  - the selected item has `--brand-tint` behind it, `--brand-text` text,
    and the filled version of its icon;
  - Company Settings sits at the bottom.
- **Side bar on phones:** a drawer from the start side, opened from the
  menu button. Check in sits at the top, beside Dashboard.
- **Top bar:** 60px tall (56px on phones), `--panel` background with a
  hairline below. On the end side it has the language switch, the bell and
  the account menu (`UI_PLAN.md` §2.1).
- **Page area:** `--page` background, with the page-edge spacing from
  §4.1.

### 5.2 Buttons

| Kind | Look | Used for |
|---|---|---|
| Primary | `--brand` fill, white text | The one main action in an area |
| Secondary | `--panel` fill, `--field-line` edge, `--brand-text` text | Other actions |
| Quiet | No fill or edge, `--brand-text` text | Minor actions, such as Reset filters |
| Danger | `#b3093c` fill, white text | Only the confirm button of a destructive action |

- All buttons are pill-shaped. They're 36px tall on computers (30px for
  buttons inside a table row) and 44px on phones.
- An icon is optional and goes before the label. The label is never only
  an icon, unless the button has an accessible name and a tooltip.
- **Busy and disabled states** follow the existing rules from the buttons
  work (global CSS, and `ConfirmModal` showing progress).

### 5.3 Fields and the filter bar

- **Fields:**
  - 36px tall on computers and 44px on phones;
  - 6px corners and a 1px `--field-line` edge;
  - a visible label above every field. The placeholder is never the only
    label;
  - when focused, a 2px `--brand-text` ring.
- **A text area** is a field for more than one line, at least 88px tall,
  with how many characters are left as its hint when there's a limit.
- **A choice between a few options,** such as where a deduction comes
  from, is a set of radio buttons under a visible group label, each 36px
  tall (44px on phones). An option that can't be picked says why beside
  the group.
- **The filter bar** is a panel that holds:
  - a search field, which takes the spare width;
  - the selects for that page;
  - a quiet "Reset filters" button on the end side.

  The search and the selects are the one exception to visible labels: what
  they show already names them ("Search tasks", "All statuses"), so their
  labels are kept for screen readers but not shown.
- **On phones,** the filter bar becomes the search field plus a
  "Filters" button showing how many filters are on. The button shows the
  filters below the search, and hides them again.

### 5.4 Lists: a table on computers, cards on phones

- **Table:**
  - one panel;
  - header row in `--text-sm`, `--muted`, sentence case;
  - rows separated by hairlines;
  - the first column holds the item's title in `--ink`, weight 500, with a
    secondary line below it in `--muted` and a small icon, such as the
    "Client – Location" line for tasks;
  - the status column and the action column are at the end;
  - the pager is in the panel's footer, with the count on the start side.
- **Cards on phones:**
  - the title and status badge on the first line;
  - one line for each piece of detail, each with its icon;
  - the person, the date and small chips on the last line.
- **An overdue item** gets the red start-edge bar, the warning icon, and the
  word "Overdue" beside its date.

### 5.5 The other blocks

- **Page header:**
  - the title (`--text-3xl`, or `--text-2xl` on phones);
  - an optional one-line subtitle in `--muted`;
  - the page's primary button on the end side, with at most one secondary
    button beside it. On phones, the buttons go full width below the title.
  - Until the app shell (§5.1) replaces the old top bar, the old top bar
    hides its own title on a page that has a page header, so the page is
    named once. Behind such a page, the old moving gradient gives way to
    `--page`, so text that sits on the page, such as the subtitle and
    section headings, keeps its contrast.
- **Page layout:** a page's parts are stacked with the "between sections"
  spacing from §4.1.
- **Section:** a part of a page made of several panels, such as a row of
  tiles. Its heading is `--text-xl`, weight 500, above the panels, with an
  optional quiet link on the end side, such as "View all". A part made of
  one panel uses a card's title instead.
- **Rows:** a short list inside a panel, such as the five most overdue tasks
  on the dashboard.
  - Rows are split by hairlines. Each row is a link, with the title (and an
    optional detail line in `--muted`) on the start side, and its status,
    date or count on the end side.
  - An overdue row gets the red start-edge bar and the faint red background,
    as in a table.
  - A full list, with filters and pages, uses the table (§5.4) instead.
- **Row menu:** the actions on one item that don't fit in its row, behind a
  quiet "More actions" button.
  - The pop-up is level 2 (§4.3) with 8px corners, on the end side of the
    button.
  - The arrow keys move through it, Escape closes it and returns to the
    button, and choosing an item closes it.
  - A destructive item, such as Delete, is in the danger text colour and
    is last, after a hairline. It still asks before it acts.
- **Dialog:** a level-2 panel (§4.3) on `--panel-raised`, with 12px
  corners and 24px inside (16px on phones), over the dimmed page.
  - The title is `--text-xl`, weight 500.
  - The buttons are at the bottom on the end side, the main one last. On
    phones they stack full width, the main one on top.
  - Escape closes it, and focus goes back to what opened it.
- **Selection bar:** when items in a list are picked with their
  checkboxes, a panel above the list says how many are picked and holds
  what can be done to all of them, with a quiet "Clear selection" on the
  end side. It's gone when nothing is picked.
- **Status badge:** a pill, `--text-xs`, weight 500, with the background and
  text colours from §2.3.
- **Tabs:** text tabs with a 2px `--brand` line under the selected one, and
  a hairline under the whole row. On phones, the row scrolls sideways
  within itself.
- **Total tiles:**
  - a label in `--text-sm` and `--muted`, above the value in `--text-2xl`
    and weight 600 with even-width digits;
  - an optional note under the value, in `--text-sm` and `--muted`, such
    as "This month" or "40% completed";
  - a tile can be a link to the list it counts. Its label is then in
    `--brand-text`, and the whole tile is the target;
  - up to 4 in a row on computers, 2 on phones.
- **Empty state:** a 40px icon in `--muted`, one line saying what's
  missing, and the button to add one.
- **Card:** a level-1 panel with 12px corners and 16px inside (12px on
  phones), for things that aren't lists, such as settings sections.

---

## 6. Icons

- **Phosphor Icons, regular weight,** imported one at a time
  (`UI_PLAN.md` §4.4).
- **Sizes:**
  - 18px in the side bar and in buttons;
  - 16px in fields and detail lines;
  - 20–22px in the phone top bar;
  - 40px in empty states.
- **The selected side bar item** uses the filled version of its icon.
- **Icons that point a direction are flipped in Arabic:** arrows, chevrons,
  and "back" and "next" icons. Icons that don't point (a check, a bell, a
  pin) are never flipped.
- **Icons sit beside words, not instead of them,** except in the top bar,
  where each icon button has an accessible name.

---

## 7. Arabic and right to left

- **The whole layout mirrors** through `dir="rtl"`. New code uses only
  logical properties (`margin-inline-start`, `padding-inline`,
  `inset-inline-end`, `border-inline-start`, `text-align: start`), never
  left or right.
- **Text rules** are in §3: never letter-spaced, a little more line height,
  Arabic-Indic digits, and codes kept left to right.
- **Plurals** use `Intl.PluralRules` for both languages, so the app writes
  "1 pt" and "2 pts" in English, and نقطة واحدة, نقطتان and ٣ نقاط in
  Arabic.
- **Every screen is checked in both languages** before its PR is done
  (§9).

---

## 8. Motion

- **Things move only when someone acts:** a menu opening, a sheet sliding
  in, a row being removed. Nothing animates on page load, and cards don't
  lift on hover.
- **Timings:**
  - 150ms ease-out for colour changes on hover and press;
  - 200ms for menus, sheets and dialogs opening.
- **The device's "reduce motion" setting is respected:** movement becomes an
  instant change.
- **Motion polish** comes later, with Emil Design Engineering
  (`UI_PLAN.md` §7.1).

---

## 9. The quality floor

Every UI PR meets all of these, and its screenshots show it:

- **Contrast:**
  - text at 4.5:1 or better;
  - large text, field edges, focus rings and icons that carry meaning at
    3:1 or better.
- **Keyboard:**
  - everything can be reached and used with the keyboard;
  - focus is always visible (a 2px `--brand-text` ring, offset by 2px).
- **Touch:** targets are at least 44×44px on phones.
- **No meaning from colour alone** (§2.3).
- **Layout:** nothing scrolls sideways at 360px wide, except a tab row or a
  wide table inside its own panel.
- **Both languages and both themes** are checked: English and Arabic, light
  and dark, phone and computer.
- **Checked by the tools in `UI_PLAN.md` §7.1:**
  - Vercel Web Design Guidelines audits the changed screens;
  - Playwright takes the screenshots.

---

## 10. In code

- **Tokens are CSS variables,** defined once in `app/globals.css` for light
  and for `:root[data-theme="dark"]`. Pages use tokens, never hex values.
  The line colour is `--rule`, because `--hairline` already exists with an
  older value that the pages not yet moved still use.
- **The brand tokens** (§2.1) are written into the page by the server from
  the company's or the system's colour, so the page never flashes the
  default first (`UI_PLAN.md` §4.6). Until the setting exists, they hold
  the default indigo.
- **The building blocks** live in `components/ui/`. Pages compose them and
  don't re-style them.
- **Fonts** are loaded with `next/font`, as Inter already is. Noto Sans
  Arabic is added with its Arabic subset. Outfit, the app's main font
  today, goes once no page uses it.
- **Existing colour variables** (`--primary`, `--surface`, `--text-soft`,
  `--ok-bg` and the rest) stay for the pages not yet moved. When the last
  page using one moves to the building blocks, it's removed.

---

## 11. Changed from the reference

Frontend Design's review asks for every choice to be made for this product,
not left as a template default. These parts of the Stripe write-up were
changed:

- **Labels are sentence case,** not ALL CAPS. That's needed for Arabic, and
  it reads calmer.
- **No gradient mesh and no gradient logo.** Those belong to Stripe's
  marketing pages, not to a working app.
- **Page titles are weight 400, not 300.** At 300, Inter is too thin for
  long sessions, and Noto Sans Arabic has no 300 to match.
- **The helper-text grey is darker** (`#5d6b82`), so it passes 4.5:1 on the
  page.
- **Field edges are `#828e9f`** instead of a pale blue, so fields stand out
  at 3:1 on the page and on panels.
- **"In Progress" uses a fixed blue,** not the brand colour, so statuses mean
  the same in every company.
- **No "A · B" strings.** Overdue shows as its own word with an icon.
- **One corner size for each level,** and no panels inside panels, instead
  of the same rounded card with the same shadow everywhere.

---

## Change log

- **2026-10-15:** File created. It sets:
  - the brief;
  - the colour tokens for light and dark, with checked contrast;
  - the brand colour as a setting;
  - text, space, corners and depth;
  - the building blocks, icons, Arabic, motion and the quality floor;
  - how it maps to code;
  - what was changed from the Stripe write-up.
- **2026-10-15:** The line token is renamed from `--hairline` to `--rule`.
  `--hairline` already exists with a different value (a faint 5% black)
  that 12 places in the old pages use.
- **2026-10-15:** Nizmo's indigo is used as `#6063ea` (4.70:1), not
  `#5d60e3`. The code darkens a colour in finer steps than the mock-ups did,
  so less of the chosen colour is lost.
- **2026-10-15:** The field edge is `#828e9f`, not `#8792a2`: the earlier
  value was 2.98:1 on the page, under the 3:1 the table promised. The dark
  overdue row (`#241729`) is now written down too.
- **2026-10-15:** The dark field edge is `#65758d`, not `#5b6b82`: the earlier
  value was 2.90:1 on a raised panel, where fields in dialogs sit.
- **2026-10-15:** In the filter bar, the search's and the selects' labels
  are kept for screen readers but not shown, as in the approved mock-ups:
  what they show already names them. On phones, the Filters button shows
  the filters below the search instead of opening a sheet, so each filter
  is on the page once.
- **2026-10-15:** Added, for the dashboard home, Employees and Day Off
  Requests (`UI_PLAN.md` §4.1): the page layout, sections, rows, the row
  menu, tile notes and tile links, and a second button in the page header.
  The old top bar hides its title on a page with a page header until the
  app shell replaces it. The row menu is the first menu, so the menu corner
  (8px) and level-2 shadow from §4.2 and §4.3 become tokens now.
- **2026-10-15:** Added the selection bar, for assigning several employees
  to a team at once.
- **2026-10-15:** Added the dialog, the text area and the radio choice,
  for Day Off Requests' request, approve and reject dialogs.
- **2026-10-15:** Behind a page built from the building blocks, the old
  moving gradient gives way to `--page` until the app shell lands. On the
  gradient, the subtitle in `--muted` couldn't be read.
