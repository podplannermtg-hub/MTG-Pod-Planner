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

async function open(browser, auth, seed, extra, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], posts = [], geo = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://discord.com/api/webhooks/')) { posts.push(JSON.parse(route.request().postData()).content); return route.fulfill({ status: 204, body: '' }); }
    if (u.startsWith('https://nominatim.openstreetmap.org/search')) {
      geo.push(decodeURIComponent(u));
      const hit = /Columbus/.test(decodeURIComponent(u)) ? [{ lat: '39.9612', lon: '-82.9988' }] : /postalcode=43017/.test(u) ? [{ lat: '40.0992', lon: '-83.1141' }] : [];
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(hit) });
    }
    if (u.startsWith('https://api.scryfall.com/cards/named')) {
      const q = decodeURIComponent(u.split('fuzzy=')[1] || '').toLowerCase();
      const cards = {
        atraxa: { name: "Atraxa, Praetors' Voice", artist: 'Victor Adame Minguez', image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/front/d/0/d0d33d52.jpg?1599707796' } },
        krenko: { name: 'Krenko, Mob Boss', card_faces: [{ artist: 'Karl Kopinski', image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/front/c/d/cd9fec9d.jpg?1562' } }] },
      };
      const c = cards[q];
      return route.fulfill({ status: c ? 200 : 404, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(c || { object: 'error' }) });
    }
    if (u.startsWith('https://cards.scryfall.io/')) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
    if (u.startsWith('file://')) return route.continue();
    return route.abort();
  });
  await page.addInitScript(([s, a, x]) => {
    window.__seed = s; window.__auth = a; Object.assign(window, x || {});
    // Most flows below read the whole card, so start cards open unless a test asks for the default.
    try { if (!window.__defaultCards) localStorage.setItem('pp.cards', 'open'); else localStorage.removeItem('pp.cards'); } catch (e) {}
  }, [seed, auth, extra]);
  await page.goto('file://' + path.resolve(OUT));
  return { page, errors, posts, ctx, geo };
}
const tab = (page, t) => page.click('#tabs button[data-tab=' + t + ']');
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
    await page.waitForSelector('article.night', { state: 'attached' });
    check('new organizer starts on the Me tab', await page.locator('#nick').isVisible() && (await page.locator('#welcome').isVisible()));
    await page.fill('#nick', 'Boss'); await page.click('#nickForm button[type=submit]');
    check('saving the profile goes to Games', await page.locator('#view-games').isVisible() && !(await page.locator('#view-me').isVisible()));
    check('organizers get an Organizer tab', await page.locator('#tabOrg').isVisible());
    await tab(page, 'organizer');
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
    await tab(page, 'games');
    check('waiting list shows Dana before block', (await page.locator('article.night', { hasText: 'Existing Night' }).innerText()).includes('Dana'));
    await tab(page, 'organizer');
    await prow().locator('button', { hasText: 'Block' }).click();
    await prow().locator('button', { hasText: 'Tap again to block' }).click();
    await page.waitForTimeout(100);
    s = await store(page);
    check('block saved by account id', s.config.settings.blocked.includes('other1'));
    await tab(page, 'games');
    check('blocked person hidden from the board', !(await page.locator('article.night', { hasText: 'Existing Night' }).innerText()).includes('Dana'));
    await tab(page, 'organizer');
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
    await page.waitForSelector('article.night', { state: 'attached' });
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
    await tab(page, 'pods');
    check('pods tab shows pods', await page.locator('#view-pods').isVisible() && !(await page.locator('#view-games').isVisible()));
    await page.click('.chip:has-text("Tuesday Commander")');
    await tab(page, 'games');
    check('needs-answer section and badge', (await page.locator('.grouphead').first().innerText()).toLowerCase() === 'needs your answer' && (await page.innerText('#badgeGames')) === '1');
    await card('Existing Night').getByRole('button', { name: "I'm in" }).click();
    check('answering clears the badge', await page.locator('#badgeGames').isHidden());
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

    // recurring game: every 2 weeks, 4 games
    await page.click('#callBtn');
    await page.fill('#nTitle', 'Weekly Test'); await page.fill('#nDate', plus(5));
    check('repeat options name the weekday', (await page.innerText('#optBiweekly')).startsWith('Every 2 weeks on ') && /Every month on the (1st|2nd|3rd|4th|last) /.test(await page.innerText('#optMonthly')));
    check('ends hidden until repeating', !(await page.isVisible('#endsFields')));
    await page.selectOption('#nRepeat', 'biweekly');
    check('ends shown when repeating', await page.isVisible('#endsFields'));
    await page.selectOption('#nEnds', 'until'); await page.fill('#nUntil', plus(1));
    await page.click('#nightSubmit');
    check('end date before start is refused', (await page.innerText('#toast')).includes('last date') && !(await store(page)).series);
    await page.selectOption('#nEnds', 'count'); await page.fill('#nCount', '4');
    await page.click('#nightSubmit');
    await page.waitForSelector('#announce:not([hidden])');
    s = await store(page);
    const ser = Object.entries(s.series || {}).find(([, x]) => x.title === 'Weekly Test');
    check('one recurring game stored, not copies', ser && ser[1].freq === 'biweekly' && ser[1].count === 4 && Object.values(s.nights).every((n) => n.title !== 'Weekly Test'));
    check('announcement describes the repeat', (await page.inputValue('#announceText')).includes('Every 2 weeks on') && (await page.inputValue('#announceText')).includes('4 games'));
    await page.click('#closeAnnounce');
    const sid = ser[0];
    check('creator is in for the first date', s.people.me1.res[sid + '_' + plus(5).replace(/-/g, '')] === 'yes');
    check('recurring game shows as one card', (await card('Weekly Test').count()) === 1);
    check('card lists its four dates', (await card('Weekly Test').locator('.datechip').count()) === 4);
    check('card says how it repeats', (await card('Weekly Test').locator('.meta').innerText()).includes('Every 2 weeks on'));
    await card('Weekly Test').locator('.datechip').nth(1).click();
    check('tapping a date switches the card', (await card('Weekly Test').locator('.datechip').nth(1).getAttribute('aria-pressed')) === 'true');
    await card('Weekly Test').getByRole('button', { name: 'Maybe' }).click();
    await page.waitForTimeout(150);
    s = await store(page);
    check('answers are per date', s.people.me1.res[sid + '_' + plus(19).replace(/-/g, '')] === 'maybe');
    check('date chip shows your answer', (await card('Weekly Test').locator('.datechip').nth(1).locator('.ans-maybe').count()) === 1);
    await card('Weekly Test').locator('button.link', { hasText: 'Skip this date' }).click();
    await card('Weekly Test').locator('button.link', { hasText: /tap again to skip/i }).click();
    await page.waitForTimeout(150);
    s = await store(page);
    check('skipping a date', (s.series[sid].skips || []).includes(plus(19)) && (await card('Weekly Test').locator('.datechip').count()) === 3);
    await card('Weekly Test').locator('button:has-text("Apple or Outlook")').click();
    const icsSeries = (await page.evaluate(() => window.__saved)).at(-1).text;
    check('calendar file repeats', icsSeries.includes('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4') && icsSeries.includes('DTSTART:' + plus(5).replace(/-/g, '')));
    check('Google Calendar link repeats', (await card('Weekly Test').locator('a:has-text("Google Calendar")').getAttribute('href')).includes('recur=RRULE'));

    // filters
    const heads = await page.locator('.grouphead').allInnerTexts();
    check('games grouped by when', heads.join().toLowerCase() === 'next 7 days', heads);
    await page.fill('#fSearch', 'weekly');
    check('search narrows the list', (await page.locator('article.night').count()) === 1 && (await page.innerText('#fCount')).startsWith('Showing 1 of 2'));
    await page.fill('#fSearch', 'nothing matches this');
    check('no-match state offers to clear', (await page.locator('.empty', { hasText: 'No games match' }).count()) === 1);
    await page.click('.empty button:has-text("Clear filters")');
    check('clear restores everything', (await page.locator('article.night').count()) === 2 && (await page.inputValue('#fSearch')) === '');
    await page.selectOption('#fPod', 'p2');
    check('pod filter', (await page.locator('article.night').count()) === 0);
    await page.selectOption('#fPod', 'p1');
    check('pod filter shows that pod', (await page.locator('article.night').count()) === 1 && (await card('Existing Night').count()) === 1);
    await page.selectOption('#fPod', 'all');
    check('format filter lists formats in use', (await page.locator('#fFormat option').allInnerTexts()).join() === 'Any format,Commander');
    await page.selectOption('#fFormat', 'Commander');
    check('format filter', (await page.locator('article.night').count()) === 2);
    await page.click('#fClear');

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

    await card('Weekly Test').locator('button.link', { hasText: 'Edit series' }).click();
    check('series edit form is prefilled', (await page.innerText('#formH')) === 'Edit recurring game' && (await page.inputValue('#nRepeat')) === 'biweekly' && (await page.inputValue('#nCount')) === '4');
    await page.selectOption('#nRepeat', 'weekly');
    await page.fill('#nPlace', 'New Place'); await page.click('#nightSubmit');
    await page.waitForSelector('#announce:not([hidden])');
    s = await store(page);
    check('series edit saved, skips kept', s.series[sid].place === 'New Place' && s.series[sid].freq === 'weekly' && s.series[sid].skips.includes(plus(19)));
    check('edit posts update', posts.some((p) => p.startsWith('Updated: Weekly Test')));
    await page.click('#closeAnnounce');
    await card('Weekly Test').locator('button.link', { hasText: 'End series' }).click();
    await card('Weekly Test').locator('button.link', { hasText: /tap again to end/i }).click();
    await page.waitForTimeout(150);
    check('ending a future series removes it', !(await store(page)).series[sid] && (await card('Weekly Test').count()) === 0);

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

  /* ===== pods: invite-only, Open Seats setting, invites, Discord helper ===== */
  {
    const seed = baseSeed();
    seed.people.me1 = { nick: 'Rob', pods: [], res: {} };
    seed.people.other1.pods = ['p1'];
    seed.links = { me1: { discordId: 'd1', name: 'robplays' } };
    const { page, errors, posts } = await open(browser, { state: 'ok', uid: 'me1', email: 'me@example.com', isAdmin: false }, seed, { __helper: true });
    await page.waitForSelector('article.night', { state: 'attached' });
    const helperCalls = () => page.evaluate(() => window.__helperCalls || []);
    // create an invite-only pod that keeps its nights in-house
    await tab(page, 'pods');
    await page.click('#addPodBtn');
    await page.fill('#podName', 'cEDH Sweats');
    await page.click('#podJoinSeg button[data-join=invite]');
    check('invite-only explains itself', (await page.innerText('#podJoinHint')).includes('Members invite people in'));
    await page.uncheck('#podOpenSeats');
    await page.click('#podSubmit');
    await page.waitForSelector('.chip:has-text("cEDH Sweats")');
    let s = await store(page);
    const podId = Object.keys(s.pods).find((k) => s.pods[k].name === 'cEDH Sweats');
    check('pod saved with its settings', s.pods[podId].join === 'invite' && s.pods[podId].openSeats === false && s.pods[podId].by === 'me1');
    check('creator joins their new pod', (s.people.me1.pods || []).includes(podId) && s.people.me1.joining === podId);
    check('invite-only pods show a badge', (await page.innerText('.chip:has-text("cEDH Sweats")')).includes('invite'));
    // edit it
    await page.locator('.chipwrap', { hasText: 'cEDH Sweats' }).locator('button.podedit').click();
    check('edit form is prefilled', (await page.inputValue('#podName')) === 'cEDH Sweats' && (await page.getAttribute('#podJoinSeg button[data-join=invite]', 'aria-pressed')) === 'true' && !(await page.isChecked('#podOpenSeats')));
    check('banner picker offers Auto plus seven patterns', (await page.locator('#podBannerPick button').count()) === 8 && (await page.getAttribute('#podBannerPick button:first-child', 'aria-pressed')) === 'true');
    await page.click('#podBannerPick button:has-text("Night")');
    await page.fill('#podName', 'cEDH Sweatshop'); await page.click('#podSubmit');
    await page.waitForSelector('.chip:has-text("cEDH Sweatshop")');
    // invite Dana
    await page.click('#inviteOpen');
    check('invite form offers the invite-only pod', (await page.locator('#invPod option').allInnerTexts()).join() === 'cEDH Sweatshop');
    check('invite form offers people not in it', (await page.locator('#invWho option').allInnerTexts()).sort().join() === 'Dana,Sam');
    await page.selectOption('#invWho', { label: 'Dana' });
    await page.click('#inviteForm button[type=submit]');
    await page.waitForTimeout(100);
    s = await store(page);
    check('invite stored with a predictable id', s.invites && s.invites[podId + '_other1'] && s.invites[podId + '_other1'].by === 'me1');
    // night for the open pod announces through the helper, not the webhook
    await tab(page, 'games');
    await page.click('#callBtn'); await page.fill('#nTitle', 'Helper Night');
    await page.check('#formPods label:has-text("Tuesday Commander") input');
    await page.click('#nightSubmit');
    await page.waitForSelector('#announce:not([hidden])');
    const calls1 = await helperCalls();
    check('announcement goes through the helper', calls1.some((c) => c[0] === '/announce' && c[1].kind === 'night' && c[1].ids.length === 1) && posts.length === 0);
    check('copy message still offered', (await page.innerText('#announceH')).includes('sent to Discord'));
    await page.click('#closeAnnounce');
    s = await store(page);
    check('chosen banner saved', s.pods[podId].banner === 'B');
    check('banner follows pod color by default', (await page.locator('article.night', { hasText: 'Helper Night' }).locator('.art').getAttribute('class')).includes('pat-G'));
    check('night shows it is an open table', (await page.locator('article.night', { hasText: 'Helper Night' }).locator('.meta').innerText()).includes('Open table'));
    // profile: Discord connected, Open Seats opt-in
    await page.click('.me-btn');
    check('profile shows the Discord link', (await page.innerText('#discordLinkRow')).includes('Connected as robplays'));
    await page.check('#openSeatsMe');
    await page.waitForTimeout(1500);
    s = await store(page);
    check('Open Seats opt-in saved', s.people.me1.openSeats === true);
    check('role sync requested after changes', (await helperCalls()).some((c) => c[0] === '/sync'));
    check('pods: no errors', errors.length === 0, errors);
    await page.context().close();
  }
  {
    // Dana: sees the invite, can't join the invite-only pod without it, accepts it
    const seed = baseSeed();
    seed.pods.p9 = { name: 'cEDH Sweatshop', mana: 'B', by: 'me1', join: 'invite', openSeats: false };
    seed.pods.p8 = { name: 'Secret Club', mana: 'U', by: 'me1', join: 'invite' };
    seed.invites = { p9_other1: { podId: 'p9', uid: 'other1', by: 'old1', at: 1 } };
    const { page, errors } = await open(browser, { state: 'ok', uid: 'other1', email: 'dana@example.com', isAdmin: false }, seed, { __helper: true });
    await page.waitForSelector('article.night', { state: 'attached' });
    check('pods tab badge counts the invite', (await page.innerText('#badgePods')) === '1');
    await tab(page, 'pods');
    check('invitation banner shown', (await page.innerText('#invites')).includes('Sam invited you to cEDH Sweatshop'));
    await page.click('.chip:has-text("Secret Club")');
    check('cannot join an invite-only pod without an invite', (await page.innerText('#toast')).includes('invite only') && !((await store(page)).people.other1.pods || []).includes('p8'));
    await page.click('#invites button:has-text("Join pod")');
    await page.waitForTimeout(100);
    const s = await store(page);
    check('accepting joins the pod', s.people.other1.pods.includes('p9') && s.people.other1.joining === 'p9');
    check('banner disappears after joining', (await page.locator('#invites .invite').count()) === 0);
    await page.click('.me-btn');
    await page.click('#connectDiscord');
    await page.waitForFunction(() => !!window.__went);
    check('Connect Discord sends you to Discord', (await page.evaluate(() => window.__went)).startsWith('https://discord.com/oauth2/authorize'));
    check('invitee: no errors', errors.length === 0, errors);
    await page.context().close();
  }

  /* ===== open-mode guest: can use the board, cannot read the webhook ===== */
  {
    const seed = withDiscord(baseSeed());
    seed.config.settings = { open: true, blocked: [] };
    const { page, errors, posts } = await open(browser, { state: 'ok', uid: 'g1', email: 'guest@example.com', isAdmin: false }, seed, { __denyDocs: ['config/discord'] });
    await page.waitForSelector('article.night', { state: 'attached' });
    await page.fill('#nick', 'Guest'); await page.click('#nickForm button[type=submit]');
    await page.click('#callBtn'); await page.fill('#nTitle', 'Guest Night'); await page.click('#nightSubmit');
    await page.waitForSelector('#announce:not([hidden])');
    check('guest: night posts without the webhook', posts.length === 0 && (await page.innerText('#announceH')) === 'Night posted');
    check('guest: copy message offered instead', (await page.inputValue('#announceText')).startsWith('New game night: Guest Night'));
    check('guest: no organizer tools', !(await page.locator('#membersSec').isVisible()));
    check('guest: no errors', errors.length === 0, errors);
    await page.context().close();
  }

  /* ===== places: address, directions, area, distance ===== */
  {
    const seed = withDiscord(baseSeed());
    seed.people.me1 = { nick: 'Rob', pods: ['p1'], res: { n1: 'yes' } };
    const { page, errors, posts, geo, ctx } = await open(browser, { state: 'ok', uid: 'me1', email: 'me@example.com', isAdmin: false }, seed);
    await page.waitForSelector('article.night');
    const card = (t) => page.locator('article.night', { hasText: t });
    await tab(page, 'me');
    await page.fill('#area', '43017');
    await page.click('#nickForm button[type=submit]');
    await page.waitForFunction(() => window.__store.people.me1.area === '43017');
    let s = await store(page);
    check('area saved as a rough point', s.people.me1.alat === 40.1 && s.people.me1.alng === -83.11, s.people.me1);
    check('ZIP looked up as a US postal code', geo.some((u) => u.includes('countrycodes=us&postalcode=43017')));
    await page.click('#callBtn');
    await page.fill('#nTitle', 'Brewery Night'); await page.fill('#nDate', plus(2));
    await page.fill('#nPlace', 'Rogue Brewing'); await page.fill('#nAddress', '123 Main St, Columbus, OH');
    await page.click('#nightSubmit');
    await page.waitForSelector('#announce:not([hidden])');
    s = await store(page);
    const bn = Object.values(s.nights).find((n) => n.title === 'Brewery Night');
    check('night saves address and map point', bn.address === '123 Main St, Columbus, OH' && bn.lat === 39.9612 && bn.lng === -82.9988, bn);
    check('Discord message leaves the address out', posts.some((p) => p.startsWith('New game night: Brewery Night')) && !posts.some((p) => p.includes('Main St')), posts);
    await page.click('#closeAnnounce');
    const dist = await card('Brewery Night').locator('.distchip').innerText();
    check('card shows rough distance', /^1\d(\.\d)? mi$/.test(dist), dist);
    check('address opens directions', (await card('Brewery Night').locator('a.addr').getAttribute('href')).startsWith('https://www.google.com/maps/dir/?api=1&destination=123%20Main%20St'));
    check('calendar location includes the address', decodeURIComponent(await card('Brewery Night').locator('a:has-text("Google Calendar")').getAttribute('href')).includes('location=Rogue Brewing, 123 Main St, Columbus, OH'));
    check('no distance without an address', (await card('Existing Night').locator('.distchip').count()) === 0);
    const before = geo.length;
    await card('Brewery Night').locator('button.link', { hasText: 'Edit' }).first().click();
    check('edit form keeps the address', (await page.inputValue('#nAddress')) === '123 Main St, Columbus, OH');
    await page.fill('#nHost', 'Dan'); await page.click('#nightSubmit');
    await page.waitForFunction(() => Object.values(window.__store.nights).some((n) => n.host === 'Dan'));
    check('unchanged address is not looked up again', geo.length === before && Object.values((await store(page)).nights).find((n) => n.title === 'Brewery Night').lat === 39.9612);
    await page.waitForTimeout(100);
    if (await page.isVisible('#closeAnnounce')) await page.click('#closeAnnounce');
    await page.click('#callBtn');
    await page.fill('#nTitle', 'Mystery Night'); await page.fill('#nAddress', 'Nowhere at all');
    await page.click('#nightSubmit');
    await page.waitForFunction(() => Object.values(window.__store.nights).some((n) => n.title === 'Mystery Night'));
    s = await store(page);
    const mn = Object.values(s.nights).find((n) => n.title === 'Mystery Night');
    check('unknown address still saves, without a point', mn.address === 'Nowhere at all' && mn.lat == null);
    check('search finds games by address', await (async () => { await page.click('#closeAnnounce').catch(() => {}); await page.fill('#fSearch', 'columbus'); return (await page.locator('article.night').count()) === 1; })());
    await page.fill('#fSearch', '');
    await ctx.grantPermissions(['geolocation']); await ctx.setGeolocation({ latitude: 39.962, longitude: -82.999 });
    await tab(page, 'me'); await page.click('#hereBtn');
    await page.waitForSelector('#hereNote:has-text("Not saved")');
    await tab(page, 'games');
    check('current location: distance from here, not saved', (await card('Brewery Night').locator('.distchip').innerText()) === 'Under 1 mi' && !('lat' in (await store(page)).people.me1));
    await page.screenshot({ path: path.join(SHOTS, 'shot-places.png'), fullPage: false });
    check('places: no errors', errors.length === 0, errors);
    await page.context().close();
  }

  /* ===== decks: profile decklists, bringing decks, brackets, commander art ===== */
  {
    const seed = baseSeed();
    seed.nights.n1.bracket = 3; seed.nights.n1.min = 4;
    seed.nights.n2 = { title: 'Draft Night', date: plus(4), time: '18:00', format: 'Draft', min: 4, podIds: [], by: 'x', at: 2 };
    seed.people.me1 = { nick: 'Rob', pods: ['p1'], res: { n1: 'yes', n2: 'yes' } };
    seed.people.old1.decks = [{ id: 'z1', name: 'Sneaky', url: 'javascript:alert(1)', art: 'https://evil.example.com/x.png', b: 2 }];
    seed.people.old1.dk = { n1: ['z1'] };
    const { page, errors } = await open(browser, { state: 'ok', uid: 'me1', email: 'me@example.com', isAdmin: false }, seed);
    await page.waitForSelector('article.night');
    const card = (t) => page.locator('article.night', { hasText: t });
    check('no decks yet: card points to the Me tab', (await card('Existing Night').locator('.deckpick').innerText()).includes('Me tab'));
    await tab(page, 'me');
    await page.click('#addDeckBtn');
    await page.fill('#dName', 'Superfriends'); await page.fill('#dCmd', 'atraxa'); await page.selectOption('#dBracket', '4'); await page.fill('#dUrl', 'moxfield.com/decks/abc123');
    await page.click('#deckSave');
    await page.waitForFunction(() => (window.__store.people.me1.decks || []).length === 1);
    let s = await store(page);
    const d1 = s.people.me1.decks[0];
    check('deck saved with commander, art, artist and a safe link', d1.cmd === "Atraxa, Praetors' Voice" && d1.art.startsWith('https://cards.scryfall.io/art_crop/') && d1.artist === 'Victor Adame Minguez' && d1.url === 'https://moxfield.com/decks/abc123' && d1.b === 4, d1);
    await page.click('#addDeckBtn');
    await page.fill('#dName', 'Goblins'); await page.fill('#dCmd', 'krenko'); await page.selectOption('#dBracket', '2');
    await page.click('#deckSave');
    await page.waitForFunction(() => (window.__store.people.me1.decks || []).length === 2);
    check('double-faced style art found', (await store(page)).people.me1.decks[1].artist === 'Karl Kopinski');
    await page.click('#addDeckBtn');
    await page.fill('#dName', 'Mystery'); await page.fill('#dCmd', 'nobody at all');
    await page.click('#deckSave');
    await page.waitForFunction(() => (window.__store.people.me1.decks || []).length === 3);
    check('unknown commander saves without art', !(await store(page)).people.me1.decks[2].art && (await page.innerText('#toast')).includes("Couldn't find that commander"));
    check('deck list shows art and bracket', (await page.locator('#deckList .deckrow').count()) === 3 && (await page.locator('#deckList .dart:not(.none)').count()) === 2 && (await page.innerText('#deckList')).includes('Bracket 4 · Optimized'));
    await page.locator('#deckList .deckrow', { hasText: 'Mystery' }).locator('button', { hasText: 'Edit' }).click();
    await page.click('#deckDelete'); await page.click('#deckDelete');
    await page.waitForFunction(() => window.__store.people.me1.decks.length === 2);
    check('remove a deck (two taps)', true);
    await tab(page, 'games');
    const c1 = card('Existing Night');
    check('bracket limit shown on the card', (await c1.locator('.typeline').innerText()).includes('Bracket 3 or lower'));
    check('deck over the limit flagged red, not blocked', (await c1.locator('.deckchip', { hasText: 'Superfriends' }).getAttribute('class')).includes('over') && !(await c1.locator('.deckchip', { hasText: 'Goblins' }).getAttribute('class')).includes('over'));
    await c1.locator('.deckchip', { hasText: 'Superfriends' }).click();
    await page.waitForFunction(() => (window.__store.people.me1.dk || {}).n1);
    check('bringing a deck is saved per game', JSON.stringify((await store(page)).people.me1.dk.n1) === JSON.stringify([d1.id]));
    const mySeat = c1.locator('.seat.yes[title^="Rob"]');
    check('seat shows commander art', (await mySeat.getAttribute('class')).includes('hasart') && (await mySeat.evaluate((e) => e.style.backgroundImage)).includes('cards.scryfall.io'));
    check('seat ringed red when over the limit', (await mySeat.getAttribute('class')).includes('over'));
    check('artist credited on the card', (await c1.locator('.artcredit').innerText()) === 'Art: Victor Adame Minguez');
    check('decks listed in details, over limit marked', (await c1.locator('.roster .decks').innerText()).includes('Superfriends') && (await c1.locator('.roster .decks .over').count()) === 1);
    const sam = c1.locator('.seat.yes[title^="Sam"]');
    check('unsafe art from another player is ignored', !(await sam.getAttribute('class')).includes('hasart'));
    check('unsafe deck link is not a link', (await c1.locator('.roster .decks a', { hasText: 'Sneaky' }).count()) === 0 && (await c1.locator('.roster .decks').innerText()).includes('Sneaky'));
    check('Draft night hides brackets', (await card('Draft Night').locator('.deckchip').count()) === 2 && (await card('Draft Night').locator('.bchip').count()) === 0 && !(await card('Draft Night').locator('.typeline').innerText()).includes('Bracket'));
    await page.click('#callBtn');
    check('bracket limit offered for Commander', await page.isVisible('#nBracket'));
    await page.selectOption('#nFormat', 'Draft');
    check('bracket limit hidden for Draft', !(await page.isVisible('#nBracket')));
    await page.selectOption('#nFormat', 'Commander'); await page.selectOption('#nBracket', '2');
    await page.fill('#nTitle', 'Low Power Night'); await page.click('#nightSubmit');
    await page.waitForFunction(() => Object.values(window.__store.nights).some((n) => n.title === 'Low Power Night'));
    check('night saves its bracket limit', Object.values((await store(page)).nights).find((n) => n.title === 'Low Power Night').bracket === 2);
    await page.click('#closeAnnounce');
    await page.screenshot({ path: path.join(SHOTS, 'shot-decks.png'), fullPage: true });
    // Scryfall answers 404 for an unknown commander; the browser logs that, and the app handles it.
    check('decks: no errors', errors.filter((e) => !e.includes('status of 404')).length === 0, errors);
    await page.context().close();
  }

  /* ===== phone layout: tabs, compact cards, the sheet ===== */
  {
    const seed = baseSeed();
    seed.people.me1 = { nick: 'Rob', pods: ['p1'], res: {} };
    seed.polls = { q1: { title: 'Pick a Date', format: 'Commander', min: 4, podIds: [], by: 'old1', at: 1, options: [{ id: 'a', date: plus(4), time: '19:00' }, { id: 'b', date: plus(5), time: '19:00' }] } };
    seed.nights.n2 = { title: 'Far Night', date: plus(30), time: '18:00', format: 'Draft', min: 4, podIds: ['p1'], by: 'x', at: 2 };
    const { page, errors } = await open(browser, { state: 'ok', uid: 'me1', email: 'me@example.com', isAdmin: false }, seed, { __defaultCards: true }, { width: 390, height: 844 });
    await page.waitForSelector('article.night');
    const bar = await page.locator('#tabs').boundingBox();
    check('phone: tab bar sits at the bottom', bar && Math.abs(bar.y + bar.height - 844) < 2, bar);
    check('phone: no Organizer tab for members', await page.locator('#tabOrg').isHidden());
    check('phone: badge counts the night and the poll', (await page.innerText('#badgeGames')) === '2');
    check('phone: poll says it needs your vote', (await page.innerText('article.poll .cost')) === 'Needs your vote');
    check('phone: a game 30 days out is not nagged about', (await page.locator('.grouphead').allInnerTexts()).map((x) => x.toLowerCase()).join() === 'needs your answer,later');
    const c1 = page.locator('article.night', { hasText: 'Existing Night' });
    check('phone: cards start compact', (await c1.getAttribute('class')).includes('compact') && await c1.locator('.roster').isHidden() && await c1.locator('.rsvp').isVisible());
    await c1.locator('button.more').click();
    check('phone: Details opens one card', await c1.locator('.roster').isVisible() && (await c1.locator('button.more').innerText()) === 'Less'
      && (await page.locator('article.night', { hasText: 'Far Night' }).getAttribute('class')).includes('compact'));
    await page.screenshot({ path: path.join(SHOTS, 'shot-phone.png'), fullPage: false });
    await page.click('#callBtn');
    check('phone: Call a night opens a sheet', await page.locator('#nightForm').isVisible() && await page.locator('#sheetBackdrop').isVisible());
    const sb = await page.locator('#nightSubmit').boundingBox();
    check('phone: Post button visible without scrolling', sb && sb.y + sb.height <= 844 && sb.y > 0, sb);
    await page.screenshot({ path: path.join(SHOTS, 'shot-sheet.png'), fullPage: false });
    await page.keyboard.press('Escape');
    check('phone: Escape closes the sheet', await page.locator('#nightForm').isHidden() && await page.locator('#sheetBackdrop').isHidden());
    await page.click('#callBtn'); await page.click('#sheetBackdrop', { position: { x: 10, y: 10 } });
    check('phone: tapping outside closes it', await page.locator('#nightForm').isHidden());
    await tab(page, 'me');
    check('phone: Me tab in the address', (await page.evaluate(() => location.hash)) === '#me' && await page.locator('#nick').isVisible() && (await page.inputValue('#nick')) === 'Rob');
    await page.click('#cardsSeg button[data-cards=open]');
    check('phone: card setting saved on this device', (await page.evaluate(() => localStorage.getItem('pp.cards'))) === 'open');
    await page.goBack();
    check('phone: back button returns to Games', await page.locator('#view-games').isVisible());
    check('phone: cards now start open', !(await page.locator('article.night', { hasText: 'Far Night' }).getAttribute('class')).includes('compact'));
    await page.reload(); await page.waitForSelector('article.night');
    check('phone: reload keeps the tab', await page.locator('#view-games').isVisible());
    await page.click('.me-btn');
    check('phone: name chip opens Me', await page.locator('#view-me').isVisible());
    check('phone layout: no errors', errors.length === 0, errors);
    await page.context().close();
  }
  {
    // a new person who tries to call a night is asked for their name first
    const { page } = await open(browser, { state: 'ok', uid: 'n1', email: 'new@example.com', isAdmin: false }, baseSeed());
    await page.waitForSelector('#nick');
    await tab(page, 'games');
    await page.click('#callBtn');
    check('no name yet: Call a night goes to Me', await page.locator('#view-me').isVisible() && await page.locator('#nightForm').isHidden());
    check('no name yet: no Cancel button to skip it', await page.locator('#nickCancel').isHidden());
    await page.context().close();
  }

  /* ===== wide screen: tabs on top, open cards, two per row, centered dialog ===== */
  {
    const seed = baseSeed();
    seed.people.me1 = { nick: 'Rob', pods: ['p1'], res: { n1: 'yes', n2: 'no' } };
    seed.nights.n2 = { title: 'Second Night', date: plus(4), time: '18:00', format: 'Draft', min: 4, podIds: ['p1'], by: 'x', at: 2 };
    const { page, errors } = await open(browser, { state: 'ok', uid: 'me1', email: 'me@example.com', isAdmin: true }, seed, { __defaultCards: true }, { width: 1280, height: 900 });
    await page.waitForSelector('article.night');
    const bar = await page.locator('#tabs').boundingBox();
    check('desktop: tabs along the top', bar && bar.y < 300 && bar.height < 70, bar);
    check('desktop: organizer tab shown', await page.locator('#tabOrg').isVisible());
    check('desktop: cards start open', !(await page.locator('article.night').first().getAttribute('class')).includes('compact'));
    const b1 = await page.locator('article.night').nth(0).boundingBox(), b2 = await page.locator('article.night').nth(1).boundingBox();
    check('desktop: two games per row', Math.abs(b1.y - b2.y) < 2 && b2.x > b1.x + 200, [b1, b2]);
    await page.screenshot({ path: path.join(SHOTS, 'shot-desktop.png'), fullPage: false });
    await page.click('#callBtn');
    const d = await page.locator('#nightForm').boundingBox();
    check('desktop: Call a night is a centered dialog', d && Math.abs(d.x + d.width / 2 - 640) < 3 && d.width <= 640 && d.y > 10, d);
    await page.screenshot({ path: path.join(SHOTS, 'shot-dialog.png'), fullPage: false });
    await page.click('#sheetClose');
    await tab(page, 'organizer');
    check('desktop: organizer tools on their own tab', await page.locator('#membersSec').isVisible() && await page.locator('#view-games').isHidden());
    check('desktop: no errors', errors.length === 0, errors);
    await page.context().close();
  }

  await browser.close();
  const failed = results.filter((r) => !r[0]).length;
  console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
  process.exit(failed ? 1 : 0);
})();
