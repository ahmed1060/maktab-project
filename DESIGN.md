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

- **Side bar** (computer), as the mock-up of the app's frame approved by
  the product owner on 2026-11-05 draws it:
  - 248px wide, on the start side (right in Arabic), the window's full
    height, staying put as the page scrolls;
  - `--panel` background with a hairline `--rule` edge, in both themes. It
    was dark slate in both;
  - at its top, the company's mark and name. The mark is 32px across, with
    `--radius-menu` corners: the company's logo on its light plate
    (`--logo-plate`), which keeps a dark logo readable in dark mode, or
    else the first letter of its name in `--on-brand` on a `--brand` tile.
    The name is beside it in `--ink` at `--text-lg` and weight 500, on two
    lines at most. The Super Admin, looking at no one company, sees
    Nizmo's;
  - groups as in `UI_PLAN.md` §2.1, each with a `--text-sm` group name in
    `--muted`;
  - a group is hidden when the person can't see anything in it;
  - a module the company's package doesn't include isn't in it, for anyone
    in the company. Its pages, opened by their address, say they can't be
    opened, and why (§5.5, A page someone can't open);
  - an item is 36px tall, with `--radius-field` corners, its icon (§6) and
    its name in `--ink-2` at `--text-md`, and `--brand-tint` behind it
    under the pointer;
  - the selected item has `--brand-tint` behind it, `--brand-text` text at
    weight 500, and the filled version of its icon;
  - Requests carries how many wait on this person under its To review tab
    (`UI_PLAN.md` §2.3), the list the page opens on: a `--brand` pill at
    the item's end, 20px tall, its `--text-xs` digits in `--on-brand` and in
    the page's language, and nothing when none waits. A screen reader hears
    it with the item, as "Requests, 3 requests to review". It's asked again
    on every page, when the person comes back to the window, and once
    something is decided on the Requests page. It replaces the top bar's
    count of name changes alone, whose button is gone;
  - a company that chose its own icon for a module, an emoji, sees it in
    place of the module's icon, until companies choose theirs from the
    side bar's own icons, a later step;
  - Company settings, Roles and access and Saved lists sit at the bottom,
    under a hairline, and stay there while the groups above them scroll,
    as the Super Admin's do;
  - under them, the privacy policy and the terms of service, as `--muted`
    links at `--text-xs`, side by side;
  - it doesn't fold down to its icons. The old side bar folded to 80px
    when its name was clicked, which nothing on the screen said and a
    keyboard couldn't do.
- **Side bar on phones** (narrower than 1024px): a drawer from the start
  side, opened from the menu button:
  - 296px wide, or the window's width less 48px where that's narrower, so
    the page shows beside it;
  - its items are 44px tall, with `--text-lg` names and 20px icons, and its
    legal links are 44px tall too (§9);
  - at its top, the company's mark and name, and a button that closes it;
  - it's a dialog over the dimmed page (`--scrim`): focus moves into it and
    stays there, and goes back to the menu button when it closes. Escape,
    that button, a tap on the page beside it, or picking a page closes it;
  - closed, it isn't drawn, so neither Tab nor a screen reader goes
    through its links. The old drawer only slid out of sight, and Tab went
    through every one of them;
  - it slides in and out over 200ms (§8);
  - Check in sits at the top, beside Dashboard.
- **The "Powered by" signature** stays as it is (decided by the product
  owner on 2026-11-05): on a computer in the page's bottom corner on the
  end side, on a phone at the end of the page, and with the same look. It
  isn't in the side bar.
- **Top bar:** 60px tall (56px on phones), as the approved mock-up of the
  app's frame draws it. It has no title: every page names itself in its
  page header (§5.5). On the end side it has the language switch, the bell
  and the account button (`UI_PLAN.md` §2.1). On a phone, the menu button
  and the company's mark, 28px across, are at its start:
  - its buttons are round and 44px across, with no fill until hovered,
    when they have `--brand-tint`, and `--ink-2` icons: 20px on a
    computer, 22px on a phone (§6);
  - **the language switch:** both languages, each written in itself,
    "English" and "العربية", in a pill with a `--rule` edge on `--panel`,
    the one in use in `--brand-text` on `--brand-tint`. English stays
    first in Arabic too: the switch is about language, not in one. It's
    named "Language" for screen readers, and each option says whether
    it's in use. Picking the other switches the app to it, as today. On a
    phone the options are "EN" and "ع", still named in full;
  - **the bell** is named "Notifications", and "Notifications, 2 unread"
    while some are. How many is a `--brand` pill at its top end corner,
    18px tall, its `--text-xs` digits in `--on-brand` and in the page's
    language, as the side bar's count is, and there's none when none is
    unread. The panel it opens is unchanged until its own part;
  - **the account button:** the person's photo in a 32px circle, or their
    initials in an avatar's colours (§5.5), never a drawing that stands in
    for them; their name in `--ink` and their role in `--ink-2`, under
    it, in the words the app uses for roles; and a caret. On a phone, the
    photo or initials alone. Either way it's named "Account menu, Karim
    Nabil, Employee" («قائمة الحساب، كريم نبيل، موظف»), and says whether
    its menu is open;
  - **the account menu,** below the button on the end side: 300px wide,
    on `--panel-raised` with a `--rule` edge, `--radius-menu` corners and
    `--elev-2`. At its top are the photo or initials, 40px across, the
    name, and the role with the company, "Admin at Nile Works", or the
    role alone for the Super Admin. Then, between hairlines, My profile,
    Security settings and History, the theme switch (Light and Dark,
    drawn as the language switch is), and Sign out, each 40px tall with
    its icon. History is there where the package includes Payroll, for
    anyone but an Admin or the Super Admin, as today. It isn't a dialog:
    Tab moves through its links and buttons, and Escape, a click outside
    it, following one of its links, or Tab past its last control closes
    it. Switching the theme doesn't, so the change can be seen. Escape
    gives focus back to the button;
  - **the company picker,** the Super Admin's, at its start, as the
    mock-up has it: a pill 44px tall on `--panel`, with an edge of the
    brand colour at a third, and the company in view's initials on a 32px
    tile with 8px corners, in `--brand-text` on `--brand-tint-strong`, or
    the buildings icon for All companies. Then "Company in view" in
    `--ink-2` at `--text-xs`, over the company's name in `--ink`, and a
    caret. On a phone, the tile alone. Either way it's named "Company in
    view: Nile Works", says that it opens a list, and whether it's open;
  - **its panel,** below the bar from the picker's start edge: 320px
    wide, on `--panel-raised` with a `--rule` edge, `--radius-menu`
    corners and `--elev-2`. On a phone it spans the bar, 8px in from its
    edges. At its top, "Find a company", in `--muted`, over a search
    field with "Name of a company…" in it. Then All companies and every
    company, each on a 40px row with its 28px tile (initials in
    `--status-neutral-fg` on `--status-neutral-bg`). The one in view is
    in `--brand-text` on `--brand-tint`, its tile as the picker's, with a
    check at its end, and a screen reader hears it as the current one. The
    list shows 8 rows, fewer on a short screen, and scrolls past that:
    - typing keeps the companies whose names have what's typed in them,
      capitals or not, without All companies, and the first is the one
      Enter picks. When none has, the list says "No company has that
      name";
    - it opens with the focus in the search field, which keeps it: the up
      and down arrows move through the list from there, Home and End stay
      in what's typed, and Enter picks. The row they're on has the menu's
      focus look, `--brand-tint` with a 2px `--brand-text` ring inside
      it, while the focus is in the panel, and the pointer moves it too.
      Picking one puts it in view, as today;
    - a tap on a touch screen opens it without the keyboard, the search
      field there to tap, as a phone's keyboard would cover the list;
    - Escape, a click outside it, or Tab out of it closes it. Escape and
      a pick give the focus back to the picker.

  It stays at the top as the page scrolls, and is kept as it is today
  (decided by the product owner):
  - at the top of the page it has no background of its own, and sits on
    the page;
  - once the page scrolls (past 10px), it floats as a pane of glass: 16px
    in from the page's edges (8px on a phone, where its buttons are
    already 8px from the screen's edges, so they stay where they are, as
    they do on a computer), with 24px corners, a see-through
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
    inset, padding and corners, so the blur comes in with the rest rather
    than at once, and the inset and padding, together, keep what's in it
    where it was. With "reduce motion" on, it changes at once;
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
  buttons inside a table row) and 44px on phones. The one exception is the
  check-in page's Check in and Check out, 56px with `--text-lg` (§5.5,
  Check-in).
