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
| `--brand-hover` | `--brand` 8% darker (in dark mode, see below) | Primary button on hover |
| `--brand-press` | `--brand` 16% darker (in dark mode, see below) | Primary button while pressed |
| `--brand-text` | The brand as text: 4.5:1 or better on the page, on panels and on both brand tints, in each theme | Links, the selected side bar item, selected tabs, focus rings |
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
    reads under 4.5:1 on it, the button text switches to dark ink;
  - with white text, hover and press are 4% and 8% darker, half the
    light-mode steps, and `--brand` is lightened if needed until the
    pressed shade stands out from the panel at 3:1 too. Darker is towards
    the panel, and white text and a 3:1 edge leave a narrow band of shades.
    With dark ink, hover and press are 8% and 16% towards white.
- **One filled brand button per area.** A page has one primary action. Other
  actions are secondary or quiet buttons (§5.2).
- **A colour close to the error red gets a warning when it's chosen:** one
  whose hue is within 20° of the error red's and that isn't greyish (35%
  saturation or more). It can still be saved. The status, warning and error
  colours (§2.3) never take the brand colour.
- **Who sees which colour:** a company's people see its colour, or the
  default if it hasn't chosen one. The sign-in page and the Super Admin's
  pages use the default.
- **The pages not yet in this design follow the colour too:** the older
  pages, the side bar and the sign-in page (`UI_PLAN.md` §4.6). They keep
  their own look, which is drawn in Nizmo's indigo with a violet beside it:
  - each of those shades keeps the distance it has from Nizmo's indigo,
    measured from the chosen colour instead. That's the same turn of hue,
    the same share of colourfulness and the same step lighter or darker,
    as the eye sees them (OKLCH). Pale shades keep their own lightness, so
    the page's ground stays pale and light text on dark stays light;
  - so Nizmo's indigo gives exactly the colours these pages have today,
    and another colour gives the same family in its own hue: teal beside a
    blue-teal, orange beside amber;
  - each shade then keeps the readability it has today against each thing
    it's drawn on or under. It's never asked for more than WCAG's 4.5:1
    for text or 3:1 for a shape:
    - white text on a fill reads as well as it does with Nizmo's indigo,
      at rest and when a button brightens on hover;
    - in dark mode, a fill stands out from the dark page as well as it
      does now;
    - text reads as well on each ground it's drawn on as it does now,
      including the light brand tints behind it. A highlight colour that
      is also a link's colour is held as text;
    - a focus ring, a highlight bar or the map pin stands out as well as
      it does now, and so does the end of the company name's gradient in
      the side bar.

    A shade that falls short is darkened (on a dark ground, lightened)
    until it doesn't, keeping its hue;
  - the check-in place's radius ring on the map has a thin white outline,
    as its pin does, so it shows over satellite imagery as well as the
    light street map, whatever the colour;
  - the company name at the top of the side bar runs from white to a pale
    shade of the brand, in both themes, since the side bar is dark in
    both. It used to start from the page's panel colour, so in dark mode
    it began dark on the dark side bar and was barely readable;
  - the info colours, the role badges' colours, the pink glow and the
    dark mesh behind the page don't follow. Like the status
    colours (§2.3), they mean something, or are only background.

  This lasts until each page moves onto the building blocks, which use the
  tokens above.

### 2.2 Neutrals

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--page` | `#f6f9fc` | `#0a1220` | The page behind everything |
| `--panel` | `#ffffff` | `#0f1a2b` | Panels, tables, cards, the side bar; the top bar where the browser can't blur (§5.1) |
| `--panel-raised` | `#ffffff` | `#16233a` | Menus, pop-ups, dialogs, toasts |
| `--ink` | `#0d253d` | `#e6edf5` | Main text: titles and row content |
| `--ink-2` | `#273951` | `#b8c4d4` | Secondary text in rows and forms |
| `--muted` | `#5d6b82` | `#8a9ab0` | Helper text, labels, table headers, empty states |
| `--rule` | `#e3e8ee` | `#24324a` | Lines between rows; panel edges |
| `--field-line` | `#828e9f` | `#65758d` | The edge of a field, checkbox or toggle (3:1 or better on the page and on panels) |
| `--header-glass-bg` | `rgba(255, 255, 255, 0.82)` | `rgba(13, 17, 23, 0.88)` | The top bar's glass, once the page scrolls (§5.1) |
| `--header-glass-border` | `rgba(255, 255, 255, 0.45)` | `rgba(255, 255, 255, 0.1)` | The glass top bar's hairline edge |
| `--header-shadow` | `0 4px 30px rgba(0, 0, 0, 0.05)` | `0 4px 30px rgba(0, 0, 0, 0.45)` | The glass top bar's shadow |

