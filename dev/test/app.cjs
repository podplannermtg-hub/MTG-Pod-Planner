const { chromium } = require('playwright');
const path = require('path');
const OUT = process.argv[2];
const SHOTS = path.resolve(OUT, '..');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

const results = [];
const check = (name, ok, extra) => { results.push([ok, name]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); };

const baseSeed = () => ({
  pods: { p1: { name: 'Tuesday Commander', mana: 'G', by: 'x', at: 1 }, p2: { name: 'Draft Crew', mana: 'R', by: 'x', at: 2 } },
  nights: { n1: { title: 'Existing Night', date: plus(3), time: '19:00', place: 'Dan', format: 'Commander', min: 2, podIds: ['p1'], by: 'x', at: 1 } },
  polls: {},
  people: { old1: { nick: 'Sam', pods: ['p1'], res: { n1: 'yes' }, bring: { n1: 'dip' } }, other1: { nick: 'Dana', pods: ['p1'], res: {} } },
  config: { members: { emails: ['dana@example.com', 'me@example.com', 'sam@example.com'], admins: [] } },
  requests: { u9: { email: 'zed@example.com', name: 'Zed', at: 5 } },
});
const HOOK = 'https://discord.com/api/webhooks/123456/abcDEF_-9';
const withDiscord = (s) => { s.config.discord = { webhook: HOOK, ping: '' }; return s; };

async function open(browser, auth, seed, extra) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], posts = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://discord.com/api/webhooks/')) { posts.push(JSON.parse(route.request().postData()).content); return route.fulfill({ status: 204, body: '' }); }
    if (u.startsWith('file://')) return route.continue();
    return route.abort();
  });
  await page.addInitScript(([s, a, x]) => { window.__seed = s; window.__auth = a; Object.assign(window, x || {}); }, [seed, auth, extra]);
  await page.goto('file://' + path.resolve(OUT));
  return { page, errors, posts, ctx };
}
const store = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__store)));
const calls = (page) => page.evaluate(() => window.__calls);

