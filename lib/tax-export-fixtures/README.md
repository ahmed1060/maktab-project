# The tax portal's export button, tried in a browser

What `scripts/tax-export-browser-run.mjs` keeps (`CLIENT_PORTAL_PLAN.md`
§10, §15). The export button runs on the Tax Authority portal's page, so
the tests that run on every push can't try what it does there. The run
presses its bookmark in Chromium on `portal.html`, a page laid out like
the portal's, and checks what §15 lists. When every check passes, it
keeps here:

- `run.json`: the fingerprints of the button's code, of `portal.html`
  and of the run as they were tried, the checks that passed, and the
  name the button gave each file;
- the `.xlsx` files, as the button saved them.

`lib/tax-export-button.test.ts` reads these files with Nizmo's reader on
every push, and fails where the button's code, the page or the run is no
longer what was tried.

After any change to `lib/tax-export-button.ts`, to `portal.html` or to
the run, run it again:

    node scripts/tax-export-browser-run.mjs

It needs Playwright and its Chromium, which the app doesn't use. Nothing
here is edited by hand, `portal.html` aside. Every company and claim in
these files is made up.