- An icon is optional and goes before the label. The label is never only
  an icon, unless the button has an accessible name and a tooltip.
- **Busy and disabled states** follow the existing rules from the buttons
  work (global CSS, and a confirmation showing its work under way, §5.5,
  Dialog).

### 5.3 Fields and the filter bar

- **Fields:**
  - 36px tall on computers and 44px on phones;
  - 6px corners and a 1px `--field-line` edge;
  - a visible label above every field. The placeholder is never the only
    label;
  - when focused, a 2px `--brand-text` ring;
  - when it can't be changed, it's on `--page`, with a `--rule` edge and
    `--ink-2` text, and its hint says why.
- **A change that goes for approval,** such as a role asked for by someone
  who may not give it, says so in its field's hint once it's changed.
  While one waits, the field can't be changed, and its hint is the change
  waiting, linked to the request.
- **A password** is a field with a button at its end that shows what's
  typed, and hides it again. The button shows only an eye, so it's named
  for which it will do ("Show password") and says so on hover (§5.2).
  Creating one, its hint says how long it must be.
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
- **A pick from a list that can grow,** such as a task's location
  (`CLIENTS_PLAN.md` §2.3, §2.4), is a select with what can be added to
  it beside it:
  - the options in groups under their own headings, such as a client's
    locations, its HQ first and marked "HQ", then the shared ones;
  - an option that can't be picked yet stays in the list, greyed, with
    why after its name ("needs a pin"), so it isn't searched for in vain;
  - "+ New location" as a quiet button below the select, never an option
    inside it: an option that opens a form isn't what a select does. It
    opens the form in a dialog, and what's added there is picked when it
    closes.