(async () => {
  const browser = await chromium.launch();

  /* ===== signed out ===== */
  {
    const { page, errors } = await open(browser, { state: 'signedout' }, baseSeed(), { __authFail: { signIn: 'auth/invalid-credential' } });
    await page.waitForSelector('#gate:not([hidden])');
    check('signed out: gate shown, board hidden', await page.locator('#googleBtn').isVisible() && !(await page.locator('#board').isVisible()));
    check('signed out: no game data on screen', (await page.locator('article.night').count()) === 0);
    await page.screenshot({ path: path.join(SHOTS, 'shot-signin.png'), fullPage: true });
    await page.click('#googleBtn');
    await page.waitForFunction(() => window.__afterAuth === 1);
    check('Google button calls Google sign-in then reloads', JSON.stringify(await calls(page)) === '[["google"]]');
    await page.fill('#authEmail', 'Rob@Example.com'); await page.fill('#authPw', 'wrongpass');
    await page.click('#authSubmit');
    await page.waitForSelector('#gate .err');
    check('bad password shows a plain message', (await page.locator('#gate .err').innerText()) === "That email and password don't match.");
    check('email is normalized before sign-in', JSON.stringify((await calls(page))[1]) === '["signIn","rob@example.com","wrongpass"]', await calls(page));
    await page.click('#gate .seg button:has-text("Create account")');
    await page.fill('#authEmail', 'new@example.com'); await page.fill('#authPw', 'secret123');
    await page.click('#authSubmit');
    await page.waitForFunction(() => window.__afterAuth === 2);
    check('create account calls sign-up', JSON.stringify((await calls(page))[2]) === '["signUp","new@example.com","secret123"]');
    await page.click('#gate .seg button:has-text("Sign in")');
    await page.click('#gate button:has-text("Forgot password?")');
    check('forgot password needs an email', (await page.locator('#gate .err').innerText()).includes('Enter your email'));
    await page.fill('#authEmail', 'rob@example.com');
    await page.click('#gate button:has-text("Forgot password?")');
    await page.waitForSelector('#gate .ok');
    check('forgot password sends reset', (await calls(page)).some((c) => c[0] === 'reset' && c[1] === 'rob@example.com'));
    check('signed out: no errors', errors.length === 0, errors);
    await page.context().close();
  }

  /* ===== unverified ===== */
  {
    const { page, errors } = await open(browser, { state: 'unverified', uid: 'u2', email: 'new@example.com' }, baseSeed());
    await page.waitForSelector('#verifiedBtn');
    check('unverified: shows the address', (await page.locator('#gate').innerText()).includes('new@example.com'));
    await page.click('#verifiedBtn');
    await page.waitForSelector('#gate .ok');
    check('not yet confirmed: explains, no reload', (await page.evaluate(() => window.__afterAuth)) === 0);
    await page.evaluate(() => { window.__verified = true; });
    await page.click('#verifiedBtn');
    await page.waitForFunction(() => window.__afterAuth === 1);
    check('confirmed: reloads into the app', true);
    check('unverified: no errors', errors.length === 0, errors);
    await page.context().close();
  }

  /* ===== not on the list ===== */
  {
    const { page, errors } = await open(browser, { state: 'notmember', uid: 'u3', email: 'stranger@example.com', profileName: 'Stranger Danger' }, baseSeed());
    await page.waitForSelector('#askJoin');
    check('not member: name prefilled from account', (await page.inputValue('#joinName')) === 'Stranger Danger');
    check('not member: board hidden', !(await page.locator('#board').isVisible()));
    await page.screenshot({ path: path.join(SHOTS, 'shot-notmember.png'), fullPage: true });
    await page.click('#askJoin');
    await page.waitForSelector('#checkAgain');
    const s = await store(page);
    check('join request stored', s.requests.u3 && s.requests.u3.name === 'Stranger Danger' && s.requests.u3.email === 'stranger@example.com');
    check('request confirmation shown', (await page.locator('#gate').innerText()).includes('Request sent as Stranger Danger'));
    check('not member: no errors', errors.length === 0, errors);
    await page.context().close();
  }

  /* ===== organizer ===== */
  {
    const { page, errors } = await open(browser, { state: 'ok', uid: 'admin1', email: 'boss@example.com', isAdmin: true }, baseSeed());
    await page.waitForSelector('article.night');
    await page.fill('#nick', 'Boss'); await page.click('#nickForm button[type=submit]');
    await page.waitForSelector('#membersSec:not([hidden]) #requests .mrow');
    check('organizer sees Members with the pending request', (await page.locator('#requests').innerText()).includes('zed@example.com'));
    check('organizer can cancel nights they did not create', (await page.locator('article.night', { hasText: 'Existing Night' }).locator('button.link', { hasText: 'Cancel night' }).count()) === 1);
    await page.screenshot({ path: path.join(SHOTS, 'shot-members.png'), fullPage: true });
    await page.click('#requests button:has-text("Approve")');
    await page.waitForFunction(() => !window.__store.requests.u9);
    let s = await store(page);
    check('approve adds email and clears request', s.config.members.emails.includes('zed@example.com'));
    await page.fill('#newMember', '  NEW.Friend@Example.com ');
    await page.click('#addMemberForm button');
    await page.waitForTimeout(100);
    s = await store(page);
    check('add by email stores lowercase', s.config.members.emails.includes('new.friend@example.com'), s.config.members);
    await page.fill('#newMember', 'not-an-email'); await page.click('#addMemberForm button');
    await page.waitForTimeout(100);
    check('bad email rejected', !(await store(page)).config.members.emails.includes('not-an-email'));
    const row = () => page.locator('#memberList .mrow', { hasText: 'dana@example.com' });
    await row().locator('button', { hasText: 'Make organizer' }).click();
    await page.waitForTimeout(100);
    s = await store(page);
    check('make organizer', s.config.members.admins.includes('dana@example.com'));
    await row().locator('button', { hasText: 'Remove' }).click();
    await row().locator('button', { hasText: 'Tap again to remove' }).click();
    await page.waitForTimeout(100);
    s = await store(page);
    check('remove takes them off both lists', !s.config.members.emails.includes('dana@example.com') && !s.config.members.admins.includes('dana@example.com'));

    // open to the public (two taps), then back
    check('starts invite only', (await page.getAttribute('#openSeg button[data-open=false]', 'aria-pressed')) === 'true');
    await page.click('#openSeg button[data-open=true]');
    check('opening needs a second tap', !((await store(page)).config.settings) && (await page.innerText('#openSeg button[data-open=true]')).includes('Tap again'));
    await page.click('#openSeg button[data-open=true]');
    await page.waitForTimeout(100);
    s = await store(page);
    check('open switch saved', s.config.settings && s.config.settings.open === true, s.config.settings);
    check('open hint explains', (await page.innerText('#openHint')).startsWith('Anyone who signs in'));
    await page.click('#openSeg button[data-open=false]');
    await page.waitForTimeout(100);
    check('back to invite only in one tap', (await store(page)).config.settings.open === false);

    // block someone
    const prow = () => page.locator('#peopleList .mrow', { hasText: 'Dana' });
    check('waiting list shows Dana before block', (await page.locator('article.night', { hasText: 'Existing Night' }).innerText()).includes('Dana'));
    await prow().locator('button', { hasText: 'Block' }).click();
    await prow().locator('button', { hasText: 'Tap again to block' }).click();
    await page.waitForTimeout(100);
    s = await store(page);
    check('block saved by account id', s.config.settings.blocked.includes('other1'));
    check('blocked person hidden from the board', !(await page.locator('article.night', { hasText: 'Existing Night' }).innerText()).includes('Dana'));
    check('blocked person marked in tools', (await prow().innerText()).includes('Blocked'));
    await prow().locator('button', { hasText: 'Unblock' }).click();
    await page.waitForTimeout(100);
    check('unblock', !(await store(page)).config.settings.blocked.includes('other1'));

    // Discord settings
    check('discord starts disconnected', (await page.innerText('#discordHint')).startsWith('Not connected'));
    await page.fill('#discWebhook', 'https://evil.example.com/steal');
    await page.click('#discordForm button[type=submit]');
    await page.waitForTimeout(100);
    check('non-Discord address refused', !(await store(page)).config.discord);
    await page.fill('#discWebhook', HOOK); await page.selectOption('#discPing', '@here');
    await page.click('#discordForm button[type=submit]');
    await page.waitForTimeout(100);
    s = await store(page);
    check('webhook saved to database', s.config.discord && s.config.discord.webhook === HOOK && s.config.discord.ping === '@here');
    check('webhook input is masked', (await page.getAttribute('#discWebhook', 'type')) === 'password');
    check('discord shows connected', (await page.innerText('#discordHint')).startsWith('Connected'));
    await page.screenshot({ path: path.join(SHOTS, 'shot-tools.png'), fullPage: true });
    check('organizer: no errors', errors.length === 0, errors);
    await page.context().close();
  }

  /* ===== regular member: full board flows ===== */
  {
    const { page, errors, posts } = await open(browser, { state: 'ok', uid: 'me1', email: 'me@example.com', isAdmin: false, profileName: 'Rob Google' }, withDiscord(baseSeed()));
    await page.waitForSelector('article.night');
    const card = (t) => page.locator('article.night', { hasText: t });
    check('member: Members section hidden', !(await page.locator('#membersSec').isVisible()));
    check('member: name prefilled from Google', (await page.inputValue('#nick')) === 'Rob Google');
    check('member: cannot cancel others\' nights', (await card('Existing Night').locator('button.link', { hasText: 'Cancel night' }).count()) === 0);
    await page.fill('#nick', 'Rob');
    await page.click('#ciPick button[data-c=R]'); await page.click('#ciPick button[data-c=U]');
    check('color picker names the pair', (await page.innerText('#ciName')) === 'Izzet');
    check('colors preview live before saving', (await page.getAttribute('html', 'data-ci1')) === 'U');
    await page.click('#nickForm button[type=submit]');
    await page.waitForSelector('.me-btn:has-text("Rob")');
    check('colors saved in WUBRG order', (await store(page)).people.me1.ci === 'UR');
    check('name chip shows pips', (await page.locator('.me-btn .pips i').count()) === 2);
    check('sign out link shown', await page.locator('#signOutBtn').isVisible());
    check('night card framed in its pod color', (await card('Existing Night').getAttribute('class')).includes('f-G'));
    check('type line names format and pod', (await card('Existing Night').locator('.typeline').innerText()).includes('Commander Night — Tuesday Commander'));
    await page.click('.chip:has-text("Tuesday Commander")');
    await card('Existing Night').getByRole('button', { name: "I'm in" }).click();
    check('filling the last seat throws confetti', (await page.locator('#confetti').count()) === 1);
    check('P/T box shows seats', (await card('Existing Night').locator('.pt').innerText()) === '2/2');
    check('seat shows player initial', (await card('Existing Night').locator('.seat.yes').allInnerTexts()).sort().join() === 'R,S');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'shot-cards.png'), fullPage: true });
    await page.waitForTimeout(150);
    let s = await store(page);
    check('answer saved', s.people.me1.res.n1 === 'yes');
    check('game-on posted', posts.some((p) => p.startsWith('Game on: Existing Night')), posts);
    await page.fill('#br_n1', 'chips'); await page.press('#br_n1', 'Enter');
    await page.waitForTimeout(150);
    check('bring list', (await card('Existing Night').locator('.roster .bring dd').innerText()).includes('Rob: chips'));

    await page.click('#callBtn');
    await page.fill('#nTitle', 'Weekly Test'); await page.fill('#nDate', plus(5));
    await page.selectOption('#nRepeat', '4');
    await page.click('#nightSubmit');
    await page.waitForSelector('#announce:not([hidden])');
    s = await store(page);
    check('weekly nights', Object.values(s.nights).filter((n) => n.title === 'Weekly Test').length === 4);
    await page.click('#closeAnnounce');

    await page.click('#callBtn');
    await page.click('#modeSeg button[data-m=poll]');
    await page.fill('#nTitle', 'Poll Test');
    await page.click('#nightSubmit');
    await page.waitForSelector('article.poll');
    await page.click('#closeAnnounce');
    await page.locator('article.poll .opt').nth(1).getByRole('button', { name: 'Can' }).click();
    await page.locator('article.poll .opt').nth(1).locator('button.link', { hasText: /lock in this date/i }).click();
    await page.locator('article.poll .opt').nth(1).locator('button.link', { hasText: /lock in this date/i }).click();
    await page.waitForFunction(() => !document.querySelector('article.poll'));
    check('poll locked in with vote carried over', (await card('Poll Test').getByRole('button', { name: "I'm in" }).getAttribute('aria-pressed')) === 'true');

    await card('Weekly Test').first().locator('button.link', { hasText: 'Edit' }).click();
    await page.fill('#nPlace', 'New Place'); await page.click('#nightSubmit');
    await page.waitForSelector('#announce:not([hidden])');
    check('edit posts update', posts.some((p) => p.startsWith('Updated: Weekly Test')));
    await page.click('#closeAnnounce');

    await card('Existing Night').locator('button:has-text("Apple or Outlook")').click();
    const saved = await page.evaluate(() => window.__saved);
    check('calendar file', saved && saved[0].text.includes('BEGIN:VEVENT'));

    await page.screenshot({ path: path.join(SHOTS, 'shot-board.png'), fullPage: false });
    await page.click('#signOutBtn');
    await page.waitForFunction(() => window.__afterAuth === 1);
    check('sign out calls Firebase and reloads', (await calls(page)).some((c) => c[0] === 'signOut'));
    check('member: no errors', errors.length === 0, errors);
    await page.context().close();
  }

  /* ===== open-mode guest: can use the board, cannot read the webhook ===== */
  {
    const seed = withDiscord(baseSeed());
    seed.config.settings = { open: true, blocked: [] };
    const { page, errors, posts } = await open(browser, { state: 'ok', uid: 'g1', email: 'guest@example.com', isAdmin: false }, seed, { __denyDocs: ['config/discord'] });
    await page.waitForSelector('article.night');
    await page.fill('#nick', 'Guest'); await page.click('#nickForm button[type=submit]');
    await page.click('#callBtn'); await page.fill('#nTitle', 'Guest Night'); await page.click('#nightSubmit');
    await page.waitForSelector('#announce:not([hidden])');
    check('guest: night posts without the webhook', posts.length === 0 && (await page.innerText('#announceH')) === 'Night posted');
    check('guest: copy message offered instead', (await page.inputValue('#announceText')).startsWith('New game night: Guest Night'));
    check('guest: no organizer tools', !(await page.locator('#membersSec').isVisible()));
    check('guest: no errors', errors.length === 0, errors);
    await page.context().close();
  }

  await browser.close();
  const failed = results.filter((r) => !r[0]).length;
  console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
  process.exit(failed ? 1 : 0);
})();
