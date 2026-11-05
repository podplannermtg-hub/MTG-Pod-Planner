// Pod Planner Discord helper. Runs on Cloudflare Workers (free plan). No packages needed.
//
// What it does
//   - Connect Discord: links a player's Discord account to their Pod Planner account and adds them to the server.
//   - Roles: creates a Discord role for every pod (plus "Open Seats") and keeps each player's roles matching the app.
//   - Announcements: posts new nights, polls, locked-in dates, changes and "Game on", pinging only the pods involved.
//   - Daily (cron): re-syncs everyone's roles and posts reminders. Short nights call @Open Seats if their pods allow it.
//   - Private pods: each gets a private channel only its role can see. Its games, reminders and "Game on" go there,
//     never to the shared channel. (The bot needs the Manage Channels and Read Message History permissions.)
//
// Settings (Cloudflare dashboard > your Worker > Settings > Variables and Secrets). See SETUP.md for where each comes from.
//   APP_URL                 your Pod Planner page, e.g. https://you.github.io/MTG-Pod-Planner/
//   OWNER_EMAIL             the email in your firestore.rules
//   DISCORD_CLIENT_ID       Discord app > OAuth2
//   DISCORD_CLIENT_SECRET   (secret) Discord app > OAuth2
//   DISCORD_BOT_TOKEN       (secret) Discord app > Bot
//   DISCORD_GUILD_ID        your server's ID
//   DISCORD_CHANNEL_ID      the channel announcements go to
//   FIREBASE_SERVICE_ACCOUNT (secret) JSON key for a service account with the "Cloud Datastore User" role
//   STATE_SECRET            (secret) any long random text
//   TIMEZONE                optional, default America/New_York
//   REMIND_DAYS             optional, default "1" (use "1,0" to also remind on the day)

const API = 'https://discord.com/api/v10';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const SILENT = 4096; // Discord message flag: deliver without a notification
const VIEW = 1024, SEND = 2048, HISTORY = 65536; // Discord permission bits
const MANA_COLOR = { W: 0xE9D88E, U: 0x3B7DBF, B: 0x3A383E, R: 0xD1523D, G: 0x3C9A59 };

// Setting names are matched without regard to case, so "App_URL" works the same as "APP_URL".
function settings(env) {
  const out = {};
  for (const k of Object.keys(env || {})) out[k.toUpperCase()] = env[k];
  for (const k of Object.keys(env || {})) if (k === k.toUpperCase()) out[k] = env[k];
  return out;
}

export default {
  async fetch(req, rawEnv) {
    const env = settings(rawEnv);
    try { return await route(req, env); }
    catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.log('error', e && e.stack || e);
      return json({ error: status === 500 ? 'Something went wrong in the helper.' : e.message }, status, env);
    }
  },
  async scheduled(event, rawEnv, ctx) { ctx.waitUntil(daily(settings(rawEnv))); }
};

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/* ---------------- routing ---------------- */
async function route(req, env) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
  if (req.method === 'GET' && url.pathname === '/') return new Response('Pod Planner helper is running.', { headers: { 'Content-Type': 'text/plain' } });
  if (req.method === 'GET' && url.pathname === '/link/callback') return linkCallback(url, env);
  if (req.method !== 'POST') throw new HttpError(404, 'Not found');

  const user = await authUser(req, env);
  const body = await req.json().catch(() => ({}));
  switch (url.pathname) {
    case '/link/start': return json({ url: await linkStartUrl(url, user, env) }, 200, env);
    case '/link/remove': return json(await unlink(env, user.uid), 200, env);
    case '/sync': return json(await syncRequest(env, user, body), 200, env);
    case '/announce': return json(await announce(env, user, body), 200, env);
    default: throw new HttpError(404, 'Not found');
  }
}
function cors(env) {
  return {
    'Access-Control-Allow-Origin': new URL(env.APP_URL).origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400', Vary: 'Origin'
  };
}
function json(obj, status, env) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, cors(env)) });
}

/* ---------------- who is asking ---------------- */
async function authUser(req, env) {
  const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') || '');
  if (!m) throw new HttpError(401, 'Sign in first.');
  const claims = await verifyIdToken(m[1], env);
  if (!claims.email || claims.email_verified !== true) throw new HttpError(403, 'Confirm your email first.');
  const email = String(claims.email).toLowerCase();
  const access = await accessFor(env, claims.sub, email);
  if (!access.member) throw new HttpError(403, "You're not on the members list.");
  return { uid: claims.sub, email, isAdmin: access.admin };
}
async function accessFor(env, uid, email) {
  const [members, settings] = await Promise.all([fsGet(env, 'config/members'), fsGet(env, 'config/settings')]);
  const emails = (members && members.emails) || [], admins = (members && members.admins) || [];
  const blocked = ((settings && settings.blocked) || []).includes(uid);
  const owner = !!email && email === String(env.OWNER_EMAIL || '').toLowerCase();
  const admin = owner || (!blocked && admins.includes(email));
  const member = admin || (!blocked && (emails.includes(email) || !!(settings && settings.open)));
  return { member, admin };
}

