# Third changes: plan

This file holds the third plan: changes moved here to come after
`LATER_CHANGES_PLAN.md`, as the owner asked. It is updated with every
decision and enhancement; the change log at the end records each update.

Each part is marked:

- **Decided**: the product owner agreed to it.
- **Proposed**: suggested, waiting for the product owner's answer.
- **Open**: a question that needs answering before that part is built.

Status: **proposed, to discuss after the second plan.**

## 1. The company's name and icon (Proposed)

Moved here from `LATER_CHANGES_PLAN.md` §1 on 2026-11-22, as the owner
asked, as it stood there.

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

## Change log

- **2026-11-22:** Plan started with the company's name and icon, moved
  from `LATER_CHANGES_PLAN.md` §1 as the owner asked, with its open
  questions: the app's way, (a) or (b), and what a company without a logo
  shows.