- Text is navy, never pure black. Dark mode is deep navy, never pure black
  either.
- `--muted` was darkened from the reference's `#64748d`, which was 4.49:1
  on the page. Now it's 5.11:1 on the page and 4.70:1 on the brand tint.
- The top bar's three glass tokens are the ones the app has today, kept
  with its glass (§5.1).

### 2.3 Status and meaning

These never follow the brand colour, because their meaning has to stay the
same in every company.

| Meaning | Statuses | Light (background / text) | Dark (background / text) |
|---|---|---|---|
| Neutral | Pending, Draft | `#ebeef1` / `#3c4257` (8.6:1) | `#26324a` / `#d0d8e4` (8.9:1) |
| In motion | In Progress | `#e0ecff` / `#0b4bb3` (6.6:1) | `#16305e` / `#a9c7ff` (7.6:1) |
| Waiting on someone | Pending Confirmation, Due, Expires soon | `#fcedb9` / `#7a4b0a` (6.3:1) | `#3d2c08` / `#f5cf7a` (9.0:1) |
| Done or good | Approved, Completed, Paid, Collected | `#d7f7c2` / `#05690d` (5.9:1) | `#123d1c` / `#93e3a0` (8.0:1) |
| Problem | Rejected, Overdue, Expired, errors | `#ffe7f2` / `#b3093c` (6.0:1) | `#4a1226` / `#ffa3bd` (8.0:1) |

- **Colour is never the only signal.** A status always has its word. Overdue
  always has the warning icon and the word "Overdue" too.
- **Chart colours** are for the shapes in a chart, such as a donut's parts,
  never for text. The text colours above are deep, for reading, and look
  heavy as large shapes, so charts take a mid-tone of each meaning. Each
  stands out from a panel at 3:1 or better.

  | Meaning | Light | Dark |
  |---|---|---|
  | Neutral | `--chart-neutral` `#64748b` (4.8:1) | `#94a3b8` (6.8:1) |
  | In motion | `--chart-progress` `#2563eb` (5.2:1) | `#60a5fa` (6.9:1) |
  | Waiting on someone | `--chart-waiting` `#d97706` (3.2:1) | `#fbbf24` (10.5:1) |
  | Done or good | `--chart-good` `#059669` (3.8:1) | `#34d399` (9.1:1) |
  | Problem | `--chart-problem` `#e11d48` (4.7:1) | `#fb7185` (6.5:1) |
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
  text, using `<bdi>`, or `unicode-bidi: isolate` together with
  `direction: ltr`. `unicode-bidi: isolate` alone keeps the page's right to
  left direction, which turns "08:30–17:00" into "17:00–08:30".

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
| The top bar, floating once the page scrolls (§5.1) | 24px |

### 4.3 Depth

| Level | Light | Used for |
|---|---|---|
| 0 | Flat | The page, rows inside a table |
| 1 | `0 1px 3px rgba(13,37,61,.08)` and a `--rule` edge | Panels and cards resting on the page |
| 2 | `0 8px 24px rgba(13,37,61,.12), 0 2px 6px rgba(13,37,61,.06)` | Menus, pop-ups, dialogs, toasts |