let jwks = { at: 0, keys: [] };
async function verifyIdToken(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Sign in again.');
  let header, claims;
  try { header = JSON.parse(b64urlText(parts[0])); claims = JSON.parse(b64urlText(parts[1])); } catch (e) { throw new HttpError(401, 'Sign in again.'); }
  if (header.alg !== 'RS256') throw new HttpError(401, 'Sign in again.');
  if (Date.now() - jwks.at > 3600e3 || !jwks.keys.some((k) => k.kid === header.kid)) {
    const r = await fetch(JWKS_URL);
    jwks = { at: Date.now(), keys: (await r.json()).keys || [] };
  }
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Sign in again.');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), utf8(parts[0] + '.' + parts[1]));
  const pid = projectId(env), now = Date.now() / 1000;
  if (!ok || claims.aud !== pid || claims.iss !== 'https://securetoken.google.com/' + pid || !(claims.exp > now) || !claims.sub)
    throw new HttpError(401, 'Sign in again.');
  return claims;
}

/* ---------------- Connect Discord ---------------- */
async function linkStartUrl(url, user, env) {
  const state = await signState(env, { uid: user.uid, email: user.email, exp: Math.floor(Date.now() / 1000) + 600 });
  const q = new URLSearchParams({
    response_type: 'code', client_id: env.DISCORD_CLIENT_ID, scope: 'identify guilds.join',
    redirect_uri: url.origin + '/link/callback', state, prompt: 'consent'
  });
  return 'https://discord.com/oauth2/authorize?' + q.toString();
}
async function linkCallback(url, env) {
  const back = (status) => Response.redirect(String(env.APP_URL).split('#')[0] + '#discord=' + status, 302);
  const st = await verifyState(env, url.searchParams.get('state') || '');
  const code = url.searchParams.get('code');
  if (!st || !code) return back('error');
  try {
    const tok = await fetch(API + '/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: url.origin + '/link/callback' }).toString()
    }).then((r) => r.ok ? r.json() : Promise.reject(new Error('token ' + r.status)));
    const me = await fetch(API + '/users/@me', { headers: { Authorization: 'Bearer ' + tok.access_token } })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('me ' + r.status)));
    // Adds them to the server if they aren't in it yet (no-op if they are).
    await dc(env, 'PUT', '/guilds/' + env.DISCORD_GUILD_ID + '/members/' + me.id, { access_token: tok.access_token }).catch((e) => console.log('join', e.message));
    await fsSet(env, 'links/' + st.uid, { discordId: me.id, name: me.global_name || me.username, username: me.username, email: st.email, at: Date.now() });
    const roles = await ensureRoles(env);
    await syncUser(env, st.uid, roles);
    return back('linked');
  } catch (e) {
    console.log('link failed', e && e.message);
    return back('error');
  }
}
async function unlink(env, uid) {
  const link = await fsGet(env, 'links/' + uid);
  if (link && link.discordId) {
    const state = (await fsGet(env, 'config/discordHelper')) || {};
    await setMemberRoles(env, link.discordId, new Set(), state.managed || []);
  }
  await fsDelete(env, 'links/' + uid);
  return { ok: true };
}
async function signState(env, payload) {
  const body = b64urlFromText(JSON.stringify(payload));
  return body + '.' + b64urlFromBytes(await hmac(env, body));
}
async function verifyState(env, state) {
  const [body, sig] = String(state).split('.');
  if (!body || !sig) return null;
  const want = b64urlFromBytes(await hmac(env, body));
  if (want.length !== sig.length) return null;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
  const p = JSON.parse(b64urlText(body));
  return p.exp > Date.now() / 1000 ? p : null;
}
async function hmac(env, text) {
  if (!env.STATE_SECRET || env.STATE_SECRET.length < 16) throw new Error('STATE_SECRET is missing or too short.');
  const key = await crypto.subtle.importKey('raw', utf8(env.STATE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(text)));
}