- **A name typed or picked from a saved list,** such as a task's title or
  a cost's name (`CLIENTS_PLAN.md` §5), is a text field that suggests as
  it's typed:
  - below it, up to eight of the list's names that contain what's typed,
    the part typed in bold; nothing is shown until something is typed,
    and nothing archived;
  - what's typed can be kept as it is: it's saved as typed, with no name
    picked. Picking a suggestion fills the field with it;
  - when what's typed isn't on the list, ignoring capitals, the last line
    offers "+ Add 'X' to the list" to whoever may add names. Nothing is
    added any other way;
  - the arrow keys move through the suggestions, Enter picks one, Escape
    closes them. Each suggestion is 36px tall (44px on phones), and the
    one under the keys is shaded;
  - the field says which name it's linked to only by the suggestion
    picked: typing again unlinks it.
- **A pick of several from a long list,** such as a task's assignees, is
  a group under its visible label:
  - a search field, which narrows the list as it's typed;
  - below it, the list as checkboxes in a box that scrolls within itself,
    240px tall, each 36px (44px on phones), with what tells two apart,
    such as a person's role, on the end side;
  - its error below the box, as a field's is.
- **A form on a page of its own,** such as Create task, is one panel: its
  fields one under the other, at most 640px wide, then its buttons, the
  one primary button first. Submitting with something wrong shows each
  error under its field and puts the focus on the first one, below the
  sticky header, never under it.
- **The filter bar** is a panel that holds:
  - a search field, which takes the spare width;
  - the selects for that page;
  - a quiet "Reset filters" button on the end side.

  The search and the selects are the one exception to visible labels: what
  they show already names them ("Search tasks", "All statuses"), so their
  labels are kept for screen readers but not shown.
- **A list with one filter and no search,** such as role change requests
  by status, has its select in its card's head, on the end side. Its
  label is kept for screen readers and not shown, as in the filter bar.
- **On phones,** the filter bar becomes the search field plus a
  "Filters" button showing how many filters are on. The button shows the
  filters below the search, and hides them again.
- **Which period a page is about,** such as the month on Payroll, is
  chosen in a panel straight under the page header:
  - a select for the month and one for the year, each with its visible
    label, the month and year names in the page's language;
  - the page's address keeps the period picked (`?year=2026&month=10`),
    so a reload or a link opens on it. With none, it opens on this month;
  - the Super Admin's company is the company in view, picked in the top
    bar as on every other page. The page has no company select of its
    own, and until a company is picked it says to pick one.

  It isn't a filter bar: it doesn't narrow a list, it picks what the whole
  page shows. So it's never folded away. On phones the selects share the
  row, two to a line.

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
  - The top bar has no title (§5.1), so a page is named once, by its page
    header. Behind a page with one, the old moving gradient gives way to
    `--page`, so text that sits on the page, such as the subtitle and
    section headings, keeps its contrast.
- **Page layout:** a page's parts are stacked with the "between sections"
  spacing from §4.1.
  - A part that belongs to a module the company's package doesn't include
    isn't there, for anyone in the company, as the module isn't in the
    side bar (§5.1): a tile, a section, a field or a link to it, such as a
    person's pay on their profile where the package hasn't Payroll. The
    rest closes up, and a section left with nothing in it goes too.
- **Section:** a part of a page made of several panels, such as a row of
  tiles. Its heading is `--text-xl`, weight 500, above the panels, with an
  optional quiet link on the end side, such as "View all". A part made of
  one panel uses a card's title instead.
