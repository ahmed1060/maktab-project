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
  - reconnecting, after a laptop sleeps or a phone loses its signal,
    draws once, for whatever was missed;
  - what someone else changed appears in place: no toast, no animation,
    and what the person was typing, their filters and where they'd
    scrolled to stay.
- **What still asks, as a safety net:** the bell every 5 minutes, and the
  heartbeat every 90 seconds. Either can be slowed once the live path has
  run in production for a while.
- **Cost:** about one connection per open tab, and one signal per change
  per company. Supabase's free plan allows 200 connections at once and
  2 million messages a month; at 50 to 200 people, both are far off.

---

## 3. Built in parts

| Part | What it covers | PR |
|---|---|---|
| 1 | The token, the channels' rules and the triggers; one connection per tab; the task list, a task's page and the bell drawn again when what they show changes | #244 |
| 2 | The Requests page, and the count on Requests in the side bar | |
| 3 | A suspended, archived or banned person signed out within seconds, not 90; the heartbeat kept as the safety net | |
| 4 | Other screens, as they're wanted: cash advances, attendance, costs | |

- Each part is its own PR, merged on the product owner's word.
- **Before part 1 is live:** the product owner adds the project's JWT
  secret to Vercel as `SUPABASE_JWT_SECRET`, for Production and Preview
  (Supabase: Project Settings, JWT Keys, Legacy JWT secret). Until then,
  the token route says it's off, and every screen goes on as today.

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
