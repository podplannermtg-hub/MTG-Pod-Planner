// End-to-end test of helper/worker.js with fake Firebase, Google and Discord.
// Usage: node test/helper.mjs path/to/worker.mjs
import { webcrypto } from 'node:crypto';
const subtle = webcrypto.subtle;
const worker = (await import(process.argv[2])).default;

const results = [];
const check = (name, ok, extra) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); };
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// ---- keys: one for Firebase ID tokens, one for the service account
const idKey = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const idJwk = Object.assign(await subtle.exportKey('jwk', idKey.publicKey), { kid: 'k1', use: 'sig', alg: 'RS256' });
const saKey = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const saPem = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await subtle.exportKey('pkcs8', saKey.privateKey)).toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
async function idToken(sub, email, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
  const c = b64u(JSON.stringify(Object.assign({ aud: 'demo', iss: 'https://securetoken.google.com/demo', sub, email, email_verified: true, iat: now, exp: now + 3600 }, extra)));
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', idKey.privateKey, new TextEncoder().encode(h + '.' + c));
  return h + '.' + c + '.' + b64u(sig);
}

const env = {
  APP_URL: 'https://pods.example.github.io/MTG-Pod-Planner/', OWNER_EMAIL: 'owner@example.com',
  DISCORD_CLIENT_ID: 'cid', DISCORD_CLIENT_SECRET: 'csecret', DISCORD_BOT_TOKEN: 'bot', DISCORD_GUILD_ID: 'g1', DISCORD_CHANNEL_ID: 'c1',
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'demo', client_email: 'helper@demo.iam.gserviceaccount.com', private_key: saPem, token_uri: 'https://oauth2.googleapis.com/token' }),
  STATE_SECRET: 'a-long-random-secret-for-tests', TIMEZONE: 'UTC', REMIND_DAYS: '1'
};

// ---- fake Firestore
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const db = new Map(Object.entries({
  'config/members': { emails: ['rob@example.com', 'dana@example.com'], admins: [] },
  'config/settings': { open: false, blocked: [] },
  'pods/p1': { name: 'Tuesday Commander', mana: 'G', by: 'u1', join: 'open', openSeats: true },
  'pods/p2': { name: 'cEDH Sweats', mana: 'B', by: 'u2', join: 'invite', openSeats: false },
  'people/u1': { nick: 'Rob', pods: ['p1'], openSeats: true, res: {} },
  'people/u2': { nick: 'Dana', pods: ['p2'], res: {} },
  'nights/n1': { title: 'Thursday Commander', date: day(1), time: '19:00', place: "Dan's", format: 'Commander', min: 4, podIds: ['p1'], by: 'u1', at: Date.now() },
  'nights/n2': { title: 'cEDH Night', date: day(1), time: '20:00', format: 'cEDH', min: 4, podIds: ['p2'], by: 'u2', at: Date.now() },
  'nights/n3': { title: 'Duel', date: day(1), time: '18:00', format: 'Commander', min: 2, podIds: ['p1'], by: 'u1', at: Date.now() },
  'nights/n4': { title: 'Store Night', date: day(5), time: '18:00', format: 'Draft', min: 8, podIds: [], by: 'u1', at: Date.now() },
  'series/s1': { title: 'Fortnightly', date: day(1), time: '19:30', format: 'Commander', min: 4, podIds: ['p1'], freq: 'biweekly', skips: [], by: 'u1', at: 1 },
  'polls/q1': { title: 'Next Tuesday', format: 'Commander', min: 4, podIds: ['p1'], options: [{ id: 'o0', date: day(8), time: '19:00' }], by: 'u1' }
}));
const enc = (v) => v === null ? { nullValue: null } : typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? { integerValue: String(v) } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: encF(v) } };
const encF = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));
const dec = (v) => 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null
  : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec) : 'mapValue' in v ? decF(v.mapValue.fields || {}) : null;
const decF = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, dec(v)]));
const docOut = (path) => ({ name: 'projects/demo/databases/(default)/documents/' + path, fields: encF(db.get(path)) });

// ---- fake Discord
const roles = new Map([['everyone', { id: 'g1', name: '@everyone', color: 0 }]]);
const members = new Map([['d2', new Set()]]); // Dana is already in the server
const messages = []; let roleSeq = 100; const calls = [];
const channels = new Map([['c1', { id: 'c1', name: 'game-nights', type: 0, parent_id: 'cat1', permission_overwrites: [] }]]);
const privMessages = []; let chSeq = 0;