- **Rows:** a short list inside a panel, such as the five most overdue tasks
  on the dashboard.
  - Rows are split by hairlines. Each row is a link, with the title (and an
    optional detail line in `--muted`) on the start side, and its status,
    date or count on the end side.
  - A row may carry a note under its detail line, such as what a template
    is for, in the detail's size and colour, or a note a line, such as a
    request and its response.
  - The row you came to see, such as the one a notification opened, has
    `--brand-tint` behind it, as a table's does.
  - An overdue row gets the red start-edge bar and the faint red background,
    as in a table.
  - A full list, with filters and pages, uses the table (§5.4) instead.
  - **A row that opens** shows its item's lines under it, such as a
    person's pay on Payroll, line by line. Its title and detail are the
    button that opens it, with a caret after the title that turns while
    it's open, and screen readers hear whether it is. The row's own links,
    such as the person's payslip, sit at its end, beside the button and
    never inside it. Its lines are indented, in `--text-sm` and `--muted`,
    each with its amount at the end.
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
    phones they stack full width, the main one on top. A button that
    doesn't fit on one line, such as one that says a count and an amount,
    takes two.
  - Escape closes it, and focus goes back to what opened it.
  - One that holds a long list of controls, such as a role's permissions,
    is up to 640px wide, so each control sits beside what it's for.
  - One that opens from an older page's modal, as "+ New location" from a
    task's edit window, sits above that modal, and under the toasts.
  - The code a high-risk action asks for (two-factor sign-in) sits above
    every other dialog: the confirmation that sent the action, such as
    "Pay 7 costs, 3,450 EGP", stays open until the code is answered.
  - One that asks for the viewer's own password before an action, such as
    resetting someone else's, is a form: the password field, with what's
    wrong said under it, such as a password that doesn't match, then
    Cancel and Confirm. While the password is checked, Cancel is off and
    Confirm is busy. What was typed is never kept: each time it opens, the
    field is empty.
  - A code or a password shown once, such as an attendance agent's code
    or a temporary password, is large, left to right and never translated,
    and chosen whole with one click to copy, with a line saying it won't
    be shown again. A longer one, such as a password, is a size smaller,
    so it stays on one line on a phone. Done closes it, and then it's
    gone.
  - One that can't be undone, such as restoring a backup, asks for a word
    typed first, such as RESTORE: the word is shown as the code has it,
    left to right and never translated, in both languages, and the main
    button stays off until it's typed as shown. Enter is the main button
    once it is.
  - A confirmation asks before an action: what it does, in a sentence or
    two, then Cancel and the button that does it, which says what it does
    as the action's own button does, such as "Delete record". The button
    is in the danger colour only when the action deletes something or
    can't be undone. Once confirmed, it stays open until the work is done:
    Cancel is off, the main button is busy, and Escape or a click outside
    does nothing, since what was sent can't be called off.
  - One that records money owed, such as ending a contract, shows what
    it would record before it does: the statement's own lines, totals and
    notes (Document, below), under a heading of its own, as the statement
    will have them. While it's worked out for what's picked, such as the
    last working day, it says so, the last figures staying until the next
    are in, and the main button waits for its own: the figure confirmed is
    the figure recorded. Screen readers hear the figures once they're in.
    One that didn't load says so, with Try again.
  - One that asks who takes over, such as a leader's team when they stop
    leading it, names whom it's about, each in a list, then who takes
    them, with no one among the choices. Answered, it stays open until the
    change is sent, as a confirmation does, and why the one picked can't
    take them is said under the choice.
- **Selection bar:** when items in a list are picked with their
  checkboxes, a panel above the list says how many are picked and holds
  what can be done to all of them, with a quiet "Clear selection" on the
  end side. It's gone when nothing is picked.
- **Status badge:** a pill, `--text-xs`, weight 500, with the background and
  text colours from §2.3.
- **Tabs:** text tabs with a 2px `--brand` line under the selected one, and
  a hairline under the whole row. On phones, the tabs share the row, a
  long label on two lines, so every tab shows; a row of more than fit
  scrolls sideways within itself. A tab can say how many it holds, such as the
  companies that need attention: a pill after its label in `--text-xs`,
  in the neutral badge's colours, and the brand tint's when it's the
  selected tab.
- **Total tiles:**
  - a label in `--text-sm` and `--muted`, above the value in `--text-2xl`
    and weight 600 with even-width digits;
  - an optional note under the value, in `--text-sm` and `--muted`, such
    as "This month" or "40% completed";
  - a tile can be a link to the list it counts. Its label is then in
    `--brand-text`, and the whole tile is the target;
  - up to 4 in a row on computers, 2 on phones while their values fit
    half the row. A value is never broken, an amount from its currency
    least of all: a tile whose value needs more takes the row.
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
  - A fact with nothing in it says so, such as "None", never a dash or a
    blank.
  - A note on a fact, such as until when someone is acting in a role, is a
    second line under its value, in `--text-sm` and `--muted`.
  - What can be done to a fact, such as ending someone's contract, is a
    small secondary button beside its value. An action with no value to
    sit beside, such as resetting someone's password, is a fact of its
    own, with its button as the value.
  - While what was asked for waits for approval, such as another role, a
    note under the value says so, linked to the request, where its button
    was.
- **Files:**
  - adding files is a secondary "Attach files" button that opens the file
    picker. On computers, files can also be dropped on it. The hint says
    which kinds and how large they may be;
  - each file, picked or saved, is a chip with a file icon, its name and
    its size. A saved file's chip opens it in a new tab, and says so to
    screen readers. A chip's remove button is named for its file.
- **A person's profile,** seen by someone else, is one card: their photo,
  then their facts as details (above), each only for whoever may see it.
  Edit is the page header's primary button, for whoever may edit them; the
  form is a page of its own.
