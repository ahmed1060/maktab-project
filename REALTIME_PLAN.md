# Live updates: plan

What someone else changes appears on the screens of the people it
concerns, without anyone refreshing the page. The first example, and the
reason for it: a task assigned to an employee appears in their task list,
and their bell, as it's assigned.

Decided with the product owner on 2026-11-10.

---

## 1. What's there today

- **Maintenance mode** is live already: the Super Admin turning it on
  reaches every open page at once, over a public Supabase Realtime channel,
  `maintenance-status` (`components/UserHeartbeat.tsx`,
  `lib/services/realtime-broadcast.service.ts`). It's public because
  "maintenance is on" is no secret.
- **Everything else waits to be asked:**
  - a page shows what was true when it was opened, and is drawn again
    after its own person's actions (`router.refresh()`);
  - the bell asks every 5 minutes (`components/NotificationBell.tsx`);
  - the heartbeat asks every 90 seconds, while the tab is shown, whether
    the account was suspended, archived or banned, and whether maintenance
    is on.
- **The server refuses whatever the page no longer may do,** whatever the
  page shows: a suspended person's next request is refused, live or not.

---

## 2. How it works (Decided)

- **A signal says only that something changed, never what.** The server
  sends "tasks changed" to a company's people. Each open screen that shows
  tasks draws itself again, through the same route and the same checks as
  any visit. So:
  - nothing anyone may not see travels over the connection: no names, no
    amounts, no ids;
  - a signal lost, late or sent twice costs a refresh, or a later one,
    and nothing else;
  - what a screen shows is always what the server says now.
- **The database sends the signals,** from triggers on the tables that
  change, with Supabase's `realtime.send`. A signal is written in the same
  transaction as the change, so it goes out only if the change is saved,
  and every way a task can change is covered without anyone having to
  remember to send one: the forms, bulk upload, a transfer, a cron job.
  - One signal per statement, not per row: a bulk upload of 50 tasks is
    one signal for its company.
  - A signal that can't be sent never stops the save: the trigger catches
    the error and only warns.
  - On a database without Supabase's `realtime` schema, such as the
    Postgres the tests use, the triggers do nothing.
