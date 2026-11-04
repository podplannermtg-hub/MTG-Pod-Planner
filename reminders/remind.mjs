// Posts a Discord reminder for game nights that are coming up. Runs on GitHub Actions once a day.
// It reads the same Firebase database the page uses, using a service account key kept as a GitHub secret.
//
// Settings come from environment variables (see .github/workflows/reminders.yml):
//   FIREBASE_SERVICE_ACCOUNT   required: the whole JSON key file, stored as a GitHub secret.
//                              A read-only key is enough (see the README).
//   DISCORD_WEBHOOK_URL        optional; if empty, the webhook saved in the app is used
//   DISCORD_PING               optional, '@here' or '@everyone'
//   TIMEZONE                   default America/New_York
//   REMIND_DAYS                default '1'. Use '1,0' for a day-before and a day-of reminder.
//   PAGE_URL                   link put at the end of each message

import { pathToFileURL } from 'node:url';
import { createSign } from 'node:crypto';

/* ---------- date helpers (all in the group's timezone) ---------- */
export function ymdInTz(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function fmtDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
}

/* ---------- answers (mirrors the page) ---------- */
const validVote = (v) => v === 'yes' || v === 'maybe' || v === 'no';
function answerOf(person, n) {
  const r = person.res || {};
  if (Object.prototype.hasOwnProperty.call(r, n.id)) return r[n.id] === 'none' ? undefined : r[n.id];
  if (n.fromPoll && n.fromOpt) {
    const v = person.pv && person.pv[n.fromPoll] && person.pv[n.fromPoll][n.fromOpt];
    if (validVote(v)) return v;
  }
  return undefined;
}
function invited(person, night, podIds) {
  const ids = (night.podIds || []).filter((id) => podIds.has(id));
  return ids.length === 0 || ids.some((id) => (person.pods || []).includes(id));
}

/* ---------- message building (pure, so it can be tested) ---------- */
export function buildMessages({ nights, pods, people }, { today, remindDays, pageUrl }) {
  const podIds = new Set(pods.map((p) => p.id));
  const live = people.filter((p) => p.nick);
  const targets = new Map(remindDays.map((d) => [addDays(today, d), d]));
  const out = [];
  nights
    .filter((n) => targets.has(n.date))
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
    .forEach((n) => {
      const days = targets.get(n.date);
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
      const min = n.min || 4;
      const lists = { yes: [], maybe: [], no: [] }, wait = [], bring = [];
      live.forEach((p) => {
        const a = answerOf(p, n);
        if (a) {
          lists[a].push(p.nick);
          const b = p.bring && p.bring[n.id];
          if (b && a !== 'no') bring.push(p.nick + ': ' + b);
        } else if (invited(p, n, podIds)) wait.push(p.nick);
      });
      const { yes, maybe, no } = lists;
      [yes, maybe, no, wait, bring].forEach((l) => l.sort((a, b) => a.localeCompare(b)));
      const lines = [];
      lines.push('Reminder: ' + n.title + ' is ' + when + '.');
      lines.push(fmtDate(n.date) + (n.time ? ' at ' + fmtTime(n.time) : '') + (n.place ? ', ' + n.place : '') + (n.host ? ' (host: ' + n.host + ')' : ''));
      const gap = min - yes.length;
      lines.push(gap <= 0 ? 'Game is on: ' + yes.length + ' of ' + min + ' seats filled.' : 'Need ' + gap + ' more: ' + yes.length + ' of ' + min + ' seats filled.');
      if (yes.length) lines.push('In: ' + yes.join(', '));
      if (maybe.length) lines.push('Maybe: ' + maybe.join(', '));
      if (no.length) lines.push("Can't: " + no.join(', '));
      if (wait.length) lines.push('Still waiting on: ' + wait.join(', '));
      if (bring.length) lines.push('Bringing: ' + bring.join('; '));
      if (pageUrl) lines.push('Answer or change your answer: ' + pageUrl);
      out.push(lines.join('\n'));
    });
  return out;
}

/* ---------- Google service account sign-in ---------- */
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
export async function serviceToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: tokenUri, iat: now, exp: now + 3600
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(head + '.' + claims);
  const jwt = head + '.' + claims + '.' + b64url(signer.sign(sa.private_key));
  const r = await fetch(tokenUri, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString()
  });
  if (!r.ok) throw new Error('Google sign-in for the service account failed (' + r.status + '): ' + (await r.text()));
  return (await r.json()).access_token;
}

/* ---------- Firestore over REST ---------- */
function dec(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  return null;
}
function decFields(f) { const o = {}; for (const k of Object.keys(f)) o[k] = dec(f[k]); return o; }

async function readCollection(projectId, token, name) {
  const docs = [];
  let pageToken = '';
  do {
    const url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/databases/(default)/documents/' + name
      + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('Reading ' + name + ' failed (' + r.status + '): ' + (await r.text()));
    const j = await r.json();
    (j.documents || []).forEach((d) => docs.push({ id: d.name.split('/').pop(), ...decFields(d.fields || {}) }));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function readDoc(projectId, token, path) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/databases/(default)/documents/' + path;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Reading ' + path + ' failed (' + r.status + '): ' + (await r.text()));
  return decFields((await r.json()).fields || {});
}

async function main() {
  const env = process.env;
  let sa;
  try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || ''); } catch (e) { sa = null; }
  if (!sa || !sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error('Add the FIREBASE_SERVICE_ACCOUNT secret in GitHub (the whole JSON key file). See the README.');
  }
  const tz = env.TIMEZONE || 'America/New_York';
  const remindDays = (env.REMIND_DAYS || '1').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n >= 0);
  const pageUrl = env.PAGE_URL && !env.PAGE_URL.startsWith('PASTE') ? env.PAGE_URL : '';
  const token = await serviceToken(sa);
  const [nights, pods, people] = await Promise.all(['nights', 'pods', 'people'].map((c) => readCollection(sa.project_id, token, c)));
  const messages = buildMessages({ nights, pods, people }, { today: ymdInTz(new Date(), tz), remindDays, pageUrl });
  if (!messages.length) { console.log('No nights to remind about today.'); return; }
  // The webhook comes from the GitHub secret if set, otherwise from the setting organizers saved in the app.
  let webhook = env.DISCORD_WEBHOOK_URL || '', pingWord = env.DISCORD_PING || '';
  if (!webhook) {
    const d = await readDoc(sa.project_id, token, 'config/discord');
    if (d) { webhook = d.webhook || ''; if (!pingWord) pingWord = d.ping || ''; }
  }
  const ping = pingWord ? pingWord + ' ' : '';
  for (const text of messages) {
    if (!webhook) { console.log('--- (no webhook set, printing only)\n' + text); continue; }
    const r = await fetch(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: (ping + text).slice(0, 1900), allowed_mentions: { parse: pingWord ? ['everyone'] : [] } })
    });
    if (!r.ok) throw new Error('Discord returned ' + r.status + ': ' + (await r.text()));
    console.log('Posted reminder for: ' + text.split('\n')[0]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