- **In dark mode,** shadows don't show. Depth comes from `--panel-raised` and
  the hairline edge instead. The one exception is the glass top bar
  (§5.1), kept as it is today: its dark `--header-shadow` is deep enough
  to show, and with its hairline edge it sets the bar off from the page
  scrolling under it.
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
- **Top bar:** 60px tall (56px on phones). On the end side it has the
  language switch, the bell and the account menu (`UI_PLAN.md` §2.1). It
  stays at the top as the page scrolls, and is kept as it is today
  (decided by the product owner):
  - at the top of the page it has no background of its own, and sits on
    the page;
  - once the page scrolls (past 10px), it floats as a pane of glass: 16px
    in from the page's edges, with 24px corners, a see-through
    `--header-glass-bg` with a 20px blur and 160% saturation behind it, a
    hairline `--header-glass-border` edge and `--header-shadow`. The page
    scrolling under it shows through, blurred;
  - the bar takes the same room in both: the inset, corners, glass, edge
    and shadow are drawn on a layer inside it, so the page under it never
    moves as it floats or settles. Today's bar grows its own margins
    instead, which moves the page 32px at 10px of scroll; the rebuilt app
    shell keeps the look and not that;
  - text and icons on the bar are `--ink` or `--ink-2`, never `--muted`.
    Whatever scrolls under it, a dark map say, the glass is at its darkest
    `#d1d1d1` in light mode and its lightest `#2a2e33` in dark mode, and
    `--muted` reads only 3.5:1 on the first; `--ink-2` reads 7.7:1 on both;
  - it eases between the two over 300ms, changing only its background,
    blur (`backdrop-filter` and `-webkit-backdrop-filter`), edge, shadow,
    inset and corners, so the blur comes in with the rest rather than at
    once. With "reduce motion" on, it changes at once;
  - where the browser can't blur, supporting neither `backdrop-filter`
    nor `-webkit-backdrop-filter` (`@supports not`), it floats on solid
    `--panel` instead, with the same edge and shadow. Without the blur the
    glass is see-through, and its helper text, over a dark page, could
    fall below 4.5:1.
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
  - when focused, a 2px `--brand-text` ring;
  - when it can't be changed, it's on `--page`, with a `--rule` edge and
    `--ink-2` text, and its hint says why.
- **A text area** is a field for more than one line, at least 88px tall,
  with how many characters are left as its hint when there's a limit.
- **A choice between a few options,** such as where a deduction comes
  from, is a set of radio buttons under a visible group label, each 36px
  tall (44px on phones). An option that can't be picked says why beside
  the group.
- **A colour choice,** such as the brand colour (§2.1):
  - a row of round swatches, 32px across (44px to tap on phones), each a
    radio button named by its colour for screen readers, with a 2px ring
    around the chosen one;
  - where there's a default to go back to, "Use the default" comes first;
  - below the swatches, a field for a colour code (`#rrggbb`), which says
    what's wrong with one that isn't a colour;
  - a preview of a primary button, a link and a selected tab in the
    colour, in light and dark, before it's saved.
- **A place on the map,** such as a location's pin (`CLIENTS_PLAN.md`
  §2.5), is a group of fields under its label:
  - a place search, which drops the pin on the place picked, and gives it
    a name if it has none yet;
  - the pin as coordinates (`30.0444, 31.2357`), which can be pasted from
    Google Maps, with "Use my current location" and "Pick on the map"
    below it as secondary buttons. The map shows the pin, which can be
    dragged, and the check radius as a circle around it;
  - the check radius in metres, below, with the default it takes when
    left empty as its hint.

  It's the same map as the check-in places (Company Settings), so a pin
  is placed the same way everywhere.
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
  - a table wider than its panel scrolls sideways inside it, and the
    panel keeps its rounded corners, so the end columns are never cut off;
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
  - On a page that belongs to another, such as a client's page under
    Clients, a quiet back link sits above the title: a back arrow, flipped
    in Arabic, and the other page's name.
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
- **Donut chart:** a ring for how a whole splits into a few parts, such as
  tasks by status or day off credit used and left.
  - The ring is 160px across and thin, a tenth of that. Its parts have
    rounded ends and a clear gap between them, with nothing drawn behind,
    and one part alone fills the ring.
  - Each part takes its meaning's chart colour (§2.3). A later part with
    the same meaning as an earlier one, such as Completed after Approved,
    takes a deeper shade of it (mixed 35% towards `--ink`), so the two read
    as two.
  - The total is in the middle in `--text-3xl`, weight 600, with even-width
    digits, and its label below in `--text-sm` and `--muted`. A total of
    more than five characters, such as "12 days", is in `--text-xl`, so it
    stays clear of the ring.
  - Beside the ring (below it on phones) is the legend. Each row has the
    part's colour mark (a 10px square with 3px corners), its word, its
    count, and its share of the total in `--muted`. The counts and shares
    line up in columns. The legend is at most 28rem wide, so on a wide page
    a count stays near its word. Screen readers read the legend, and the ring is
    hidden from them. A legend row can link to what it counts.
  - Pointing at a legend row, or moving focus to it, fades the ring's other
    parts, so the row and its part are seen together. The fade takes
    150ms and nothing moves; with reduced motion it's instant.
  - With nothing to count, the ring is a faint track, the middle says 0,
    and the legend says there's nothing yet.
  - While the numbers load, the legend says so. If they don't load, it
    says that instead, with a Try again button below. Either way the middle
    is blank, since a 0 there would read as the answer.