/* ---------------- roles ---------------- */
// Makes sure every pod has a role (named after the pod), plus "Open Seats", and removes roles of deleted pods.
async function ensureRoles(env) {
  const G = env.DISCORD_GUILD_ID;
  const [pub, priv, state0, guildRoles] = await Promise.all([fsList(env, 'pods'), fsList(env, 'privpods'), fsGet(env, 'config/discordHelper'), dc(env, 'GET', '/guilds/' + G + '/roles')]);
  const pods = pub.map((p) => Object.assign(p, { path: 'pods/' + p.id }))
    .concat(priv.map((p) => Object.assign(p, { path: 'privpods/' + p.id, private: true })));
  const state = state0 || {};
  const have = new Map(guildRoles.map((r) => [r.id, r]));
  const managed = new Set(state.managed || []);
  for (const p of pods) {
    const color = MANA_COLOR[p.mana] || 0;
    if (!p.roleId || !have.has(p.roleId)) {
      const role = await dc(env, 'POST', '/guilds/' + G + '/roles', { name: p.name, color, mentionable: false, hoist: false });
      have.set(role.id, role);
      p.roleId = role.id;
      await fsSet(env, p.path, { roleId: role.id, roleName: p.name }, true);
    } else if (have.get(p.roleId).name !== p.name || have.get(p.roleId).color !== color) {
      await dc(env, 'PATCH', '/guilds/' + G + '/roles/' + p.roleId, { name: p.name, color });
      await fsSet(env, p.path, { roleName: p.name }, true);
    }
    managed.add(p.roleId);
  }
  let openSeats = state.openSeatsRoleId && have.has(state.openSeatsRoleId) ? state.openSeatsRoleId : null;
  if (!openSeats) openSeats = (await dc(env, 'POST', '/guilds/' + G + '/roles', { name: 'Open Seats', color: 0x17624E, mentionable: false, hoist: false })).id;
  managed.add(openSeats);
  const live = new Set(pods.map((p) => p.roleId).concat([openSeats]));
  for (const rid of [...managed]) {
    if (live.has(rid)) continue;
    if (have.has(rid)) await dc(env, 'DELETE', '/guilds/' + G + '/roles/' + rid).catch((e) => console.log('delete role', e.message));
    managed.delete(rid);
  }
  const channels = await ensureChannels(env, pods, state.channels || {});
  const out = { pods, openSeatsRoleId: openSeats, managed: [...managed] };
  await fsSet(env, 'config/discordHelper', { openSeatsRoleId: openSeats, managed: out.managed, channels });
  return out;
}
// A private channel for every private pod: hidden from everyone except that pod's role (and the bot).
// It sits in the same category as the shared channel. Channels of deleted pods are removed.
function channelName(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'private-pod'; }
let botId = '';
async function ensureChannels(env, pods, known) {
  const G = env.DISCORD_GUILD_ID;
  const priv = pods.filter((p) => p.private && p.roleId);
  const allIds = new Set(pods.map((p) => p.id));
  const out = {};
  if (!priv.length && !Object.keys(known).length) return out;
  const list = await dc(env, 'GET', '/guilds/' + G + '/channels');
  const byId = new Map(list.map((c) => [c.id, c]));
  const shared = byId.get(env.DISCORD_CHANNEL_ID);
  if (!botId) botId = (await dc(env, 'GET', '/users/@me')).id;
  const allow = String(VIEW | SEND | HISTORY);
  for (const p of priv) {
    let ch = p.channelId && byId.get(p.channelId);
    try {
      if (!ch) {
        ch = await dc(env, 'POST', '/guilds/' + G + '/channels', {
          name: channelName(p.name), type: 0, parent_id: (shared && shared.parent_id) || undefined,
          topic: 'Private games for ' + p.name + ' (Pod Planner). Only this pod can see this channel.',
          permission_overwrites: [{ id: G, type: 0, deny: String(VIEW) }, { id: p.roleId, type: 0, allow }, { id: botId, type: 1, allow }]
        });
        await fsSet(env, p.path, { channelId: ch.id }, true);
      } else {
        if (ch.name !== channelName(p.name)) await dc(env, 'PATCH', '/channels/' + ch.id, { name: channelName(p.name) });
        const ow = (ch.permission_overwrites || []).find((o) => o.id === p.roleId);
        if (!ow) await dc(env, 'PUT', '/channels/' + ch.id + '/permissions/' + p.roleId, { type: 0, allow, deny: '0' });
      }
      p.channelId = ch.id; out[p.id] = ch.id;
    } catch (e) { console.log('channel', p.id, e.message); }
  }
  // Pods that were deleted: remove their private channel. (A pod made public again keeps its old channel.)
  for (const [podId, cid] of Object.entries(known)) {
    if (out[podId]) continue;
    if (allIds.has(podId)) { out[podId] = cid; continue; }
    if (byId.has(cid)) await dc(env, 'DELETE', '/channels/' + cid).catch((e) => console.log('delete channel', e.message));
  }
  return out;
}
// Gives a linked player exactly the managed roles they should have, and removes the rest.
async function syncUser(env, uid, roles) {
  const link = await fsGet(env, 'links/' + uid);
  if (!link || !link.discordId) return { linked: false };
  const [person, access] = await Promise.all([fsGet(env, 'people/' + uid), accessFor(env, uid, link.email)]);
  const want = new Set();
  if (access.member && person) {
    const byId = new Map(roles.pods.map((p) => [p.id, p]));
    (person.pods || []).forEach((id) => { const p = byId.get(id); if (p && p.roleId) want.add(p.roleId); });
    if (person.openSeats) want.add(roles.openSeatsRoleId);
  }
  const inServer = await setMemberRoles(env, link.discordId, want, roles.managed);
  return { linked: true, inServer, roles: want.size };
}
async function setMemberRoles(env, discordId, want, managed) {
  const G = env.DISCORD_GUILD_ID;
  let member;
  try { member = await dc(env, 'GET', '/guilds/' + G + '/members/' + discordId); }
  catch (e) { if (e.status === 404) return false; throw e; }
  const has = new Set(member.roles || []);
  for (const rid of managed) {
    if (want.has(rid) && !has.has(rid)) await dc(env, 'PUT', '/guilds/' + G + '/members/' + discordId + '/roles/' + rid);
    else if (!want.has(rid) && has.has(rid)) await dc(env, 'DELETE', '/guilds/' + G + '/members/' + discordId + '/roles/' + rid);
  }
  return true;
}
async function syncRequest(env, user, body) {
  const roles = await ensureRoles(env);
  if (body && body.all) {
    if (!user.isAdmin) throw new HttpError(403, 'Only organizers can do that.');
    const links = await fsList(env, 'links');
    for (const l of links.slice(0, 200)) await syncUser(env, l.id, roles).catch((e) => console.log('sync', l.id, e.message));
    return { ok: true, synced: Math.min(links.length, 200) };
  }
  const target = body && body.uid ? String(body.uid) : user.uid;
  if (target !== user.uid && !user.isAdmin) throw new HttpError(403, 'Only organizers can do that.');
  return Object.assign({ ok: true }, await syncUser(env, target, roles));
}