let saTokens = 0;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const method = init.method || 'GET';
  const res = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://www.googleapis.com/service_accounts/')) return res(200, { keys: [idJwk] });
  if (url === 'https://oauth2.googleapis.com/token') {
    const a = new URLSearchParams(init.body).get('assertion').split('.');
    const ok = await subtle.verify('RSASSA-PKCS1-v1_5', saKey.publicKey, Buffer.from(a[2], 'base64url'), new TextEncoder().encode(a[0] + '.' + a[1]));
    if (!ok) return res(400, { error: 'bad sig' });
    saTokens++; return res(200, { access_token: 'sa-token', expires_in: 3600 });
  }
  if (url.startsWith('https://firestore.googleapis.com/')) {
    if ((init.headers || {}).Authorization !== 'Bearer sa-token') return res(403, {});
    const rest = decodeURIComponent(url.split('/documents/')[1]); const [path, query] = rest.split('?');
    const segs = path.split('/');
    if (method === 'GET' && segs.length % 2 === 1) return res(200, { documents: [...db.keys()].filter((k) => k.split('/').length === segs.length + 1 && k.startsWith(path + '/')).map(docOut) });
    if (method === 'GET') return db.has(path) ? res(200, docOut(path)) : res(404, {});
    if (method === 'DELETE') { db.delete(path); return res(200, {}); }
    if (method === 'PATCH') {
      const mask = new URLSearchParams(query || '').getAll('updateMask.fieldPaths');
      if (new URLSearchParams(query || '').get('currentDocument.exists') === 'true' && !db.has(path)) return res(404, {});
      const incoming = decF(JSON.parse(init.body).fields || {});
      const cur = Object.assign({}, db.get(path) || {});
      (mask.length ? mask : Object.keys(incoming)).forEach((k) => { cur[k] = incoming[k]; });
      db.set(path, cur); return res(200, docOut(path));
    }
  }
  if (url.startsWith('https://discord.com/api/v10/')) {
    const p = url.slice('https://discord.com/api/v10'.length); const body = init.body ? (typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body) : null;
    calls.push(method + ' ' + p);
    if (p === '/oauth2/token') return new URLSearchParams(init.body).get('code') === 'good' ? res(200, { access_token: 'user-at' }) : res(400, {});
    if (p === '/users/@me') return res(200, { id: 'd1', username: 'robplays', global_name: 'Rob' });
    if ((init.headers || {}).Authorization !== 'Bot bot') return res(401, {});
    let m;
    if (p === '/guilds/g1/roles' && method === 'GET') return res(200, [...roles.values()]);
    if (p === '/guilds/g1/roles' && method === 'POST') { const r = Object.assign({ id: 'r' + (++roleSeq) }, body); roles.set(r.id, r); return res(200, r); }
    if ((m = p.match(/^\/guilds\/g1\/roles\/(\w+)$/))) { if (method === 'DELETE') { roles.delete(m[1]); members.forEach((set) => set.delete(m[1])); return res(204); } Object.assign(roles.get(m[1]), body); return res(200, roles.get(m[1])); }
    if ((m = p.match(/^\/guilds\/g1\/members\/(\w+)$/))) {
      if (method === 'PUT') { if (!members.has(m[1])) { members.set(m[1], new Set()); return res(201, {}); } return res(204); }
      return members.has(m[1]) ? res(200, { roles: [...members.get(m[1])] }) : res(404, {});
    }
    if ((m = p.match(/^\/guilds\/g1\/members\/(\w+)\/roles\/(\w+)$/))) { const s = members.get(m[1]); method === 'PUT' ? s.add(m[2]) : s.delete(m[2]); return res(204); }
    if (p === '/channels/c1/messages') { messages.push(body); return res(200, { id: 'm' + messages.length }); }
    if (p === '/guilds/g1/channels' && method === 'GET') return res(200, [...channels.values()]);
    if (p === '/guilds/g1/channels' && method === 'POST') { const c = Object.assign({ id: 'ch' + (++chSeq) }, body); channels.set(c.id, c); return res(200, c); }
    if ((m = p.match(/^\/channels\/(\w+)\/messages$/))) { if (!channels.has(m[1])) return res(404, {}); privMessages.push(Object.assign({ channel: m[1] }, body)); return res(200, {}); }
    if ((m = p.match(/^\/channels\/(\w+)\/permissions\/(\w+)$/))) { const c = channels.get(m[1]); c.permission_overwrites = (c.permission_overwrites || []).filter((o) => o.id !== m[2]).concat([Object.assign({ id: m[2] }, body)]); return res(204); }
    if ((m = p.match(/^\/channels\/(\w+)$/))) { if (method === 'DELETE') { channels.delete(m[1]); return res(200, {}); } Object.assign(channels.get(m[1]), body); return res(200, channels.get(m[1])); }
  }
  throw new Error('unexpected fetch ' + method + ' ' + url);
};