- **Details:** an item's facts on its own page, such as a client's owner
  and phone, in a card. Each is a label in `--text-sm` and `--muted` above
  its value, up to 3 in a row on computers and 1 on phones. A phone number
  is a link that calls it. A link that opens a new tab, such as a map, says
  so to screen readers.
- **Files:**
  - adding files is a secondary "Attach files" button that opens the file
    picker. On computers, files can also be dropped on it. The hint says
    which kinds and how large they may be;
  - each file, picked or saved, is a chip with a file icon, its name and
    its size. A saved file's chip opens it in a new tab, and says so to
    screen readers. A chip's remove button is named for its file.
- **Expiry:** an item with an expiry date, such as a record, shows the date
  with a badge beside it:
  - "Expired" (Problem, with the warning icon) once the day has passed;
  - "Expires soon" (Waiting on someone) from 30 days before, up to and
    including the day itself;
  - nothing when it's further off, or has no date.

  An "Expiring soon" filter finds exactly the items with that badge.
- **An item opened from a list:** where a list cuts an item's text short,
  such as a record's text cut to 2 lines, the item's title opens it in a
  dialog. The dialog shows all of it, with the actions the person may take
  on it.
- **Empty state:** a 40px icon in `--muted`, one line saying what's
  missing, and the button to add one.
- **A list that didn't load** says so in the same block: a warning icon,
  one line saying what didn't load, and Try again, which shows it's busy
  while it tries. It never says there's nothing, or offers to add one, when
  it doesn't know.
  - Before saying so, it tries again by itself, three times: half a
    second, one second and two seconds apart, still showing that it's
    loading. So a moment's trouble with the connection or the server
    doesn't reach the screen.
  - Only a failure that can pass is tried again: no answer at all, the
    server's own error, or the server too busy. A refusal or "not found"
    is the answer, and is said at once.
  - The same goes for anything else a screen loads: a picker's options, a
    form's details, a card's numbers, a preview. Whatever it shows when it
    fails, a message, a Try again or a picker left empty, comes only after
    the three tries.
  - Only loading is tried again. A save is sent once: sent again, it
    might be done twice.
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
- **Text people type** keeps its own direction, whichever language the
  page is in: a record's text, a section's or a client's name. It's set
  with `dir="auto"` or `<bdi>`, so an English sentence in an Arabic page
  keeps its full stop at its end, and an Arabic name in an English page
  reads right to left.
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
- **2026-10-15:** Added the donut chart. The product owner prefers the
  dashboard home's donuts to rows of counts, so they come back, drawn from
  the meaning colours and with a legend that carries every word and count.
- **2026-10-15:** Behind a page built from the building blocks, the old
  moving gradient gives way to `--page` until the app shell lands. On the
  gradient, the subtitle in `--muted` couldn't be read.
- **2026-10-15:** A table wider than its panel scrolls sideways inside it
  (§5.4), as §8's layout rule already allowed. It was clipped, which cut off
  the action column between phone width and a wide screen.
- **2026-10-15:** In dark mode, a primary button's hover and pressed shades
  stand out from the panel at 3:1, as the button does (§2.1). They were 8%
  and 16% darker, towards the panel, so the default indigo's pressed shade
  was 2.82:1 and navy's 2.37:1. With white text they're now 4% and 8%
  darker, and the fill is lightened if needed.