/* ---------------- announcements ---------------- */
// Messages are built here from the database, never from text the browser sends.
async function announce(env, user, body) {
  const kind = body && body.kind;
  const ok = (by) => by === user.uid || user.isAdmin;
  const roles = await ensureRoles(env);
  const podMap = new Map(roles.pods.map((p) => [p.id, p]));
  // A private pod's games are read from inside the pod and posted only in its own channel.
  let base = '', channel = env.DISCORD_CHANNEL_ID;
  if (body && body.pod) {
    const pod = podMap.get(String(body.pod));
    if (!pod || !pod.private) throw new HttpError(404, 'Pod not found.');
    if (!user.isAdmin) {
      const person = await fsGet(env, 'people/' + user.uid);
      if (!person || !(person.pods || []).includes(pod.id)) throw new HttpError(403, "You're not in that pod.");
    }
    if (!pod.channelId) return { posted: false, reason: 'no private channel yet' };
    base = 'privpods/' + pod.id + '/'; channel = pod.channelId;
  }
  const post = (env2, lines, mentions, opts) => postTo(env2, lines, mentions, Object.assign({ channel }, opts || {}));
  const page = String(env.APP_URL).split('#')[0];
  const once = async (key, minutes) => {
    const m = await fsGet(env, 'announced/' + key);
    if (m && (!minutes || Date.now() - (m.at || 0) < minutes * 60e3)) return false;
    await fsSet(env, 'announced/' + key, { at: Date.now(), by: user.uid });
    return true;
  };

  if (kind === 'night') {
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 12).map(String) : [];
    if (!ids.length) throw new HttpError(400, 'Missing night.');
    const nights = await Promise.all(ids.map((id) => fsGet(env, base + 'nights/' + id)));
    if (nights.some((n) => !n)) throw new HttpError(404, 'Night not found.');
    if (!nights.every((n) => ok(n.by))) throw new HttpError(403, 'Only the person who called it can announce it.');
    if (!(await once('night_' + ids[0]))) return { posted: false, reason: 'already announced' };
    const n = nights[0];
    const lines = ['**New game night: ' + n.title + '**'].concat(details(n, podMap));
    if (ids.length > 1) lines.push('Repeats weekly for ' + ids.length + ' weeks.');
    lines.push('Answer in one tap: ' + page);
    return post(env, lines, mentionsFor(n, podMap, roles.openSeatsRoleId), { night: n });
  }
  if (kind === 'series' || kind === 'seriesUpdated') {
    const s = await fsGet(env, base + 'series/' + String(body.id || ''));
    if (!s) throw new HttpError(404, 'Recurring game not found.');
    if (!ok(s.by)) throw new HttpError(403, 'Only the person who set it up can announce it.');
    const isNew = kind === 'series';
    if (!(await once((isNew ? 'series_' : 'seriesupd_') + body.id, isNew ? 0 : 10))) return { posted: false, reason: isNew ? 'already announced' : 'announced recently' };
    const lines = [(isNew ? '**New game night: ' : '**Updated: ') + s.title + '**'].concat(details(s, podMap));
    lines[1] = repeatLabel(s) + (s.time ? ' at ' + fmtTime(s.time) : '') + ', starting ' + fmtDate(s.date) + (s.place ? ', ' + s.place : '');
    lines.push((isNew ? 'Answer in one tap: ' : 'Details: ') + page);
    return post(env, lines, mentionsFor(s, podMap, roles.openSeatsRoleId), {});
  }
  if (kind === 'poll') {
    const p = await fsGet(env, base + 'polls/' + String(body.id || ''));
    if (!p) throw new HttpError(404, 'Poll not found.');
    if (!ok(p.by)) throw new HttpError(403, 'Only the person who posted it can announce it.');
    if (!(await once('poll_' + body.id))) return { posted: false, reason: 'already announced' };
    const lines = ['**Which night works? ' + p.title + '**'];
    (p.options || []).forEach((o) => lines.push('- ' + fmtDate(o.date) + (o.time ? ' at ' + fmtTime(o.time) : '')));
    lines.push([p.format, 'need ' + (p.min || 4) + ' players', p.place].filter(Boolean).join(', '));
    if (p.note) lines.push(p.note);
    lines.push('Vote here: ' + page);
    return post(env, lines, mentionsFor(p, podMap, roles.openSeatsRoleId), {});
  }
  if (kind === 'locked' || kind === 'updated' || kind === 'gameon') {
    const n = (await fsGet(env, base + 'nights/' + String(body.id || ''))) || (kind === 'gameon' ? await seriesOccurrence(env, String(body.id || ''), base) : null);
    if (!n) throw new HttpError(404, 'Night not found.');
    if (kind === 'locked') {
      if (!n.fromPoll || !ok(n.by)) throw new HttpError(403, 'Only the person who locked it in can announce it.');
      if (!(await once('locked_' + body.id))) return { posted: false, reason: 'already announced' };
      return post(env, ['**Locked in: ' + n.title + '**'].concat(details(n, podMap), ['Confirm your answer: ' + page]), mentionsFor(n, podMap, roles.openSeatsRoleId), {});
    }
    if (kind === 'updated') {
      if (!ok(n.by)) throw new HttpError(403, 'Only the person who called it can announce changes.');
      if (!(await once('updated_' + body.id, 10))) return { posted: false, reason: 'announced recently' };
      return post(env, ['**Updated: ' + n.title + '**'].concat(details(n, podMap), ['Details: ' + page]), mentionsFor(n, podMap, roles.openSeatsRoleId), {});
    }
    // Game on: anyone can trigger it, but only when the seats really are full. Posted silently.
    const people = await fsList(env, 'people');
    const blocked = new Set((((await fsGet(env, 'config/settings')) || {}).blocked) || []);
    const yes = people.filter((p) => p.nick && !blocked.has(p.id) && answerOf(p, n) === 'yes').length;
    const min = n.min || 4;
    if (yes < min) return { posted: false, reason: 'not full yet' };
    if (!(await once('gameon_' + body.id))) return { posted: false, reason: 'already announced' };
    return post(env, ['Game on: ' + n.title + ' has ' + min + ' of ' + min + ' seats.', whenLine(n)], { roles: [], everyone: false }, { silent: true });
  }
  throw new HttpError(400, 'Unknown announcement.');
}
// Pings the roles of the pods a night or poll calls. A night open to everyone (no pods) pings @Open Seats.
// "<seriesId>_<YYYYMMDD>" -> that date of the recurring game, if it really is one of its dates.
async function seriesOccurrence(env, id, base) {
  const m = /^([A-Za-z0-9]+)_(\d{4})(\d{2})(\d{2})$/.exec(id);
  if (!m) return null;
  const s = await fsGet(env, (base || '') + 'series/' + m[1]);
  const ymd = m[2] + '-' + m[3] + '-' + m[4];
  return s && seriesDates(s, ymd, ymd).length ? occurrence(s, ymd) : null;
}
function mentionsFor(item, podMap, openSeatsRoleId) {
  const pods = (item.podIds || []).map((id) => podMap.get(id)).filter(Boolean);
  const roles = pods.length ? pods.filter((p) => p.roleId).map((p) => p.roleId) : [openSeatsRoleId].filter(Boolean);
  return { roles: [...new Set(roles)], everyone: false };
}
function post(env, lines, mentions, opts) { return postTo(env, lines, mentions, opts); }
async function postTo(env, lines, mentions, opts) {
  const tags = mentions.roles.map((r) => '<@&' + r + '>');
  const content = ((tags.length ? tags.join(' ') + '\n' : '') + lines.filter(Boolean).join('\n')).slice(0, 1900);
  await dc(env, 'POST', '/channels/' + ((opts && opts.channel) || env.DISCORD_CHANNEL_ID) + '/messages', {
    content,
    allowed_mentions: { parse: [], roles: mentions.roles },
    flags: opts && opts.silent ? SILENT : 0
  });
  return { posted: true };
}