- **A person's photo,** at the top of their profile's card: a circle 96px
  across, their photo filling it, or their initials in an avatar's colours
  when they have none, never a drawing that stands in for them.
  - Where it can be changed, beside it are "Upload a photo" ("Change
    photo" once there's one), the file picker (above) for one image, its
    hint saying which kinds, how large, and that it's saved as soon as
    it's uploaded, and "Remove photo", a quiet button that asks first.
  - A file that's too large, or isn't a photo, is said under the picker
    before anything is sent, as is a photo that couldn't be saved.
  - The photo is saved without the form's own button. While it's sent,
    the picker is off, and a line under it says so, which a screen reader
    hears.
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
  missing, and the button to add one. When why it's empty isn't plain, a
  second line says why, and who can change it: a Team Leader with no one
  on their team yet sees an empty list that's right, and looks broken.
- **Loading:** while a page, or a part of one, loads, it says so in the
  same block: the hourglass and one line saying what's loading, such as
  "Loading…", where it will be, which a screen reader hears. The page's
  header and filters are there from the start: a page is never given over
  to it whole. While the language changes, the whole screen says so, in
  the page's colour, for the moment it takes.
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
- **A page someone can't open,** such as one their role doesn't include,
  says so in its page header, in the page's language: "You can't open
  this page", and under it why, and who can change it.
  - A role that doesn't include it: an Admin of their company can add it
    to their role.
  - A page only a Super Admin opens, or, for a Super Admin, a company's
    own page: just that, as nobody's role changes it.
  - A module the company's package doesn't include: just that.
  - An account that can't open pages at all for now, such as a suspended
    one: just that, until it's signed out and told why.
  - Go to the dashboard is in the header, except on the dashboard itself
    and for an account that can't open pages: there it would only be
    told the same again. The side bar stays, as on any page.
- **A company whose subscription has ended:** the page its people are
  held on, where its Admin, the one who can still sign in, renews it.
  - Its page header says so, and under it the day access was paused, in
    the page's language and digits, on Egypt's calendar, as subscriptions
    are counted. Renewing it lets everyone back in at once.
  - Under the header, a card says first that nothing was deleted, with a
    check in the Good colour (§2.3): someone who thinks their records are
    gone doesn't renew.
- **A note above the page,** for something true on every page for now: a
  company's free trial or its grace, or a role a Super Admin is
  previewing. It's a level-1 panel at the page's width, above the page
  header, 24px over it.
  - Its meaning's colour (§2.3) is a 3px bar on its start edge, as a
    card's is: Neutral for a trial, Problem for grace, Waiting on someone
    for a preview. The words say it, so the colour is never the only
    signal.
  - What's so is in the page's language, digits too, and the one thing to
    do about it is on its end side, if it can be done there. On a phone it
    goes under the words.
  - Screen readers hear it once, as it appears. It can't be closed: it
    goes when what it says stops being true.
  - A trial counts its days left, and says the day it ends, on Egypt's
    calendar, as subscriptions are counted.
  - Grace says the subscription has ended, how long is left until access
    stops, and on what day. Its Admin is told that renewing it keeps
    everyone's access; everyone else, that an Admin of their company can
    renew it.
  - A preview says which role, at which company, and that nothing can be
    changed while it lasts, with Exit preview.
- **Card:** a level-1 panel with 12px corners and 16px inside (12px on
  phones), for things that aren't lists, such as settings sections.
  - A card that needs someone before going on has the Waiting on someone
    colour (§2.3) as a 3px bar on its start edge. An example is Payroll's
    people paid for days nobody has ruled on.
  - A card that says something is wrong has the Problem colour's. An
    example is the people whose month couldn't be worked out.
  - Its title says what it is, so the colour is never the only signal,
    and its background stays the panel's, so its text keeps its contrast.
  - A card that loads its own data holds the room of the most it can show
    while it loads, so nothing below it moves when it comes. Each part,
    such as its state or its row of buttons, is as tall as the tallest of
    what it can show there, failing to load included. An example is face
    verification on System settings.
- **Document:** a paper the app issues, such as a payslip or a settlement
  statement, read on screen and printed.
  - The page header names it, with Print as its primary button and
    anything else that acts on it, such as Send again, beside it. They sit
    above the sheet, never on it, so none of them is printed.
  - The sheet is a level-1 panel at reading width (736px), with 32px
    inside (16px on phones). Its head has the company's name in
    `--text-xl`, weight 500, with the document's name below it in
    `--text-sm` and `--muted`, and the company's logo on the end side,
    over a 2px rule in `--ink`.
  - Its facts, such as who it's for and the period, are details (below).
  - Its lines are a label on the start side and the amount on the end
    side, in even-width digits. An amount taken off has a minus sign (−).
    A group of lines, such as Earnings, has a heading in `--text-sm`,
    weight 500.
  - A total is in `--text-lg`, weight 600, under a 2px rule in `--ink`.
    The figure the document is for, such as the net, is its last total.
  - What to know about it is a note with its meaning's colour (§2.3) as a
    3px bar on its start edge, as a card has: a payslip not final yet
    waits on someone. A settlement says who owes whom in the colour of
    what it means for the person: good when the company owes them, a
    problem when they owe, neutral when it's settled. The words say it,
    so the colour is never the only signal, and a bar prints where a fill
    wouldn't.
  - It's in the page's language, digits too.
  - Printed, the sheet is all there is: black on white, without the app
    around it, with 18mm margins, and its notes' bars in the colours they
    have on a light screen, from dark mode too.
  - One that isn't there, or isn't theirs, says so. One that didn't load
    says that instead, with Try again (§5.5, A list that didn't load).
- **Check-in:** the Nizmo app's first screen, for one task: recording
  arrival and departure.
  - The page header names it, with a line on what it's for. Its cards are
    at most 640px wide, as a form is.
  - Check in (primary) and Check out (secondary) share a card, side by
    side, each half its width, 56px tall with `--text-lg`: they're the
    app's most-pressed buttons, often pressed outdoors and in a hurry.
    While one works, it says what it's doing, such as "Finding your
    location…", and neither can be pressed again.
  - A phone not registered yet, or waiting for approval, says so in that
    card. Registering is the card's primary button.
  - What became of the check-in is a card under them, read out by screen
    readers:
    - recorded: a check icon in the Good colour (§2.3) beside the words;
    - recorded, but waiting on someone (a review, or the phone's
      approval): the Waiting on someone bar, as a card has;
    - not recorded: the Problem bar, and why.
    - Its time and distance are in the page's digits.
  - Arriving late is a card with the Waiting on someone bar: how late,
    the permission left this month, and Ask for permission hours.
  - Face verification is a titled card of its own, one step at a time:
    consent, set-up, waiting for approval, verifying again. Withdrawing
    consent, like using this phone instead of another, is confirmed in a
    dialog first.
  - In a browser it says to use the app, as an empty state. So does it,
    in its own words, for the Super Admin, who has no attendance, and
    where the company's package hasn't the app. One whose phone details
    didn't load says so, with Try again.
- **Sign-in:** the one screen before the app, so it has no side bar and
  no top bar. It's in the default brand colour (§2.1).
  - On `--page`, a card in the middle of the screen, at most 400px wide,
    with 32px inside (24px on phones, which keep the page's 16px edge
    around it). Behind it the page is flat: no gradient, no glass and
    nothing moving (§4.3, §8).
  - The card's title says what's done here, and where: "Sign in to
    Nizmo", as a page title is (§5.5, Page header). A step after it, such
    as the two-factor code, has its own title, with a line under it on
    what to type.
  - Its fields are the building blocks' (§5.3), one under the other: the
    email or username, written left to right in both languages (§3.3),
    then the password, with its eye button. "Forgot your password?" is a
    quiet button under the password, on the end side.
  - "Stay signed in", and on the code step "Remember this device for 30
    days", are checkboxes, each with its label.
  - The step's one primary button takes the card's width. Its other
    actions, such as "Email me a code instead" and "Back to sign in", are
    quiet buttons under it.
  - What's wrong with what was typed, such as a field left empty or a
    code that isn't six digits, is said under its field before anything
    is sent, with the focus on the first. A code that isn't right is said
    under the code, too.
  - What the server says, such as a wrong password, an account held back
    after wrong tries, counting down, or a company whose subscription has
    ended, is said above the primary button, in the page's language, and
    screen readers hear it. The primary button can still be pressed while
    an account is held back, as an Admin may unlock it before the time
    is up.
  - "Forgot your password?" is two steps in the same card: the account's
    email, then the code sent to it with the new password, asked twice, as
    Change password asks it, its hint saying how long it must be. Neither
    says whether the email is on an account: the second says a code was
    sent if it is, naming the email as typed. Reset, it's back to signing
    in, the email filled in and the password focused, saying the password
    was reset.
  - Too many tries to reset a password are counted down above the primary
    button, as an account held back is, until it can be tried again.
  - Under the card, as part of the page and never over it: the privacy
    policy, the terms, and the language and theme switches, in a row that
    wraps on phones. The switches are the top bar's language switch and
    the account menu's theme switch (§5.1).

---

## 6. Icons

- **Phosphor Icons, regular weight,** imported one at a time
  (`UI_PLAN.md` §4.4).
- **Sizes:**
  - 18px in the side bar and in buttons, and 20px in the side bar's drawer
    on phones;
  - 16px in fields and detail lines;
  - 20px in the top bar on a computer, and 22px on a phone;
  - 40px in empty states.
- **The selected side bar item** uses the filled version of its icon.
- **The side bar's icons** (§5.1), as the approved mock-up has them:
  - a company's: Dashboard `SquaresFour`, Check in `MapPin`, Tasks
    `CheckSquare`, Obligations `PushPin`, Clients `Handshake`, Locations
    `MapTrifold`, Records `Folders`, Employees `Users`, Attendance and My
    attendance `Clock`, Requests `Tray`, Costs `Coins`, Payroll `Receipt`,
    My payslips `FileText`, My cash advance `Wallet`, Roles and access
    `IdentificationBadge`, Saved lists `ListChecks`, Company settings
    `GearSix`;
  - the Super Admin's: Companies `Buildings`, Packages `Package`, All users
    `UsersThree`, Role templates `Stack`, Policy templates `Clock`, Public
    holidays `CalendarBlank`, Super Admins `ShieldCheck`, Role changes
    `ArrowsLeftRight`, Access reviews `ListChecks`, Who can
    `MagnifyingGlass`, Check-ins `MapPin`, Audit logs `ClipboardText`,
    System health `Heartbeat`, System settings `GearSix`.
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
- **2026-10-22:** A pick from a list that can grow (§5.3), for a task's
  client and location (`CLIENTS_PLAN.md` §2.3): grouped options, one that
  can't be picked yet greyed with why, and "+ New location" as a button
  below the select.
- **2026-10-22:** A name typed or picked from a saved list (§5.3), for task
  titles and cost names (`CLIENTS_PLAN.md` §5).
- **2026-10-29:** The code a high-risk action asks for sits above every
  other dialog (§5.5, Dialog). Drawn under the confirmation that sent the
  action, as "Pay 7 costs" or "Collect 7 charges" stays open until it's
  answered, its Confirm couldn't be clicked.
- **2026-10-30:** On phones, a total tile's value is never broken (§5.5,
  Total tiles). Two tiles to a row left half the row for each, so an
  amount such as "6,355.50 EGP" had its currency on a line of its own. A
  tile whose value needs more than half takes the row.
- **2026-10-30:** On phones, the tabs share the row, a long label on two
  lines, so every tab shows (§5.5, Tabs). The Costs page's three ran past
  the edge in English, Cash advances cut off mid-word even when it was the
  one picked.
- **2026-10-30:** An empty state can say why it's empty, on a second line,
  when that isn't plain (§5.5, Empty state): the Tasks list's for a Team
  Leader with no one on their team yet.
- **2026-10-30:** A pick of several from a long list, and a form on a page
  of its own (§5.3), for Create task.
- **2026-10-31:** Which period a page is about (§5.3), for Payroll's month
  and year, and later Attendance's month and Public holidays' year. Each
  picks it its own way today: three selects squeezed in beside the title,
  a browser's month field, and arrows either side of a year.
- **2026-10-31:** A card that needs someone, or says something is wrong
  (§5.5, Card), for Payroll's review: a bar on its start edge in its
  meaning's colour, as an overdue row has. Payroll's old cards filled the
  whole card with the colour.
- **2026-10-31:** Which period a page is about (§5.3), decided the same
  day: its address keeps the period, so a reload or a link opens on it,
  and the Super Admin's company is the company in view from the top bar.
  Payroll had a company select of its own, so a Super Admin picked the
  company twice.
- **2026-11-01:** A row that opens (§5.5, Rows), for Payroll's list of
  everyone on the register. Each name opened that person's lines before
  too, but as a plain button with nothing to say it opened, or whether it
  was open, and an excluded person's row was faded below a readable
  contrast. Excluded is said in words now, with why.
- **2026-11-01:** A document (§5.5), for the payslip and the settlement
  statement. Each was a sheet of its own making: headings in small
  capitals, totals and colours typed in, the settlement's verdict a
  coloured fill that doesn't print, and a document that didn't load
  saying it didn't exist.
- **2026-11-01:** Check-in (§5.5), the app's first screen, and the large
  button it alone uses (§5.2). It was a screen of its own making: emoji
  for icons, sizes and colours typed in, the old confirmation window, and
  a failed load that said only "Something went wrong", with no way to try
  again.
- **2026-11-02:** A row's note (§5.5, Rows), under its detail line, for
  what an item is for, such as a template's description. The templates
  pages showed it in cards of their own making.
- **2026-11-02:** A row can be the one you came to see (§5.5, Rows), and
  carry a note a line; a list with one filter and no search has it in its
  card's head (§5.3). Role change requests and access reviews had their
  own pills for status, and an outline or a yellow fill for the one a
  notification opened.
- **2026-11-02:** A password field (§5.3): a button at its end shows the
  password and hides it again. The Super Admins page had an eye of its
  own making, placed by hand on each side for each language.
- **2026-11-02:** A tab can say how many it holds (§5.5, Tabs), as the
  Companies list's two do. The list's subscription states take the status
  badges' meaning colours (§2.3), where they had colours of their own.
- **2026-11-03:** A dialog can ask for a word typed first (§5.5, Dialog),
  for what can't be undone, such as restoring a backup on System health.
  The page's word was in the old confirmation window, in a box of its own
  making, with "Type" and "to confirm" on either side of it.
- **2026-11-03:** A card that loads its own data holds the room of the most
  it can show (§5.5, Card), with a building block for it. Face
  verification on System settings held it with copies of its own making.
- **2026-11-04:** A confirmation is a building block (§5.5, Dialog). The
  last eleven were the old confirmation window, of its own making, with a
  warning sign and an amber or red button, red too where nothing was
  deleted, as on confirming a cash advance's receipt. A dialog's button that
  doesn't fit on one line takes two: "Collect 10 charges, 4,525.50 EGP"
  ran past its own edges on a phone in Arabic.
- **2026-11-04:** Loading is said in the empty state's block (§5.5,
  Loading), as most pages already did. The last five places waited behind
  a spinner of their own making, which took the whole page, and the
  language's switch showed it over the whole screen.