- **2026-10-15:** The donut chart is redrawn, as the product owner found it
  old-fashioned. The ring is thinner, with rounded, separated parts in new
  mid-tone chart colours (§2.3), since the deep text colours looked heavy as
  shapes. The legend adds each part's share. Pointing at a legend row
  picks out its part.
- **2026-10-15:** From Codex's review of #76: `--brand-text` reads at
  4.5:1 on both brand tints too, which the derivation already checked
  (§2.1); and `unicode-bidi: isolate` needs `direction: ltr` for an
  identifier, or a time range reads backwards in Arabic (§3.3). Its other
  two findings, the field edge and the dark-mode hover and press, were
  already fixed.
- **2026-10-15:** The donut's legend is at most 28rem wide (§5.5), for the
  Day Off page's credit donut, which spans the page.
- **2026-10-16:** From Codex's review of #79: a donut whose numbers don't
  load says so and offers Try again (§5.5), with nothing in the middle. The
  Day Off page's credit donut said "Loading…" for good when its request
  failed, over a total of 0 days.
- **2026-10-16:** A list that didn't load says so, with Try again (§5.5),
  at the product owner's request. Employees said "No employees found" and
  offered to add one.
- **2026-10-16:** The brand colour setting (§2.1, `UI_PLAN.md` §4.6): the
  colour choice field (§5.3), the warning for a colour close to the error
  red, and who sees which colour.
- **2026-10-16:** At the product owner's choice, the older pages, the side
  bar and the sign-in page follow the brand colour too (§2.1): each of
  their indigo and violet shades keeps its distance from Nizmo's indigo,
  measured from the chosen colour, and keeps the readability it has today.
  Nizmo's indigo gives exactly the colours they have now.
- **2026-10-16:** From Codex's review of #81 (§2.1): the older pages'
  shades are held to today's readability in five more places. These are
  white text on a button brightened on hover, a fill against the dark page,
  text on the light brand tints, a highlight colour that is also a link,
  and the company name's gradient in the side bar.
- **2026-10-16:** At the product owner's choice, the company name at the
  top of the side bar runs from white to a pale shade of the brand in both
  themes (§2.1). In dark mode it used to run from the dark panel colour to
  a dark indigo, on the dark side bar, and was barely readable.
- **2026-10-16:** From Codex's review of #81: the check-in place's radius
  ring on the map has a thin white outline, as its pin does (§2.1). The map
  can show satellite imagery, where a dark colour's ring disappeared.
- **2026-10-16:** For records moving onto each client's page
  (`CLIENTS_PLAN.md` §0.2): a back link above a page's title, details,
  files, a record's expiry with its two statuses, and opening an item from
  a list (§5.5, §2.3).
- **2026-10-16:** Text people type keeps its own direction in either
  language (§7). In the first Arabic check of records, an English record's
  full stop moved to its start.
- **2026-10-22:** A list or page that didn't load tries again by itself
  three times before saying so (§5.5), at the product owner's request. A
  refusal or "not found" is said at once.
- **2026-10-22:** So does anything else a screen loads (§5.5), at the
  product owner's request. A save is never sent again.
- **2026-10-22:** The top bar keeps its glass, as the product owner asked
  (§5.1): flat at the top of the page, and once it scrolls, a floating
  pane of glass with a blur behind it, 24px corners (§4.2) and a shadow,
  easing in over 300ms. It replaces the flat `--panel` bar the app shell
  was to have.
- **2026-10-23:** From Codex's review of #85: the top bar's glass tokens
  are in the neutrals table (§2.2), and `--panel` no longer names the top
  bar; where the browser can't blur, the bar is solid `--panel`, as the
  glass alone could leave helper text below 4.5:1; its blur eases in
  with the rest (§5.1); its dark shadow is the one exception to dark
  mode's depth without shadows (§4.3); its text is `--ink` or `--ink-2`,
  never `--muted`, which a dark backdrop under the glass can bring below
  4.5:1; and it takes the same room floating or not, so the page doesn't
  move.
- **2026-10-22:** A place on the map (§5.3), for the locations tasks happen
  at (`CLIENTS_PLAN.md` §2): a place search, the pin with "Use my current
  location" and "Pick on the map", and the check radius.