/* ---------------- daily: role sync + reminders ---------------- */
async function daily(env) {
  const roles = await ensureRoles(env);
  const links = await fsList(env, 'links');
  for (const l of links.slice(0, 200)) await syncUser(env, l.id, roles).catch((e) => console.log('sync', l.id, e.message));
  const [stored, seriesList, people, settings] = await Promise.all([fsList(env, 'nights'), fsList(env, 'series'), fsList(env, 'people'), fsGet(env, 'config/settings')]);
  const blocked = new Set(((settings || {}).blocked) || []);
  const live = people.filter((p) => p.nick && !blocked.has(p.id));
  const tz = env.TIMEZONE || 'America/New_York';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const days = String(env.REMIND_DAYS || '1').split(',').map((s) => parseInt(s, 10)).filter((d) => d >= 0);
  const podMap = new Map(roles.pods.map((p) => [p.id, p]));
  const page = String(env.APP_URL).split('#')[0];
  const last = addDays(today, Math.max(0, ...days));
  const expand = (list, series, channel) => list.concat(...series.map((s) => seriesDates(s, today, last).map((d) => occurrence(s, d))))
    .map((n) => Object.assign(n, { channel }));
  let nights = expand(stored, seriesList, env.DISCORD_CHANNEL_ID);
  // Each private pod's games are reminded in that pod's own channel.
  for (const p of roles.pods.filter((x) => x.private && x.channelId)) {
    const [pn, ps] = await Promise.all([fsList(env, 'privpods/' + p.id + '/nights'), fsList(env, 'privpods/' + p.id + '/series')]);
    nights = nights.concat(expand(pn, ps, p.channelId));
  }
  let sent = 0;
  for (const d of days) {
    const date = addDays(today, d);
    for (const n of nights.filter((x) => x.date === date).sort((a, b) => (a.time || '').localeCompare(b.time || ''))) {
      const msg = reminderFor(n, d, live, podMap, roles.openSeatsRoleId, page);
      await post(env, msg.lines, { roles: msg.roles, everyone: false }, { silent: msg.silent, channel: n.channel }).catch((e) => console.log('remind', e.message));
      sent++;
    }
  }
  // Tells the GitHub reminder job to stand down so nobody gets two reminders.
  await fsSet(env, 'config/discordHelper', { remindersAt: Date.now() });
  return { sent };
}
export function reminderFor(n, days, people, podMap, openSeatsRoleId, page) {
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
  const min = n.min || 4;
  const pods = (n.podIds || []).map((id) => podMap.get(id)).filter(Boolean);
  const podIds = new Set(podMap.keys());
  const lists = { yes: [], maybe: [], no: [] }, wait = [];
  people.forEach((p) => {
    const a = answerOf(p, n);
    if (a) lists[a].push(p.nick);
    else if (invited(p, n, podIds)) wait.push(p.nick);
  });
  const gap = min - lists.yes.length;
  const lines = ['Reminder: **' + n.title + '** is ' + when + '.', whenLine(n)];
  lines.push(gap <= 0 ? 'Game is on: ' + lists.yes.length + ' of ' + min + ' seats filled.' : lists.yes.length + ' of ' + min + ' seats filled.');
  if (lists.yes.length) lines.push('In: ' + lists.yes.sort().join(', '));
  if (lists.maybe.length) lines.push('Maybe: ' + lists.maybe.sort().join(', '));
  if (wait.length && gap > 0) lines.push('Still waiting on: ' + wait.sort().join(', '));
  if (gap <= 0) return { lines: lines.concat(['Details: ' + page]), roles: [], silent: true };
  const roles = pods.filter((p) => p.roleId).map((p) => p.roleId);
  const openTable = pods.every((p) => p.openSeats !== false);
  if (openTable && openSeatsRoleId) {
    lines.push(gap + (gap === 1 ? ' seat is' : ' seats are') + ' open. <@&' + openSeatsRoleId + '>, jump in!');
    roles.push(openSeatsRoleId);
  } else {
    lines.push('Need ' + gap + ' more.');
  }
  lines.push('Answer here: ' + page);
  return { lines, roles: [...new Set(roles)], silent: false };
}