- **2026-11-04:** A person's photo (§5.5), at the top of their profile.
  It was a circle of its own making with a drawn man or woman for someone
  with no photo, chosen by their gender, and a window of its own to see
  the photo larger before it could be changed. Its picker took any image,
  so one the server doesn't take, such as a HEIC or an AVIF, was sent
  before it was refused, in English.
- **2026-11-04:** A person's profile (§5.5), seen by someone else, is their
  details, with Edit in the page header, and the two password dialogs
  (§5.5, Dialog). It was the edit form with every field turned off, and no
  way to edit from it. A wrong password was said in a toast, over a window
  of its own making, and the temporary password sat among the fields, in
  the same size as the rest.
- **2026-11-04:** What takes the focus on a page of the dashboard, such as
  the first field that's wrong, stops below the sticky header (§5.3, a form
  on a page of its own). Told what's wrong, a field at the window's top
  edge took the focus where it was, under the header.
- **2026-11-05:** A dialog that shows what it would record before it does,
  and one that asks who takes over (§5.5, Dialog), for ending a contract
  and handing over a leader's team. Each was a window of its own making:
  the settlement in a sunk box with a heading in small capitals and
  colours typed in, its button taking a date whose figures weren't on
  screen yet, and the hand-off closing before the change was sent, its
  refusal a toast, in English.
