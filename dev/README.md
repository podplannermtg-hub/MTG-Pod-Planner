# Developing Pod Planner

The live site is built from the files in `dev/src`. You only need this folder to change the app; GitHub Pages ignores it.

- `src/app.js` is the app itself, shared by the live site and the claude.ai preview.
- `src/body.html`, `src/base.css` and `src/tokens.*.css` are the page and its styles. Colors are tokens; the dark theme only redefines them.
- `src/backend.firebase.js` connects to Firebase. `src/config.js` is the template for the root `config.js` (keep your real keys only in the root copy).

Rebuild the site files from the repository root:

    python3 dev/build.py . dev/dist/preview.html

This rewrites `index.html` and `app.js` at the root (and `config.js`, so restore your keys with `git checkout config.js` afterwards, or keep them safe first).

Tests (need Node and Playwright with Chromium):

    node dev/test/app.cjs dev/dist/test.html       # every feature, against an in-memory database
    node dev/test/layout.cjs dev/dist/test.html    # overflow and alignment at 320, 375, 414 and 768 pixels
    node dev/test/csp.cjs .                        # the page's security policy
    node --import ./dev/test/reminders-mock.mjs reminders/remind.mjs   # the reminder job, against fake Google and Discord