/* ---------------- recurring games (same rules as the app, in UTC date math) ---------------- */
const STEP = { weekly: 7, biweekly: 14 };
const ORD = { '1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '-1': 'last' };
function utcDate(ymd) { const [y, m, d] = String(ymd).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function ymdOf(d) { return d.toISOString().slice(0, 10); }
function nthOfDate(ymd) { const n = Math.ceil(utcDate(ymd).getUTCDate() / 7); return n >= 5 ? -1 : n; }
function nthWeekdayUTC(y, m, wd, nth) {
  let d;
  if (nth === -1) { d = new Date(Date.UTC(y, m + 1, 0)); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() - 1); return d; }
  d = new Date(Date.UTC(y, m, 1)); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * (nth - 1));
  return d.getUTCMonth() === m ? d : null;
}
export function seriesDates(s, from, to, max) {
  const out = [], skips = s.skips || [], start = utcDate(s.date);
  let n = 0, guard = 0;
  const take = (ymd) => {
    n++;
    if ((s.count && n > s.count) || (s.until && ymd > s.until) || ymd > to) return false;
    if (ymd >= from && !skips.includes(ymd)) out.push(ymd);
    return !(max && out.length >= max);
  };
  if (s.freq === 'monthly') {
    let y = start.getUTCFullYear(), m = start.getUTCMonth();
    const nth = s.nth || nthOfDate(s.date);
    while (guard++ < 1200) {
      const d = nthWeekdayUTC(y, m, start.getUTCDay(), nth);
      if (d && ymdOf(d) >= s.date && !take(ymdOf(d))) break;
      if (++m > 11) { m = 0; y++; }
    }
  } else {
    const c = new Date(start.getTime()), step = STEP[s.freq] || 7;
    while (guard++ < 2600 && take(ymdOf(c))) c.setUTCDate(c.getUTCDate() + step);
  }
  return out;
}
export function occurrence(s, ymd) {
  return { id: s.id + '_' + ymd.replace(/-/g, ''), date: ymd, time: s.time || '', title: s.title, place: s.place || '', host: s.host || '',
    format: s.format, min: s.min || 4, podIds: s.podIds || [], note: s.note || '', by: s.by, series: s.id, virtual: true };
}
export function repeatLabel(s) {
  const day = utcDate(s.date).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' });
  let out = s.freq === 'monthly' ? 'Monthly on the ' + ORD[String(s.nth || nthOfDate(s.date))] + ' ' + day
    : (s.freq === 'biweekly' ? 'Every 2 weeks' : 'Every week') + ' on ' + day + 's';
  if (s.count) out += ', ' + s.count + ' games';
  else if (s.until) out += ', until ' + utcDate(s.until).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  return out;
}