- **2026-11-05:** The sign-in screen (§5.5, Sign-in), the one screen with
  no app shell. It was a glass card of its own making over a moving
  gradient, its title in gradient letters, its checkboxes drawn by hand
  and its words typed into the page in both languages. The language and
  theme switches and the legal links were pinned to the screen's bottom
  corners: on a phone the theme switch covered Sign in, and the language
  switch the legal links.
- **2026-11-05:** Forgot your password (§5.5, Sign-in), two steps in the
  sign-in card. It was a form of its own making, its words typed into the
  page, its mistakes said at the top of the card in English, too many
  tries a time to try again at in the server's own time zone, and once
  reset it went back to signing in without a word.
- **2026-11-05:** A page someone can't open, and a company whose
  subscription has ended (§5.5). The first was a page of its own making,
  in English only, titled "Access Restricted" under a no-entry emoji. It
  said the same to everyone, an Admin on a Super Admin's page told to ask
  their administrator, and on the dashboard itself it sent them back to
  the dashboard. The second was a glass card under an hourglass emoji,
  the day it locked in red, on the reader's own calendar.
- **2026-11-05:** A module the company's package doesn't include isn't in
  the side bar (§5.1), decided by the product owner; its pages, opened by
  their address, say so (§5.5, A page someone can't open). It was in the
  side bar, faded and with a padlock, as the way to find out what else the
  product does, and its pages were a card under a padlock emoji naming the
  bundle to buy.
- **2026-11-05:** A note above the page (§5.5), for a company's trial or
  grace and a role being previewed. Each was a box of its own making under
  an emoji. The trial's said "2 day(s) left" in English, and "2" in Arabic
  among Arabic-Indic digits; grace told everyone to renew, which only an
  Admin can; and both read their day on the reader's own calendar.
- **2026-11-05:** A part of a page that belongs to a module the company's
  package doesn't include isn't there either (§5.5, Page layout). The
  dashboard showed a company without HR its bonuses, deductions and day
  off credit, and one without Company Management its tasks and
  obligations; a profile showed pay and day off credit, and Add employee
  asked for both.
- **2026-11-05:** The side bar (§5.1, §6), as the mock-up of the app's
  frame approved by the product owner draws it: light, on `--panel` in
  both themes, with Phosphor icons where it had emoji, the privacy policy
  and the terms at its foot, and on a phone a drawer that is a dialog. It
  was dark slate in both themes, with the company's name in a gradient
  under a rocket emoji, folded to its icons when the name was clicked, and
  on a phone only slid out of sight, Tab still going through its links.
  The "Powered by" signature stays as it was, decided by the product
  owner.
- **2026-11-05:** Requests in the side bar carries how many wait on this
  person under its To review tab (§5.1), as the approved mock-up has it.
  The top bar had a button of its own for name changes, which counted those
  alone, in red, while day off, permission hours and the rest waited
  uncounted on the same page.
- **2026-11-06:** The top bar (§5.1, §6), as the approved mock-up of the
  app's frame draws it: no title, since every page names itself; the
  language switch on the bar, short on a phone and named "Language"; the
  bell's count in the brand colour, heard with its name; and the account
  button with the person's photo or initials, their name and role, opening
  the account menu with its head, My profile, Security settings, History,
  the theme switch and Sign out. On a phone, the glass floats 8px in from
  the screen's edges, where the bar's buttons are, rather than 16px. The
  bar had a title of its own, hidden where the page had a header; the
  language switch was in the account menu, named for the other language;
  the bell's count was red; the button showed a drawn man or woman for
  someone with no photo, and the role in capitals; and "Sign Out" was in
  red.
- **2026-11-06:** The Super Admin's company picker (§5.1), as the approved
  mock-up of the app's frame draws it: the company in view on a pill, with
  its initials, opening a panel with a search of its own above the
  companies, each with its initials. The picker was a see-through pill
  with the company's name alone, and its list had no search, so a Super
  Admin with many companies scrolled through them all.
