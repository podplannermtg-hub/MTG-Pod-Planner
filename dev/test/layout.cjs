// Renders every screen at phone and tablet widths, reports anything that overflows its container
// or the page, and saves screenshots for a visual check.
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.argv[2];
const SHOTS = path.resolve(OUT, '..', 'layout');
require('fs').mkdirSync(SHOTS, { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const seed = () => ({
  pods: { p1: { name: 'Tuesday Commander', mana: 'G', by: 'x' }, p2: { name: 'Shop Draft Crew', mana: 'R', by: 'x' }, p3: { name: 'cEDH Sweats', mana: 'B', by: 'x', join: 'invite', openSeats: false }, p4: { name: 'Friday Night Magic Regulars', mana: 'W', by: 'me1', join: 'invite' } },
  nights: {
    n1: { title: 'Thursday Commander', bracket: 3, region: 'Lower Bucks', date: plus(2), time: '19:00', place: "Dan's place on Elm Street", address: '1234 Longname Boulevard Northwest, Upper Arlington, OH 43221', lat: 40.0257, lng: -83.0623, host: 'Dan', format: 'Commander', min: 4, podIds: ['p1'], note: 'Bring a deck at power level 7. Pizza on me.', by: 'me1' },
    n2: { title: 'Saturday Booster Draft at the Shop', date: plus(4), time: '14:00', place: 'The local game shop', format: 'Draft', min: 8, podIds: ['p1', 'p2'], by: 'x', series: 's1' },
    n3: { title: 'Open Night', date: plus(6), time: '', format: 'Pauper', min: 2, podIds: [], by: 'x' }
  },
  series: { s1: { title: 'Every Other Thursday Commander League', date: plus(3), time: '19:00', format: 'Commander', min: 4, podIds: ['p1'], freq: 'biweekly', skips: [], by: 'me1', at: 1 } },
  polls: { q1: { title: 'Next Tuesday Commander', format: 'Commander', min: 4, place: "Dan's place", host: 'Dan', podIds: ['p1'], note: 'Vote for every date you can make.',
    options: [{ id: 'o0', date: plus(9), time: '19:00' }, { id: 'o1', date: plus(10), time: '19:00' }, { id: 'o2', date: plus(11), time: '14:00' }], by: 'me1', at: 1 } },
  people: {
    me1: { nick: 'Rob', area: 'Dublin, OH', alat: 40.1, alng: -83.11, decks: [{ id: 'd1', name: 'Superfriends Planeswalker Tribal', cmd: "Atraxa, Praetors' Voice", b: 4, url: 'https://moxfield.com/decks/abc', art: 'https://cards.scryfall.io/art_crop/front/a/1.jpg', artist: 'Victor Adame Minguez' }, { id: 'd2', name: 'Goblins', cmd: 'Krenko, Mob Boss', b: 2, art: 'https://cards.scryfall.io/art_crop/front/a/2.jpg', artist: 'Karl Kopinski' }], dk: { n1: ['d1', 'd2'] }, ci: 'UR', pods: ['p1', 'p2', 'pp1'], res: { n1: 'yes', n2: 'maybe' }, bring: { n1: 'Chips and a spare playmat' }, pv: { q1: { o0: 'yes' } } },
    a: { nick: 'Samantha', ci: 'RG', pods: ['p1'], res: { n1: 'yes', n2: 'yes' }, pv: { q1: { o0: 'yes', o1: 'yes' } } },
    b: { nick: 'Dana', ci: 'WU', pods: ['p1'], res: { n1: 'maybe' }, pv: { q1: { o1: 'yes', o2: 'maybe' } } },
    c: { nick: 'Lee', ci: 'B', pods: ['p1', 'p2'], res: { n1: 'no' } },
    d: { nick: 'Marcus the Magnificent', ci: 'WBG', pods: ['p1', 'p2', 'p3'], res: {} },
    e: { nick: 'Priya', ci: 'WUBRG', pods: ['p2'], res: { n2: 'yes' } }
  },
  config: { members: { emails: ['dana@example.com', 'a.really.long.email.address@example.com'], admins: [] }, discord: { webhook: 'https://discord.com/api/webhooks/1/x', ping: '' } },
  invites: { p3_me1: { podId: 'p3', uid: 'me1', by: 'a', at: 1 } },
  privpods: { pp1: { name: 'Secret Sweats', mana: 'B', by: 'a', join: 'invite', openSeats: false } },
  'privpods/pp1/nights': { x1: { title: 'Private Pod Night', date: plus(3), time: '20:00', format: 'Commander', min: 4, podIds: ['pp1'], by: 'a', region: 'North Jersey', addrIn: true, address: '' } },
  links: { me1: { discordId: 'd1', name: 'robplays' } },
  requests: { r1: { email: 'zed.with.a.long.address@example.com', name: 'Zed', at: 1 } }
});

// Elements whose right edge pokes outside their nearest clipping/containing card, or outside the viewport.
const probe = () => {
  const vw = document.documentElement.clientWidth, issues = [];
  if (document.documentElement.scrollWidth > vw + 1) issues.push('page scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + vw);
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const label = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' "' + (el.textContent || '').trim().slice(0, 30) + '"';
  document.querySelectorAll('#app *, #nightForm *').forEach((el) => {
    if (!vis(el) || el.closest('[hidden]')) return;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 0.5 || r.left < -0.5) issues.push('outside viewport: ' + label(el) + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
    const box = el.parentElement && el.parentElement.closest('.card-in,.panel,.textbox,.titlebar,.typeline,.art,.opt,.rsvp,.mrow');
    if (box && box !== el) {
      const b = box.getBoundingClientRect(), cs = getComputedStyle(box);
      const innerR = b.right - parseFloat(cs.borderRightWidth) + 0.5, innerL = b.left + parseFloat(cs.borderLeftWidth) - 0.5;
      if (r.right > innerR || r.left < innerL) issues.push('overflows ' + label(box).slice(0, 40) + ': ' + label(el));
    }
    // text that is clipped inside its own box
    if ((el.scrollWidth > el.clientWidth + 1) && getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 0 && el.children.length === 0 && !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))
      issues.push('text wider than its box: ' + label(el));
  });
  // buttons in a row should share a baseline/height
  document.querySelectorAll('.rsvp,.votes').forEach((row) => {
    const hs = [...row.children].filter(vis).map((c) => Math.round(c.getBoundingClientRect().height));
    if (new Set(hs).size > 1) issues.push('uneven button heights in ' + row.className + ': ' + hs.join('/'));
  });
  // small tap targets
  document.querySelectorAll('#app button, #app a, #app select, #nightForm button, #nightForm select').forEach((b) => {
    if (!vis(b) || b.closest('[hidden]')) return;
    const r = b.getBoundingClientRect();
    if (r.height < 24 || r.width < 24) issues.push('small tap target ' + Math.round(r.width) + 'x' + Math.round(r.height) + ': ' + label(b));
  });
  return [...new Set(issues)];
};

(async () => {
  const browser = await chromium.launch();
  const widths = [320, 375, 414, 768, 1024, 1440];
  let total = 0;
  for (const scheme of ['light', 'dark']) {
    for (const w of widths) {
      for (const scenario of ['board', 'compact', 'nameform', 'podform', 'tools', 'sheet', 'signin']) {
        if (scheme === 'dark' && w !== 375 && w !== 1440) continue;
        const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme, deviceScaleFactor: w <= 414 ? 2 : 1, hasTouch: w <= 414 });
        const page = await ctx.newPage();
        await page.route('**/*', (r) => r.request().url().startsWith('https://cards.scryfall.io/') ? r.fulfill({ status: 200, contentType: 'image/png', body: require('fs').readFileSync(path.join(__dirname, 'art.png')) }) : r.request().url().startsWith('file://') ? r.continue() : r.abort());
        const auth = scenario === 'signin' ? { state: 'signedout' } : { state: 'ok', uid: 'me1', email: 'me@example.com', isAdmin: scenario === 'tools' };
        await page.addInitScript(([s, a, c]) => { window.__seed = s; window.__auth = a; window.__helper = true; try { if (c) localStorage.removeItem('pp.cards'); else localStorage.setItem('pp.cards', 'open'); } catch (e) {} }, [seed(), auth, scenario === 'compact']);
        await page.goto('file://' + path.resolve(OUT));
        if (scenario === 'signin') await page.waitForSelector('#googleBtn');
        else await page.waitForSelector('article.night', { state: 'attached' });
        if (scenario === 'nameform') { await page.click('.me-btn'); await page.waitForSelector('#nickForm:visible'); }
        if (scenario === 'podform') { await page.click('#tabs button[data-tab=pods]'); await page.locator('.chipwrap', { hasText: 'Friday Night' }).locator('button.podedit').click(); await page.click('#inviteOpen'); }
        if (scenario === 'sheet') { await page.click('#callBtn'); await page.waitForSelector('#nightForm:visible'); }
        if (scenario === 'tools') { await page.click('#tabs button[data-tab=organizer]'); await page.waitForSelector('#membersSec:not([hidden]) #requests .mrow'); await page.locator('#membersSec').scrollIntoViewIfNeeded(); }
        const issues = await page.evaluate(probe);
        total += issues.length;
        const tag = scheme + '-' + w + '-' + scenario;
        console.log((issues.length ? 'ISSUES ' : 'ok     ') + tag + (issues.length ? '\n   - ' + issues.join('\n   - ') : ''));
        await page.screenshot({ path: path.join(SHOTS, tag + '.png'), fullPage: scenario !== 'sheet' });
        await ctx.close();
      }
    }
  }
  await browser.close();
  console.log(total ? total + ' ISSUES' : 'NO LAYOUT ISSUES');
})();