- **Private channels (Decided: the product owner's choice of two).**
  Supabase lets a browser listen to a channel only if a rule on
  `realtime.messages` lets its token in:
  - `tasks:<company id>`: the company's people, and the Super Admin;
  - `notices:<person id>`: that person, or that Super Admin, alone.
  - The browser can send nothing on them: there's no rule for that.
  - The token is the app's own: `GET /api/realtime/token` signs one for
    the person signed in, for an hour, with the project's JWT secret
    (`SUPABASE_JWT_SECRET`, in Vercel). It names the person, their company,
    and whether they're the Super Admin, and the browser asks for a new one
    before it ends. A person suspended, archived or banned is given none.
  - Turned down: public channels with names too long to guess. No set-up,
    but a name once known stays known, after its person has left, and
    anyone holding it could send false signals.
- **One connection per open tab,** opened once the dashboard is drawn and
  loaded only then, as the maintenance channel's is. Screens say which
  signals they want; the connection listens to the topics they need.
- **On the screen** (`DESIGN.md` §8):
  - signals arriving close together are drawn once, a second after the
    last;
  - a hidden tab draws nothing, and catches up when it's shown again;
  - joining draws once: as the page opens, for a change saved while it
    was on its way, and on reconnecting, after a laptop sleeps or a phone
    loses its signal, for whatever was missed;
  - what someone else changed appears in place: no toast, no animation,
    and what the person was typing, their filters and where they'd
    scrolled to stay. Part 5 adds a little motion to show what arrived
    (§3).
- **The secret it's signed with** is Supabase's legacy JWT secret. The
  project has moved to Supabase's newer signing keys, and Supabase still
  accepts tokens signed with the old secret: its dashboard calls it
  "still used". Revoking it, or switching the project to Supabase's
  publishable and secret API keys, which turns it off, would turn live
  updates off too, and the app's public key with them. Either is done
  only after the token is signed another way.
- **What still asks, as a safety net:** the bell every 5 minutes, and the
  heartbeat every 90 seconds. Either can be slowed once the live path has
  run in production for a while.
- **Cost:** about one connection per open tab, and one signal per change
  per company. Supabase's free plan allows 200 connections at once and
  2 million messages a month; at 50 to 200 people, both are far off.
  - Each signal is counted once for every tab that hears it, and every
    open tab of a company hears its tasks' signals, not only those on a
    task page. A company of 200 with 150 tabs open and 300 task changes a
    day would use about 1.35 million a month. Supabase's usage page is
    checked after the first weeks; if it runs high, a tab joins a channel
    only while a screen that listens to it is open.

---

## 3. Built in parts

| Part | What it covers | PR |
|---|---|---|
| 1 | The token, the channels' rules and the triggers; one connection per tab; the task list, a task's page and the bell drawn again when what they show changes | #244, merged 2026-11-10 |
| 2 | The Requests page, and the count on Requests in the side bar | |
| 3 | A suspended, archived or banned person signed out within seconds, not 90; the heartbeat kept as the safety net | |
| 4 | Other screens, as they're wanted: cash advances, attendance, costs | |
| 5 | A little motion for what arrives live: what changed is shown for a moment, so nobody has to hunt for it | |

- Each part is its own PR, merged on the product owner's word.
- **Part 1 has been live since it merged.** `SUPABASE_JWT_SECRET` was
  already in Vercel, for Production, Preview and Development, added with
  the Supabase integration on 2026-09-03, so nothing had to be added. The
  product owner checked it in production the same day: a task given to an
  employee appeared on their open Tasks page, and Supabase's Realtime logs
  showed no refused joins.
- **Part 3:** its trigger listens only to a person's status changing and
  a company being banned (`AFTER UPDATE OF status` on `"User"`, and of
  `"isBanned"` on `"Company"`). The heartbeat writes `"User"` every 90
  seconds for each open tab (`lastActivity`), so a trigger on any update
  would signal with every heartbeat.
- **Part 5, motion (Proposed; decided with the product owner when it's
  built):** what someone else changed is shown arriving, briefly, and
  then the screen is still again. `DESIGN.md` §8 says now that nothing
  slides or flashes; it's changed first, in its own commit.
  - **A row that arrives or changes** (a task given to the person, its
    title or deadline changed) takes a soft tint of the accent colour
    that fades over about two seconds. It doesn't slide, and the rows
    around it don't move.
  - **The bell's count, as it rises,** grows once a little and settles
    back, in about a quarter of a second.
  - **A row that goes simply goes:** showing it leaving would mean
    keeping on screen what the server says is gone.
  - **Only for what someone else did:** not for the person's own changes,
    which they know of, and not on the first draw as a page opens. What
    changed while a tab was out of sight is shown as it comes back.
  - **With reduced motion,** the tint shows and goes without fading, and
    the count doesn't grow.
  - In both languages and both themes, from the colour tokens, with
    Emil Design Engineering's motion guidance (`UI_PLAN.md` §7.1).

---

## 4. Not covered here

- **The phone app in the background:** it hears nothing while it's
  closed. That's native push, which today sends only check-in reminders
  (`lib/services/push.service.ts`); sending every notification by push is
  its own piece of work.
- **The maintenance channel** stays public, as it is.

---

## Change log

- **2026-11-10:** File created, with the product owner's decisions:
  signals that say only what changed, sent by the database; private
  channels, behind the app's own short-lived token; and part 1 covering
  tasks and the bell.
- **2026-11-10:** Part 1 merged in #244, and live since: the secret was
  already in Vercel, from the Supabase integration, and the product owner
  checked it in production. Added, at the product owner's request, part 5:
  a little motion for what arrives live (Proposed). Noted the legacy
  secret that the token depends on, what part 3's trigger listens to,
  and how the messages are counted.