/* ---------------- shared formatting ---------------- */
function answerOf(person, n) {
  const r = person.res || {};
  if (Object.prototype.hasOwnProperty.call(r, n.id)) return r[n.id] === 'none' ? undefined : r[n.id];
  if (n.fromPoll && n.fromOpt) {
    const v = person.pv && person.pv[n.fromPoll] && person.pv[n.fromPoll][n.fromOpt];
    if (v === 'yes' || v === 'maybe' || v === 'no') return v;
  }
  return undefined;
}
function invited(person, n, podIds) {
  const ids = (n.podIds || []).filter((id) => podIds.has(id));
  return ids.length === 0 || ids.some((id) => (person.pods || []).includes(id));
}
function details(n, podMap) {
  const lines = [whenLine(n)];
  const meta = [n.format, n.format === 'Commander' && n.bracket ? 'bracket ' + n.bracket + ' or lower' : '', 'need ' + (n.min || 4) + ' players', n.host ? 'host: ' + n.host : ''].filter(Boolean);
  lines.push(meta.join(', '));
  const pods = (n.podIds || []).map((id) => podMap.get(id)).filter(Boolean);
  if (pods.length) lines.push('Pods: ' + pods.map((p) => p.name).join(', ') + (pods.some((p) => p.openSeats === false) ? ' (pod only)' : ' (open table)'));
  if (n.note) lines.push(n.note);
  return lines;
}
const REGIONS = ['Upper Bucks', 'Central Bucks', 'Lower Bucks', 'MontCo', 'Philly Area', 'North Jersey', 'South Jersey'];
function whenLine(n) {
  const where = n.online ? ', online' + (n.platform ? ' (' + n.platform + ')' : '')
    : (n.place ? ', ' + n.place : '') + (REGIONS.includes(n.region) ? ' (' + n.region + ')' : '');
  return fmtDate(n.date) + (n.time ? ' at ' + fmtTime(n.time) : '') + where;
}
function fmtDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* ---------------- Discord REST ---------------- */
async function dc(env, method, path, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'Content-Type': 'application/json', 'X-Audit-Log-Reason': 'Pod Planner' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (r.status === 429) {
      const j = await r.json().catch(() => ({}));
      await new Promise((res) => setTimeout(res, Math.min(5000, Math.ceil((j.retry_after || 1) * 1000))));
      continue;
    }
    if (r.status === 204) return null;
    const text = await r.text();
    if (!r.ok) { const e = new Error('Discord ' + r.status + ': ' + text.slice(0, 200)); e.status = r.status; throw e; }
    return text ? JSON.parse(text) : null;
  }
  const e = new Error('Discord kept rate-limiting.'); e.status = 429; throw e;
}