const call = async (path, token, body, method = 'POST') => {
  const r = await worker.fetch(new Request('https://helper.example.workers.dev' + path, {
    method, headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://pods.example.github.io' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined
  }), env);
  const text = await r.text();
  return { status: r.status, headers: r.headers, body: text && text[0] === '{' ? JSON.parse(text) : text };
};

const rob = await idToken('u1', 'rob@example.com');
const dana = await idToken('u2', 'dana@example.com');
const stranger = await idToken('u9', 'stranger@example.com');
const owner = await idToken('u0', 'owner@example.com');

// CORS + auth
const pre = await call('/sync', null, null, 'OPTIONS');
check('preflight allows only the app', pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://pods.example.github.io');
check('no token is refused', (await call('/sync', null)).status === 401);
check('a forged token is refused', (await call('/sync', rob.slice(0, -4) + 'AAAA')).status === 401);
check('someone not on the list is refused', (await call('/sync', stranger)).status === 403);
check('unconfirmed email is refused', (await call('/sync', await idToken('u1', 'rob@example.com', { email_verified: false }))).status === 403);

// Connect Discord
const start = await call('/link/start', rob);
const authUrl = new URL(start.body.url);
check('link start points at Discord with identify + join', authUrl.host === 'discord.com' && authUrl.searchParams.get('scope') === 'identify guilds.join'
  && authUrl.searchParams.get('redirect_uri') === 'https://helper.example.workers.dev/link/callback');
const state = authUrl.searchParams.get('state');
const tampered = await worker.fetch(new Request('https://helper.example.workers.dev/link/callback?code=good&state=' + state.slice(0, -2) + 'xx'), env);
check('tampered state is rejected', tampered.status === 302 && tampered.headers.get('location').endsWith('#discord=error') && !db.has('links/u1'));
const cb = await worker.fetch(new Request('https://helper.example.workers.dev/link/callback?code=good&state=' + state), env);
check('callback returns to the app', cb.headers.get('location') === 'https://pods.example.github.io/MTG-Pod-Planner/#discord=linked');
check('link saved', db.get('links/u1') && db.get('links/u1').discordId === 'd1' && db.get('links/u1').email === 'rob@example.com');
check('joined to the server', members.has('d1'));
const p1Role = db.get('pods/p1').roleId, p2Role = db.get('pods/p2').roleId, osRole = db.get('config/discordHelper').openSeatsRoleId;
check('roles created for every pod and Open Seats', roles.get(p1Role).name === 'Tuesday Commander' && roles.get(p2Role).name === 'cEDH Sweats' && roles.get(osRole).name === 'Open Seats');
check('roles get mana colors', roles.get(p1Role).color === 0x3C9A59 && roles.get(p2Role).color === 0x3A383E);
check('Rob got his pod and Open Seats roles only', [...members.get('d1')].sort().join() === [p1Role, osRole].sort().join(), [...members.get('d1')]);

// Sync after changes
db.set('people/u1', Object.assign({}, db.get('people/u1'), { pods: [], openSeats: false }));
await call('/sync', rob);
check('leaving a pod and opting out removes roles', members.get('d1').size === 0);
db.set('people/u1', Object.assign({}, db.get('people/u1'), { pods: ['p1', 'p2'] }));
await call('/sync', rob);
check('joining pods adds their roles', [...members.get('d1')].sort().join() === [p1Role, p2Role].sort().join());
db.set('pods/p1', Object.assign({}, db.get('pods/p1'), { name: 'Tuesday EDH' }));
await call('/sync', rob);
check('renaming a pod renames its role', roles.get(p1Role).name === 'Tuesday EDH' && db.get('pods/p1').roleName === 'Tuesday EDH');
check('someone else cannot sync another person', (await call('/sync', dana, { uid: 'u1' })).status === 403);
check('only organizers can sync everyone', (await call('/sync', rob, { all: true })).status === 403);
db.set('config/settings', { open: false, blocked: ['u1'] });
const ownerSync = await call('/sync', owner, { uid: 'u1' });
check('blocking removes all of their roles', ownerSync.status === 200 && members.get('d1').size === 0);
db.set('config/settings', { open: false, blocked: [] });
await call('/sync', owner, { all: true });
check('unblocking restores roles', members.get('d1').size === 2);

// Announcements
const a1 = await call('/announce', rob, { kind: 'night', ids: ['n1'] });
const m1 = messages.at(-1);
check('new night posted, pinging only its pod', a1.body.posted && m1.content.startsWith('<@&' + p1Role + '>') && JSON.stringify(m1.allowed_mentions) === JSON.stringify({ parse: [], roles: [p1Role] }));
check('new night text comes from the database', m1.content.includes('**New game night: Thursday Commander**') && m1.content.includes('(open table)'));
check('second announce of the same night is ignored', (await call('/announce', rob, { kind: 'night', ids: ['n1'] })).body.posted === false);
check("can't announce someone else's night", (await call('/announce', dana, { kind: 'night', ids: ['n4'] })).status === 403);
await call('/announce', rob, { kind: 'night', ids: ['n4'] });
check('a night for everyone pings @Open Seats', messages.at(-1).content.startsWith('<@&' + osRole + '>'));
await call('/announce', rob, { kind: 'poll', id: 'q1' });
check('poll pings its pod', messages.at(-1).content.includes('Which night works? Next Tuesday') && messages.at(-1).allowed_mentions.roles[0] === p1Role);
await call('/announce', rob, { kind: 'updated', id: 'n1' });
check('changes are announced', messages.at(-1).content.startsWith('<@&' + p1Role + '>\n**Updated: Thursday Commander**'));
check('changes are rate limited', (await call('/announce', rob, { kind: 'updated', id: 'n1' })).body.posted === false);
check('game on refused while seats are open', (await call('/announce', dana, { kind: 'gameon', id: 'n3' })).body.posted === false);
db.set('people/u1', Object.assign({}, db.get('people/u1'), { res: { n3: 'yes' } }));
db.set('people/u2', Object.assign({}, db.get('people/u2'), { res: { n3: 'yes' } }));
const go = await call('/announce', dana, { kind: 'gameon', id: 'n3' });
check('game on posts silently with no pings', go.body.posted && messages.at(-1).flags === 4096 && messages.at(-1).allowed_mentions.roles.length === 0);
check('unknown kinds are refused', (await call('/announce', rob, { kind: 'spam' })).status === 400);

// Recurring games
await call('/announce', rob, { kind: 'series', id: 's1' });
check('new recurring game announced with its repeat', messages.at(-1).content.includes('**New game night: Fortnightly**') && messages.at(-1).content.includes('Every 2 weeks on') && messages.at(-1).allowed_mentions.roles[0] === p1Role);
check('recurring game announced once', (await call('/announce', rob, { kind: 'series', id: 's1' })).body.posted === false);
await call('/announce', rob, { kind: 'seriesUpdated', id: 's1' });
check('recurring game changes announced', messages.at(-1).content.startsWith('<@&' + p1Role + '>\n**Updated: Fortnightly**'));
check("can't announce someone else's recurring game", (await call('/announce', dana, { kind: 'series', id: 's1' })).status === 403);
const occ = 's1_' + day(1).replace(/-/g, '');
check('game on for a recurring date waits for full seats', (await call('/announce', rob, { kind: 'gameon', id: occ })).body.posted === false);
check('game on refuses a date that is not in the series', (await call('/announce', rob, { kind: 'gameon', id: 's1_' + day(2).replace(/-/g, '') })).status === 404);

// Daily run
const before = messages.length;
await worker.scheduled({}, env, { waitUntil: (p) => p });
await new Promise((r) => setTimeout(r, 50));
const daily = messages.slice(before);
const byTitle = (t) => daily.find((m) => m.content.includes('**' + t + '**'));
const open = byTitle('Thursday Commander'), podOnly = byTitle('cEDH Night'), full = byTitle('Duel');
check('daily: four reminders for tomorrow, including the recurring game', daily.length === 4 && !!byTitle('Fortnightly'), daily.map((m) => m.content.split('\n')[0]));
check('short open-table night pings its pod and @Open Seats', open && open.allowed_mentions.roles.sort().join() === [p1Role, osRole].sort().join() && open.content.includes('seats are open'));
check('short pod-only night pings only its pod', podOnly && podOnly.allowed_mentions.roles.join() === p2Role && !podOnly.content.includes('<@&' + osRole + '>'));
check('full night reminder is silent', full && full.flags === 4096 && full.allowed_mentions.roles.length === 0 && full.content.includes('Game is on'));
check('daily marks reminders as handled', Date.now() - db.get('config/discordHelper').remindersAt < 60000);
db.delete('pods/p2');
await worker.scheduled({}, env, { waitUntil: (p) => p });
await new Promise((r) => setTimeout(r, 50));
check("a deleted pod's role is removed", !roles.has(p2Role) && !db.get('config/discordHelper').managed.includes(p2Role));

// Private pods: their own role and a private channel; their games never reach the shared channel.
db.set('privpods/pp1', { name: 'Secret Sweats', mana: 'B', by: 'u2', join: 'invite', openSeats: false });
db.set('people/u2', Object.assign({}, db.get('people/u2'), { pods: ['pp1'] }));
db.set('privpods/pp1/nights/x1', { title: 'Secret Night', date: day(1), time: '21:00', format: 'Commander', min: 4, bracket: 3, podIds: ['pp1'], by: 'u2', at: 1, region: 'MontCo' });
await call('/sync', dana);
const pp = db.get('privpods/pp1'), ch = channels.get(pp.channelId);
check('private pod gets a role and a private channel', !!pp.roleId && !!ch && ch.name === 'secret-sweats' && ch.parent_id === 'cat1', pp);
check('channel hidden from everyone but the pod', ch && ch.permission_overwrites.some((o) => o.id === 'g1' && o.deny === '1024')
  && ch.permission_overwrites.some((o) => o.id === pp.roleId && (Number(o.allow) & 1024)) && !ch.permission_overwrites.some((o) => o.id === osRole));
check('channel remembered', db.get('config/discordHelper').channels.pp1 === pp.channelId);
db.set('people/u1', Object.assign({}, db.get('people/u1'), { pods: ['p1', 'pp1'] }));
await call('/sync', rob);
check('linked pod member gets the private role', members.get('d1').has(pp.roleId));
db.set('people/u1', Object.assign({}, db.get('people/u1'), { pods: ['p1'] }));
await call('/sync', rob);
check('leaving the private pod removes the role', !members.get('d1').has(pp.roleId));
const sharedBefore = messages.length;
const pa = await call('/announce', dana, { kind: 'night', ids: ['x1'], pod: 'pp1' });
const pm = privMessages.at(-1);
check('private game posted in its own channel', pa.body.posted && pm && pm.channel === pp.channelId && pm.content.includes('**New game night: Secret Night**'));
check('pings only the private pod, shows area and bracket', JSON.stringify(pm.allowed_mentions.roles) === JSON.stringify([pp.roleId]) && pm.content.includes('(MontCo)') && pm.content.includes('bracket 3 or lower'));
check('nothing posted in the shared channel', messages.length === sharedBefore);
check("someone outside the pod can't announce into it", (await call('/announce', rob, { kind: 'gameon', id: 'x1', pod: 'pp1' })).status === 403);
check('private game is not found on the public board', (await call('/announce', dana, { kind: 'updated', id: 'x1' })).status === 404);
check('a public pod id is refused as private', (await call('/announce', rob, { kind: 'night', ids: ['n1'], pod: 'p1' })).status === 404);
const sharedB2 = messages.length, privB2 = privMessages.length;
await worker.scheduled({}, env, { waitUntil: (p) => p });
await new Promise((r) => setTimeout(r, 50));
const privRem = privMessages.slice(privB2);
check('daily: private game reminded in its channel only', privRem.length === 1 && privRem[0].content.includes('**Secret Night**') && privRem[0].channel === pp.channelId
  && !messages.slice(sharedB2).some((m) => m.content.includes('Secret Night')));
check('private reminder never calls @Open Seats', !privRem[0].allowed_mentions.roles.includes(osRole));
db.set('privpods/pp1', Object.assign({}, db.get('privpods/pp1'), { name: 'Sweatshop' }));
await call('/sync', dana);
check('renaming the pod renames its channel', channels.get(pp.channelId).name === 'sweatshop');
db.delete('privpods/pp1'); db.delete('privpods/pp1/nights/x1');
await call('/sync', dana);
check("a deleted private pod's channel is removed", !channels.has(pp.channelId) && !db.get('config/discordHelper').channels.pp1);

// Unlink
await call('/link/remove', rob);
check('disconnect removes roles and the link', members.get('d1').size === 0 && !db.has('links/u1'));
check('service account token is reused', saTokens === 1, saTokens);

const failed = results.filter((r) => !r).length;
console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
process.exit(failed ? 1 : 0);