/* ---------------- Firestore REST (service account) ---------------- */
let saJson = null;
function serviceAccount(env) {
  if (!saJson) saJson = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  return saJson;
}
function projectId(env) { return serviceAccount(env).project_id; }
let sa = { token: '', exp: 0 }, saPending = null;
async function saToken(env) {
  if (sa.token && Date.now() / 1000 < sa.exp - 60) return sa.token;
  // Requests made at the same moment share one sign-in.
  if (!saPending) saPending = fetchSaToken(env).finally(() => { saPending = null; });
  return saPending;
}
async function fetchSaToken(env) {
  const acct = serviceAccount(env), now = Math.floor(Date.now() / 1000);
  const head = b64urlFromText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64urlFromText(JSON.stringify({ iss: acct.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: acct.token_uri || GOOGLE_TOKEN, iat: now, exp: now + 3600 }));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(acct.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(head + '.' + claims)));
  const r = await fetch(acct.token_uri || GOOGLE_TOKEN, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claims + '.' + b64urlFromBytes(sig) }).toString()
  });
  if (!r.ok) throw new Error('Service account sign-in failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  sa = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return sa.token;
}
function docsUrl(env) { return 'https://firestore.googleapis.com/v1/projects/' + projectId(env) + '/databases/(default)/documents/'; }
async function fsFetch(env, path, init) {
  const r = await fetch(docsUrl(env) + path, Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + (await saToken(env)) }, (init && init.headers) || {}) }));
  return r;
}
async function fsGet(env, path) {
  const r = await fsFetch(env, path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Reading ' + path + ': ' + r.status);
  const d = await r.json();
  return Object.assign({ id: d.name.split('/').pop() }, decodeFields(d.fields || {}));
}
async function fsList(env, col) {
  const out = []; let pageToken = '';
  do {
    const r = await fsFetch(env, col + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
    if (!r.ok) throw new Error('Reading ' + col + ': ' + r.status);
    const j = await r.json();
    (j.documents || []).forEach((d) => out.push(Object.assign({ id: d.name.split('/').pop() }, decodeFields(d.fields || {}))));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}
// Merges the given fields into the document (creating it if needed).
async function fsSet(env, path, obj, mustExist) {
  const mask = Object.keys(obj).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&') + (mustExist ? '&currentDocument.exists=true' : '');
  const r = await fsFetch(env, path + '?' + mask, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: encodeFields(obj) }) });
  if (mustExist && (r.status === 404 || r.status === 400)) return; // the document was deleted meanwhile
  if (!r.ok) throw new Error('Writing ' + path + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
async function fsDelete(env, path) {
  const r = await fsFetch(env, path, { method: 'DELETE' });
  if (!r.ok && r.status !== 404) throw new Error('Deleting ' + path + ': ' + r.status);
}
function decode(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(f) { const o = {}; for (const k of Object.keys(f)) o[k] = decode(f[k]); return o; }
function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: encodeFields(v) } };
}
function encodeFields(o) { const f = {}; for (const k of Object.keys(o)) f[k] = encode(o[k]); return f; }

/* ---------------- bytes ---------------- */
function utf8(s) { return new TextEncoder().encode(s); }
function b64urlFromBytes(bytes) { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function b64urlFromText(t) { return b64urlFromBytes(utf8(t)); }
function b64urlBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlText(s) { return new TextDecoder().decode(b64urlBytes(s)); }
function pemToDer(pem) { return b64urlBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')).buffer; }
