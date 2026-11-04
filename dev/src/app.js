(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var CONFIG = BACKEND.config;
var PEOPLE = BACKEND.peopleCol;
var PAGE = BACKEND.pageUrl;
var ACCOUNTS = !!BACKEND.features.accounts;
var HELPER = BACKEND.helper || null;
var REGIONS = ['Upper Bucks', 'Central Bucks', 'Lower Bucks', 'MontCo', 'North Jersey', 'South Jersey'];
function validRegion(r) { return REGIONS.indexOf(r) >= 0 ? r : ''; }
var FORMATS = ['Commander', 'cEDH', 'Draft', 'Sealed', 'Cube', 'Standard', 'Modern', 'Pauper', 'Other'];

function h(tag, props) {
  var el = document.createElement(tag);
  if (props) Object.keys(props).forEach(function (k) {
    var v = props[k];
    if (v == null || v === false) return;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  });
  for (var i = 2; i < arguments.length; i++) {
    var kid = arguments[i];
    (Array.isArray(kid) ? kid : [kid]).forEach(function (c) {
      if (c == null || c === false) return;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
  }
  return el;
}

var S = {
  privByMe: {},
  db: null, uid: null, state: 'init', isAdmin: false, canWriteFlag: null, forcedRO: false, profileName: '', email: '',
  pods: [], nights: [], polls: [], people: {}, members: { emails: [], admins: [] }, requests: [],
  settings: { open: false, blocked: [] }, discord: { webhook: '', ping: '' },
  invites: [], link: null, podEdit: null, podJoin: 'open', podBanner: '',
  series: [], sel: {}, f: { q: '', pod: 'all', format: '', region: '' }, editingSeries: null,
  loaded: { pods: false, nights: false, polls: false, people: false, series: false },
  confirmed: { pods: false, nights: false, polls: false, people: false, series: false },
  slow: false, error: false, confirm: null, nickShown: false, tab: 'games', open: {}, here: null, formPlace: { lat: null, lng: null },
  formPods: new Set(), mode: 'fixed', editing: null,
  // Public data comes from the top-level collections; each private pod keeps its own games under privpods/<id>/.
  pub: { pods: [], nights: [], series: [], polls: [] }, priv: { pods: {}, data: {} }, subs: {}, hidden: {}, hiddenSubs: {}, podVis: 'public',
  request: null, authMode: 'signin', authBusy: false, authError: '', authInfo: '', ciDraft: null
};

/* ---------- dates and text ---------- */
function pad(n) { return String(n).padStart(2, '0'); }
function fmtYmd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayStr() { return fmtYmd(new Date()); }
function parseDate(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function addDaysYmd(s, n) { var d = parseDate(s); d.setDate(d.getDate() + n); return fmtYmd(d); }
function fmtTime(t) {
  if (!t) return '';
  var p = t.split(':').map(Number);
  return (p[0] % 12 || 12) + ':' + pad(p[1]) + ' ' + (p[0] >= 12 ? 'PM' : 'AM');
}
function fmtWhen(date, time, long) {
  var d = parseDate(date);
  var s = d.toLocaleDateString(undefined, { weekday: long ? 'long' : 'short', month: 'short', day: 'numeric' });
  return s + (time ? ' at ' + fmtTime(time) : '');
}
function makeId() { return Math.random().toString(36).slice(2, 10); }
function normEmail(s) { return String(s || '').trim().toLowerCase(); }

/* ---------- people and answers ---------- */
function canWrite() { return !!S.db && !!S.uid && S.canWriteFlag !== false && !S.forcedRO; }
function me() { return S.uid ? S.people[S.uid] : null; }
function livePeople() {
  var blocked = S.settings.blocked || [];
  return Object.keys(S.people).filter(function (k) { return blocked.indexOf(k) < 0; }).map(function (k) { return S.people[k]; });
}
function mineId(by) { return !!S.uid && (by === S.uid || S.isAdmin); }
function podById() { var m = {}; S.pods.forEach(function (p) { m[p.id] = p; }); return m; }
function isPrivPod(id) { return Object.prototype.hasOwnProperty.call(S.priv.pods, id); }
// Where an item lives: '' for the public board, 'privpods/<id>/' for a private pod's games.
function baseOf(item) { return item && item._priv ? 'privpods/' + item._priv + '/' : ''; }
function formBase() {
  var priv = Array.from(S.formPods).filter(isPrivPod);
  return priv.length ? 'privpods/' + priv[0] + '/' : '';
}
function podsSorted() { return S.pods.slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); }); }
function podNames(item, pm) { return (item.podIds || []).map(function (id) { return pm[id]; }).filter(Boolean).map(function (p) { return p.name; }); }
function validVote(v) { return v === 'yes' || v === 'maybe' || v === 'no'; }

function pollVoteOf(person, pollId, optId) {
  var v = person.pv && person.pv[pollId] && person.pv[pollId][optId];
  return validVote(v) ? v : undefined;
}
function answerOf(person, n) {
  var r = person.res || {};
  if (Object.prototype.hasOwnProperty.call(r, n.id)) return r[n.id] === 'none' ? undefined : r[n.id];
  if (n.fromPoll && n.fromOpt) return pollVoteOf(person, n.fromPoll, n.fromOpt);
  return undefined;
}
function invited(person, item, pm) {
  var ids = (item.podIds || []).filter(function (id) { return pm[id]; });
  return ids.length === 0 || ids.some(function (id) { return person.pods && person.pods.indexOf(id) >= 0; });
}
function sortNames(list) { return list.sort(function (a, b) { return a.localeCompare(b); }); }

function tally(n, pm) {
  var c = { yes: [], maybe: [], no: [], wait: [], bring: [] };
  livePeople().forEach(function (p) {
    if (!p.nick) return;
    var st = answerOf(p, n);
    if (st === 'yes' || st === 'maybe' || st === 'no') {
      c[st].push(p);
      var b = p.bring && p.bring[n.id];
      if (b && st !== 'no') c.bring.push(p.nick + ': ' + b);
    } else if (invited(p, n, pm)) c.wait.push(p);
  });
  ['yes', 'maybe', 'no', 'wait'].forEach(function (k) { c[k].sort(function (a, b) { return a.nick.localeCompare(b.nick); }); });
  sortNames(c.bring);
  return c;
}
function statusOf(n, c) {
  var min = n.min || 4;
  if (c.yes.length >= min) return { cls: 'on', text: 'Game on' };
  if (c.yes.length + c.maybe.length >= min) return { cls: 'maybe', text: 'On if the maybes show' };
  return { cls: 'short', text: 'Need ' + (min - c.yes.length) + ' more' };
}
function pollTally(p, pm) {
  var opts = (p.options || []).map(function (o) { return { o: o, yes: [], maybe: [], no: [] }; });
  var wait = [];
  livePeople().forEach(function (person) {
    if (!person.nick) return;
    var voted = false;
    opts.forEach(function (x) {
      var v = pollVoteOf(person, p.id, x.o.id);
      if (v) { voted = true; x[v].push(person.nick); }
    });
    if (!voted && invited(person, p, pm)) wait.push(person.nick);
  });
  var best = null;
  opts.forEach(function (x) {
    sortNames(x.yes); sortNames(x.maybe); sortNames(x.no);
    if (!x.yes.length) return;
    if (!best || x.yes.length > best.yes.length ||
        (x.yes.length === best.yes.length && x.yes.length + x.maybe.length > best.yes.length + best.maybe.length)) best = x;
  });
  return { opts: opts, wait: sortNames(wait), best: best ? best.o.id : null };
}

/* ---------- toast, errors, saving ---------- */
var toastTimer;
function toast(msg) {
  var t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
}
function writeError(e) {
  if (e && e.code === 'invalid_argument') { S.forcedRO = true; renderAll(); return; }
  if (e && e.code === 'quota_exceeded') { toast('The board is full. Remove old nights or pods first.'); return; }
  if (e && e.code === 'permission-denied') { toast('Not allowed. Check that the Firestore rules from SETUP.md are published.'); return; }
  toast('That did not save. Check your connection and try again.');
}
var chain = Promise.resolve();
function saveMe(mutate) {
  chain = chain.then(function () {
    var cur = S.people[S.uid] ? JSON.parse(JSON.stringify(S.people[S.uid])) : { nick: '', pods: [], res: {} };
    delete cur.id;
    mutate(cur);
    S.people[S.uid] = Object.assign({}, cur, { id: S.uid });
    renderAll();
    return S.db.doc(PEOPLE + '/' + S.uid).set(cur);
  }).catch(writeError);
  return chain;
}
function armConfirm(key, again) {
  if (S.confirm !== key) {
    S.confirm = key; again();
    setTimeout(function () { if (S.confirm === key) { S.confirm = null; again(); } }, 4000);
    return false;
  }
  S.confirm = null; return true;
}

/* ---------- messages (Discord and copy) ---------- */
function nightDetails(n, pm) {
  var lines = [fmtWhen(n.date, n.time, true) + (n.place ? ', ' + n.place : '') + (validRegion(n.region) ? ' (' + n.region + ')' : '')];
  var meta = [];
  if (n.format) meta.push(n.format);
  if (hasBrackets(n.format) && n.bracket) meta.push('bracket ' + n.bracket + ' or lower');
  meta.push('need ' + (n.min || 4) + ' players');
  if (n.host) meta.push('host: ' + n.host);
  lines.push(meta.join(', '));
  var pods = podNames(n, pm);
  if (pods.length) lines.push('Calling: ' + pods.join(', '));
  if (n.note) lines.push(n.note);
  return lines;
}
function sendDiscord(text) {
  if (!CONFIG.discordWebhook) return Promise.resolve(false);
  var ping = CONFIG.discordPing ? CONFIG.discordPing + ' ' : '';
  return fetch(CONFIG.discordWebhook, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: (ping + text).slice(0, 1900), allowed_mentions: { parse: CONFIG.discordPing ? ['everyone'] : [] } })
  }).then(function (r) { return r.ok; }).catch(function () { return false; });
}
function showAnnounce(text, sent, heading, priv) {
  $('announceH').textContent = sent ? (heading || 'Night posted') + (priv ? ' and sent to the pod\'s Discord channel' : ' and sent to Discord') : (heading || 'Night posted');
  $('announceHint').textContent = priv
    ? (sent ? 'It went only to this pod\'s private channel. ' : 'This game is private, so it wasn\'t sent to the shared Discord channel. ') + 'If you paste it anywhere, keep it to places only the pod can see.'
    : sent ? 'Paste the same message into any group chat that is not on Discord.'
    : 'Paste this into your group chats so people know to open the page.';
  $('announceText').value = text;
  $('announce').hidden = false;
}
function podOfBase(base) { return base ? base.split('/')[1] : ''; }
function announce(text, heading, payload) {
  // A private pod's games never go to the shared webhook; the helper posts them in the pod's own channel.
  if (payload && !payload.pod) delete payload.pod;
  var priv = !!(payload && payload.pod);
  if (priv && !HELPER) { showAnnounce(text, false, heading, true); return Promise.resolve(); }
  if (HELPER && payload) {
    return HELPER.call('/announce', payload).then(function (r) { showAnnounce(text, !!(r && r.posted), heading, priv); },
      function () { showAnnounce(text, false, heading, priv); });
  }
  return sendDiscord(text).then(function (sent) { showAnnounce(text, sent, heading); });
}

/* ---------- calendar ---------- */
// A recurring game goes into calendars as one repeating event that starts on its first date.
function calBase(n) { var s = n.virtual && seriesById(n.series); return s ? occurrence(s, s.date) : n; }
function calTimes(n) {
  if (!n.time) {
    return { allDay: true, s: n.date.replace(/-/g, ''), e: addDaysYmd(n.date, 1).replace(/-/g, '') };
  }
  var p = n.time.split(':').map(Number), d = parseDate(n.date);
  var s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), p[0], p[1]);
  var hours = /^(Draft|Sealed|Cube)$/.test(n.format || '') ? 4 : 3;
  var e = new Date(s.getTime() + hours * 3600000);
  var f = function (x) { return fmtYmd(x).replace(/-/g, '') + 'T' + pad(x.getHours()) + pad(x.getMinutes()) + '00'; };
  return { allDay: false, s: f(s), e: f(e) };
}
function calDescription(n) { return (n.note ? n.note + '\n' : '') + 'Answer here: ' + PAGE; }
function gcalUrl(n) {
  var t = calTimes(calBase(n));
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + '&text=' + encodeURIComponent(n.title)
    + '&dates=' + t.s + '/' + t.e
    + '&location=' + encodeURIComponent(fullPlace(n))
    + '&details=' + encodeURIComponent(calDescription(n))
    + (n.virtual && seriesById(n.series) ? '&recur=' + encodeURIComponent(rrule(seriesById(n.series))) : '');
}
function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function icsText(n) {
  var t = calTimes(calBase(n)), now = new Date();
  var stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pod Planner//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    'UID:' + (n.virtual ? n.series : n.id) + '@pod-planner', 'DTSTAMP:' + stamp,
    t.allDay ? 'DTSTART;VALUE=DATE:' + t.s : 'DTSTART:' + t.s,
    t.allDay ? 'DTEND;VALUE=DATE:' + t.e : 'DTEND:' + t.e,
    'SUMMARY:' + icsEscape(n.title), 'LOCATION:' + icsEscape(fullPlace(n))].concat(
    n.virtual && seriesById(n.series) ? [rrule(seriesById(n.series))] : [], [
    'DESCRIPTION:' + icsEscape(calDescription(n)), 'END:VEVENT', 'END:VCALENDAR']).join('\r\n') + '\r\n';
}
function downloadIcs(n) {
  Promise.resolve(BACKEND.saveFile((n.title || 'game-night').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.ics', 'text/calendar', icsText(n)))
    .catch(function () { toast('Could not save the calendar file here. Use the Google Calendar link.'); });
}

/* ---------- decks: your decklists, what you're bringing, brackets ----------
   Decks live on your profile. Commander art comes from Scryfall, looked up once when a deck is saved.
   Brackets (1 to 5) only mean something for Commander, so other formats hide them. */
var BRACKETS = ['', 'Exhibition', 'Core', 'Upgraded', 'Optimized', 'cEDH'];
var MAX_DECKS = 20, MAX_BRING = 3;
function hasBrackets(format) { return format === 'Commander'; }
function safeLink(u) { u = String(u || ''); return u.length <= 200 && /^https:\/\/[^\s"'<>\\]+$/i.test(u) ? u : ''; }
function safeArt(u) { u = String(u || ''); return /^https:\/\/cards\.scryfall\.io\/[\w\-./]+(\?[\w=]+)?$/.test(u) ? u : ''; }
function deckList(p) { return Array.isArray(p && p.decks) ? p.decks.filter(function (d) { return d && d.id && d.name; }) : []; }
function decksFor(p, n) {
  var ids = (p && p.dk && Array.isArray(p.dk[n.id])) ? p.dk[n.id] : [];
  var all = deckList(p);
  return ids.map(function (id) { return all.filter(function (d) { return d.id === id; })[0]; }).filter(Boolean);
}
function overLimit(d, n) { return hasBrackets(n.format) && n.bracket > 0 && d.b > n.bracket; }
function commanderArt(name) {
  name = String(name || '').trim();
  if (!name || typeof fetch !== 'function') return Promise.resolve(null);
  return fetch('https://api.scryfall.com/cards/named?fuzzy=' + encodeURIComponent(name), { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (c) {
      if (!c || !c.name) return null;
      var face = c.card_faces && c.card_faces[0] ? c.card_faces[0] : {};
      var iu = c.image_uris || face.image_uris || {};
      return { name: String(c.name).slice(0, 80), art: safeArt(iu.art_crop), artist: String(c.artist || face.artist || '').slice(0, 60) };
    })
    .catch(function () { return null; });
}
// Commander type-ahead: as you type, Scryfall suggests legal commanders (most played first).
var cmdSeq = 0, cmdCache = {}, cmdTimer = null;
function commanderSearch(q) {
  if (cmdCache[q]) return Promise.resolve(cmdCache[q]);
  var url = 'https://api.scryfall.com/cards/search?order=edhrec&unique=cards&q=' + encodeURIComponent('is:commander ' + q);
  return fetch(url, { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : { data: [] }; })
    .then(function (j) {
      var list = (j.data || []).slice(0, 8).map(function (c) {
        var face = c.card_faces && c.card_faces[0] ? c.card_faces[0] : {};
        var iu = c.image_uris || face.image_uris || {};
        return { name: String(c.name || '').slice(0, 80), type: String(c.type_line || '').slice(0, 80), art: safeArt(iu.art_crop), artist: String(c.artist || face.artist || '').slice(0, 60) };
      }).filter(function (c) { return c.name; });
      cmdCache[q] = list;
      return list;
    }).catch(function () { return []; });
}
function cmdList(open) {
  var ul = $('dCmdList');
  ul.hidden = !open; $('dCmd').setAttribute('aria-expanded', String(!!open));
  if (!open) { S.cmdActive = -1; $('dCmd').removeAttribute('aria-activedescendant'); }
}
function renderCmdList(list) {
  var ul = $('dCmdList'); ul.replaceChildren();
  S.cmdOptions = list; S.cmdActive = -1;
  if (!list.length) { cmdList(false); return; }
  list.forEach(function (c, i) {
    var thumb = h('span', { class: 'dart md', 'aria-hidden': 'true' });
    if (c.art) thumb.style.backgroundImage = 'url("' + c.art + '")';
    ul.append(h('li', { id: 'cmdopt' + i, role: 'option', class: 'sopt', 'aria-selected': 'false',
      onmousedown: function (e) { e.preventDefault(); pickCommander(c); } },
      thumb, h('span', { class: 'sname' }, h('b', { text: c.name }), h('small', { text: c.type }), c.artist ? h('small', { text: 'Art: ' + c.artist }) : null)));
  });
  cmdList(true);
}
function moveCmd(step) {
  var n = (S.cmdOptions || []).length; if (!n || $('dCmdList').hidden) return false;
  S.cmdActive = (S.cmdActive + step + n) % n;
  $('dCmdList').querySelectorAll('.sopt').forEach(function (li, i) { li.setAttribute('aria-selected', String(i === S.cmdActive)); if (i === S.cmdActive && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' }); });
  $('dCmd').setAttribute('aria-activedescendant', 'cmdopt' + S.cmdActive);
  return true;
}
function pickCommander(c) {
  $('dCmd').value = c.name;
  S.deckPick = c;
  cmdList(false);
}
function onCmdInput() {
  S.deckPick = null;
  var q = $('dCmd').value.trim();
  clearTimeout(cmdTimer);
  if (q.length < 2) { cmdList(false); return; }
  var seq = ++cmdSeq;
  cmdTimer = setTimeout(function () {
    commanderSearch(q).then(function (list) { if (seq === cmdSeq && document.activeElement === $('dCmd')) renderCmdList(list); });
  }, 250);
}
function deckArt(d, cls) {
  var art = safeArt(d.art);
  var el = h('span', { class: 'dart' + (cls ? ' ' + cls : '') + (art ? '' : ' none'), 'aria-hidden': 'true', text: art ? '' : initial(d.name) });
  if (art) el.style.backgroundImage = 'url("' + art + '")';
  return el;
}
function bracketChip(b, over) { return b ? h('span', { class: 'bchip' + (over ? ' over' : ''), title: 'Bracket ' + b + ' (' + BRACKETS[b] + ')', text: 'B' + b }) : null; }
function renderDecks() {
  var box = $('deckList'); if (!box) return;
  box.replaceChildren();
  var list = deckList(me());
  $('addDeckBtn').hidden = list.length >= MAX_DECKS;
  if (!list.length) box.append(h('p', { class: 'hint', text: 'No decks yet. Add the decks you play, then pick which ones you\'re bringing to each game.' }));
  list.forEach(function (d) {
    var link = safeLink(d.url);
    box.append(h('div', { class: 'deckrow' },
      deckArt(d),
      h('div', { class: 'dinfo' },
        link ? h('a', { href: link, target: '_blank', rel: 'noopener', class: 'dname' }, d.name) : h('b', { class: 'dname', text: d.name }),
        h('span', { class: 'dsub' }, [d.cmd || null, d.b ? 'Bracket ' + d.b + ' · ' + BRACKETS[d.b] : null, d.artist ? 'Art: ' + d.artist : null].filter(Boolean).join(' · '))),
      h('button', { type: 'button', class: 'link', onclick: function () { openDeckForm(d); } }, 'Edit')));
  });
}
function openDeckForm(d) {
  S.deckEdit = d ? d.id : null;
  $('dName').value = d ? d.name : ''; $('dCmd').value = d ? (d.cmd || '') : '';
  $('dBracket').value = String(d ? (d.b || 0) : 0); $('dUrl').value = d ? (d.url || '') : '';
  $('deckDelete').hidden = !d; $('deckDelete').textContent = 'Remove deck';
  $('deckSave').textContent = d ? 'Save deck' : 'Add deck';
  $('deckForm').hidden = false; $('dName').focus();
}
function closeDeckForm() { $('deckForm').hidden = true; S.deckEdit = null; }
function submitDeck() {
  if (!canWrite() || S.deckBusy) return;
  var name = $('dName').value.trim().slice(0, 40); if (!name) return;
  var url = $('dUrl').value.trim();
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  url = url.replace(/^http:\/\//i, 'https://');
  if (url && !safeLink(url)) { toast("That link doesn't look right. Copy it from the deck's page."); return; }
  var cmd = $('dCmd').value.trim().slice(0, 80), b = Math.min(5, Math.max(0, parseInt($('dBracket').value, 10) || 0));
  var old = S.deckEdit ? deckList(me()).filter(function (x) { return x.id === S.deckEdit; })[0] : null;
  var same = old && (old.cmd || '') === cmd && (old.art || !cmd);
  var btn = $('deckSave'), label = btn.textContent;
  S.deckBusy = true;
  if (cmd && !same) { btn.disabled = true; btn.textContent = 'Finding the commander…'; }
  var picked = S.deckPick && S.deckPick.name === cmd && S.deckPick.art ? S.deckPick : null;
  (same ? Promise.resolve(old.art ? { name: old.cmd, art: old.art, artist: old.artist } : null) : picked ? Promise.resolve(picked) : commanderArt(cmd)).then(function (c) {
    S.deckBusy = false; btn.disabled = false; btn.textContent = label;
    var d = { id: old ? old.id : makeId(), name: name, b: b };
    if (url) d.url = url;
    if (cmd) d.cmd = c ? c.name : cmd;
    if (c && c.art) { d.art = c.art; if (c.artist) d.artist = c.artist; }
    saveMe(function (me) {
      var list = deckList(me);
      var i = list.map(function (x) { return x.id; }).indexOf(d.id);
      if (i >= 0) list[i] = d; else list.push(d);
      me.decks = list.slice(0, MAX_DECKS);
    }).then(function () { toast(cmd && !c ? "Saved. Couldn't find that commander, so no art. Check the spelling." : 'Deck saved'); });
    closeDeckForm();
  });
}
function deleteDeck() {
  var id = S.deckEdit; if (!id || !armConfirm('dk:' + id, function () { $('deckDelete').textContent = S.confirm === 'dk:' + id ? 'Tap again to remove' : 'Remove deck'; })) return;
  saveMe(function (c) {
    c.decks = deckList(c).filter(function (d) { return d.id !== id; });
    Object.keys(c.dk || {}).forEach(function (k) { c.dk[k] = c.dk[k].filter(function (x) { return x !== id; }); if (!c.dk[k].length) delete c.dk[k]; });
  }).then(function () { toast('Deck removed'); });
  closeDeckForm();
}
function toggleBringDeck(n, id) {
  if (!canWrite()) return;
  var cur = decksFor(me(), n).map(function (d) { return d.id; });
  var on = cur.indexOf(id) >= 0;
  if (!on && cur.length >= MAX_BRING) { toast('Pick up to ' + MAX_BRING + ' decks.'); return; }
  saveMe(function (c) {
    c.dk = c.dk || {};
    var list = (c.dk[n.id] || []).filter(function (x) { return x !== id; });
    if (!on) list.push(id);
    if (list.length) c.dk[n.id] = list; else delete c.dk[n.id];
  });
}
function deckPicker(n) {
  var mine = deckList(me());
  var wrap = h('div', { class: 'deckpick' }, h('span', { class: 'sublabel', text: 'Decks you\'re bringing' }));
  if (!mine.length) {
    wrap.append(h('p', { class: 'hint fine' }, 'Add your decks on the ', h('button', { type: 'button', class: 'link', onclick: function () { setTab('me'); } }, 'Me tab'), ' to show what you\'re bringing.'));
    return wrap;
  }
  var chosen = decksFor(me(), n).map(function (d) { return d.id; });
  var br = hasBrackets(n.format);
  wrap.append(h('div', { class: 'deckchips', role: 'group', 'aria-label': 'Decks you are bringing' }, mine.map(function (d) {
    var over = overLimit(d, n);
    return h('button', { type: 'button', class: 'deckchip' + (over ? ' over' : ''), 'aria-pressed': String(chosen.indexOf(d.id) >= 0), onclick: function () { toggleBringDeck(n, d.id); } },
      deckArt(d, 'sm'), h('span', { text: d.name }), br ? bracketChip(d.b, over) : null);
  })));
  return wrap;
}

/* ---------- places: address lookup and rough distances ----------
   Addresses and areas are turned into map coordinates with OpenStreetMap's free search, once, when saved.
   Distances are straight-line miles; tapping an address opens directions in the phone's map app. */
var GEO_URL = 'https://nominatim.openstreetmap.org/search';
function roundTo(x, d) { var m = Math.pow(10, d); return Math.round(x * m) / m; }
function geocode(q) {
  q = String(q || '').trim();
  if (!q || typeof fetch !== 'function') return Promise.resolve(null);
  var zip = /^\d{5}(-\d{4})?$/.test(q);
  var url = GEO_URL + '?format=jsonv2&limit=1&' + (zip ? 'countrycodes=us&postalcode=' + encodeURIComponent(q.slice(0, 5)) : 'q=' + encodeURIComponent(q));
  var ctl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
  return fetch(url, ctl ? { signal: ctl.signal } : {})
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (a) {
      clearTimeout(timer);
      var lat = a && a[0] ? Number(a[0].lat) : NaN, lng = a && a[0] ? Number(a[0].lon) : NaN;
      return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: lat, lng: lng } : null;
    })
    .catch(function () { clearTimeout(timer); return null; });
}
// Coordinates for the address in the form: reused if the address didn't change, looked up otherwise.
function resolvePlace(address, old) {
  if (!address) return Promise.resolve({ lat: null, lng: null });
  if (old && old.address === address && typeof old.lat === 'number') return Promise.resolve({ lat: old.lat, lng: old.lng });
  return geocode(address).then(function (g) { return g ? { lat: roundTo(g.lat, 4), lng: roundTo(g.lng, 4) } : { lat: null, lng: null }; });
}
function myOrigin() {
  if (S.here) return S.here;
  var m = me();
  return m && typeof m.alat === 'number' && typeof m.alng === 'number' ? { lat: m.alat, lng: m.alng } : null;
}
function milesBetween(a, b) {
  var R = 3958.8, rad = Math.PI / 180;
  var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
function distanceText(item) {
  var o = myOrigin();
  if (!o || typeof item.lat !== 'number' || typeof item.lng !== 'number') return '';
  var mi = milesBetween(o, { lat: item.lat, lng: item.lng });
  return mi < 1 ? 'Under 1 mi' : mi < 10 ? (Math.round(mi * 10) / 10) + ' mi' : Math.round(mi) + ' mi';
}
function isApple() { return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent || '') && 'ontouchend' in document; }
function mapsUrl(address) {
  return isApple() ? 'https://maps.apple.com/?daddr=' + encodeURIComponent(address)
    : 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(address);
}
function addressOf(n) { return n.addrIn ? ((S.hidden[n.id] && S.hidden[n.id].address) || '') : (n.address || ''); }
function fullPlace(n) { return [n.place, addressOf(n)].filter(Boolean).join(', '); }
function useHere() {
  if (!navigator.geolocation) { toast("This browser can't share your location."); return; }
  $('hereNote').textContent = 'Finding you…';
  navigator.geolocation.getCurrentPosition(function (pos) {
    S.here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    $('hereNote').textContent = 'Using where you are now for this visit. Not saved.';
    renderNights(); renderPolls();
  }, function () {
    $('hereNote').textContent = '';
    toast("Couldn't get your location. Check that location is allowed for this site.");
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
}

/* ---------- board actions ---------- */
function fillNick() {
  $('nick').value = (me() && me().nick) || S.profileName || '';
  $('area').value = (me() && me().area) || '';
  S.ciDraft = validCi(me() && me().ci);
  renderCiPick();
  renderDiscordProfile();
}
function openNick(focus) {
  setTab('me');
  if (focus) $('nick').focus();
}
// Leave the profile without saving: put the form back and go to the games.
function closeNick() {
  S.ciDraft = null;
  applyIdentity(me() && me().ci);
  setTab('games');
}
function needNick() {
  if (me() && me().nick) return false;
  toast('Add your name first');
  openNick(true); return true;
}

/* ---------- tabs ----------
   Games, Pods, Me and (for organizers) Organizer. A bottom bar on phones, tabs along the top on wide screens.
   The tab is in the address (#games, #pods, #me, #organizer), so the back button and links work. */
var TABS = ['games', 'pods', 'me', 'organizer'];
function tabAllowed(t) {
  if (t === 'organizer') return !!(ACCOUNTS && S.isAdmin && S.state === 'ok');
  if (t === 'me') return canWrite();
  return TABS.indexOf(t) >= 0;
}
function setTab(t, fromHash) {
  if (!tabAllowed(t)) t = 'games';
  var was = S.tab;
  if (was === 'me' && t !== 'me' && S.ciDraft != null) { S.ciDraft = null; applyIdentity(me() && me().ci); }
  S.tab = t;
  if (t === 'me' && was !== 'me') fillNick();
  if (!fromHash && location.hash !== '#' + t) {
    try { history.pushState(null, '', '#' + t); } catch (e) { location.hash = t; }
  }
  renderTabs();
  if (was !== t && !fromHash) window.scrollTo(0, 0);
}
function tabFromHash() {
  var t = (location.hash || '').slice(1);
  return TABS.indexOf(t) >= 0 ? t : null;
}
function renderTabs() {
  var on = !gated() && S.state === 'ok' && !!S.db;
  $('tabs').hidden = !on;
  document.body.classList.toggle('tabbed', on);
  if (on && !tabAllowed(S.tab)) S.tab = 'games';
  var t = on ? S.tab : 'games';
  $('tabOrg').hidden = !tabAllowed('organizer');
  document.querySelectorAll('#tabs button').forEach(function (b) {
    if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('view-games').hidden = t !== 'games';
  $('view-pods').hidden = t !== 'pods';
  $('view-me').hidden = t !== 'me';
  $('membersSec').hidden = !(t === 'organizer' && tabAllowed('organizer'));
  if (t === 'me' && !$('nick').value && document.activeElement !== $('nick') && me() && me().nick) fillNick();
  $('welcome').hidden = !(t === 'me' && !(me() && me().nick));
  $('nickCancel').hidden = !(me() && me().nick);
  var need = needsCount();
  badge('badgeGames', need, need === 1 ? '1 game needs your answer' : need + ' games need your answer');
  var inv = myInvites().length + approvals().length;
  badge('badgePods', inv, inv === 1 ? '1 pod invite' : inv + ' pod invites');
}
function badge(id, n, label) {
  var b = $(id); b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n || '');
  if (n) b.setAttribute('aria-label', label); else b.removeAttribute('aria-label');
}

/* ---------- card details: compact on phones unless you choose otherwise ---------- */
function cardsPref() {
  try { var v = localStorage.getItem('pp.cards'); if (v === 'open' || v === 'compact') return v; } catch (e) {}
  return '';
}
function cardsOpenByDefault() {
  var v = cardsPref();
  if (v) return v === 'open';
  return !!(window.matchMedia && window.matchMedia('(min-width: 900px)').matches);
}
function setCardsPref(v) {
  try { localStorage.setItem('pp.cards', v); } catch (e) {}
  S.open = {};
  renderCardsSeg(); renderNights();
}
function renderCardsSeg() {
  var open = cardsOpenByDefault();
  document.querySelectorAll('#cardsSeg button').forEach(function (b) { b.setAttribute('aria-pressed', String((b.dataset.cards === 'open') === open)); });
}
function isOpen(key) { return Object.prototype.hasOwnProperty.call(S.open, key) ? S.open[key] : cardsOpenByDefault(); }

/* ---------- what still needs your answer ---------- */
var NEED_DAYS = 14;
function needsNight(n, pm) {
  var m = me();
  if (!m || !m.nick) return false;
  if (n.date > addDaysYmd(todayStr(), NEED_DAYS)) return false;
  return invited(m, n, pm) && !answerOf(m, n);
}
function needsPoll(p, pm) {
  var m = me();
  if (!m || !m.nick || !invited(m, p, pm)) return false;
  return !(p.options || []).some(function (o) { return pollVoteOf(m, p.id, o.id); });
}
function needsCount() {
  if (!canWrite() || !S.loaded.nights || !S.loaded.series) return 0;
  var pm = podById();
  return groupNights(upcomingNights()).filter(function (g) { return needsNight(g.items[0], pm); }).length
    + S.polls.filter(function (p) { return needsPoll(p, pm); }).length;
}
function myInvites() {
  if (!canWrite()) return [];
  var pm = podById(), mine = myPods();
  return S.invites.filter(function (x) { return x.uid === S.uid && pm[x.podId] && mine.indexOf(x.podId) < 0 && (!pm[x.podId].private || x.ok === true); });
}

/* ---------- the "Call a night" sheet ---------- */
function openSheet() {
  var f = $('nightForm');
  S.sheetReturn = document.activeElement;
  f.hidden = false; $('sheetBackdrop').hidden = false;
  document.body.classList.add('sheet-open');
  f.scrollTop = 0;
  $('nTitle').focus();
}
function closeSheet() {
  var f = $('nightForm');
  if (f.hidden) return;
  f.hidden = true; $('sheetBackdrop').hidden = true;
  document.body.classList.remove('sheet-open');
  var r = S.sheetReturn; S.sheetReturn = null;
  if (r && r.focus && document.contains(r)) r.focus();
}
function derivedFromPoll(c, n) { return !!(n.fromPoll && n.fromOpt && c.pv && c.pv[n.fromPoll] && validVote(c.pv[n.fromPoll][n.fromOpt])); }
function answer(n, k) {
  if (!canWrite() || needNick()) return;
  var cur = answerOf(me(), n);
  var before = tally(n, podById()).yes.length;
  saveMe(function (c) {
    c.res = c.res || {};
    if (cur === k) { if (derivedFromPoll(c, n)) c.res[n.id] = 'none'; else delete c.res[n.id]; }
    else c.res[n.id] = k;
  });
  if (k === 'yes' && cur !== 'yes') {
    var min = n.min || 4;
    if (before < min && before + 1 >= min) confetti();
    maybeGameOn(n, before);
  }
}
function maybeGameOn(n, before) {
  var min = n.min || 4;
  if (n.gameOnPosted || before >= min || before + 1 < min) return;
  if (HELPER) {
    // give the answer a moment to save; the helper recounts the seats itself
    setTimeout(function () { HELPER.call('/announce', n._priv ? { kind: 'gameon', id: n.id, pod: n._priv } : { kind: 'gameon', id: n.id }).catch(function () {}); }, 1500);
    return;
  }
  if (!CONFIG.discordWebhook || n._priv) return;
  if (n.virtual) { try { if (localStorage.getItem('gameon:' + n.id)) return; localStorage.setItem('gameon:' + n.id, '1'); } catch (e) {} }
  else S.db.doc(baseOf(n) + 'nights/' + n.id).update({ gameOnPosted: true }).catch(function () {});
  var text = ['Game on: ' + n.title + ' has ' + min + ' of ' + min + ' seats.'].concat(nightDetails(n, podById()), ['Details: ' + PAGE]).join('\n');
  sendDiscord(text);
}
function votePoll(p, oid, k) {
  if (!canWrite() || needNick()) return;
  var cur = pollVoteOf(me(), p.id, oid);
  saveMe(function (c) {
    c.pv = c.pv || {};
    var m = c.pv[p.id] = c.pv[p.id] || {};
    if (cur === k) delete m[oid]; else m[oid] = k;
    if (!Object.keys(m).length) delete c.pv[p.id];
  });
}
function saveBring(n, text) {
  var v = text.trim().slice(0, 60);
  if (((me() && me().bring && me().bring[n.id]) || '') === v) return;
  saveMe(function (c) { c.bring = c.bring || {}; if (v) c.bring[n.id] = v; else delete c.bring[n.id]; });
}
function cancelNight(n) {
  if (!armConfirm('n:' + n.id, renderNights)) return;
  if (n.addrIn) S.db.doc(baseOf(n) + 'nights/' + n.id + '/hidden/place').delete().catch(function () {});
  S.db.doc(baseOf(n) + 'nights/' + n.id).delete().then(function () { toast('Night cancelled'); }).catch(writeError);
}
function cancelSeries(n) {
  if (!armConfirm('s:' + n.id, renderNights)) return;
  var rest = S.nights.filter(function (x) { return x.series === n.series && x.date >= n.date; });
  Promise.all(rest.map(function (x) { return S.db.doc(baseOf(x) + 'nights/' + x.id).delete(); }))
    .then(function () { toast(rest.length + ' nights cancelled'); }).catch(writeError);
}
function deletePoll(p) {
  if (!armConfirm('d:' + p.id, renderPolls)) return;
  S.db.doc(baseOf(p) + 'polls/' + p.id).delete().then(function () { toast('Poll deleted'); }).catch(writeError);
}
function lockIn(p, o) {
  if (!canWrite()) return;
  if (!armConfirm('l:' + p.id + o.id, renderPolls)) return;
  var doc = {
    title: p.title, date: o.date, time: o.time || '', place: p.place || '', host: p.host || '', format: p.format,
    address: p.address || '', lat: typeof p.lat === 'number' ? p.lat : null, lng: typeof p.lng === 'number' ? p.lng : null, bracket: p.bracket || 0, region: p.region || '',
    min: p.min || 4, podIds: p.podIds || [], note: p.note || '', fromPoll: p.id, fromOpt: o.id, by: S.uid, at: Date.now()
  };
  S.db.collection(baseOf(p) + 'nights').add(doc).then(function (ref) {
    S.db.doc(baseOf(p) + 'polls/' + p.id).delete().catch(writeError);
    var text = ['Locked in: ' + p.title].concat(nightDetails(doc, podById()), ['Confirm your answer: ' + PAGE]).join('\n');
    toast('Night locked in');
    return announce(text, 'Night locked in', { kind: 'locked', id: ref.id, pod: p._priv || '' });
  }).catch(writeError);
}

/* ---------- pods: settings, invites, Discord ---------- */
function myPods() { return (me() && me().pods) || []; }
function myInvite(podId) { return S.invites.filter(function (x) { return x.podId === podId && x.uid === S.uid; })[0]; }
function canJoinPod(p) { return !p || p.join !== 'invite' || p.by === S.uid || S.isAdmin || !!myInvite(p.id); }
var syncTimer = null;
function helperSync() {
  if (!HELPER || !S.link) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(function () { HELPER.call('/sync', {}).catch(function () {}); }, 1200);
}
function togglePod(id) {
  if (!canWrite() || needNick()) return;
  var p = podById()[id], inIt = myPods().indexOf(id) >= 0;
  if (!inIt && !canJoinPod(p)) { toast(p.name + ' is invite only. Ask someone in it to invite you.'); return; }
  if (inIt && p && p.private && !S.isAdmin && p.by !== S.uid) {
    if (S.confirm !== 'leave:' + id) { armConfirm('leave:' + id, renderPods); toast('Tap again to leave ' + p.name + '. You\'ll need a new invite to get back in.'); return; }
    S.confirm = null;
  }
  saveMe(function (c) {
    c.pods = c.pods || [];
    var i = c.pods.indexOf(id);
    if (i >= 0) c.pods.splice(i, 1); else { c.pods.push(id); c.joining = id; }
  }).then(function () {
    var inv = !inIt && myInvite(id);
    if (inv) S.db.doc('invites/' + inv.id).delete().catch(function () {});
    helperSync();
  });
}
function invitablePods() {
  return podsSorted().filter(function (p) { return p.join === 'invite' && (myPods().indexOf(p.id) >= 0 || p.by === S.uid || S.isAdmin); });
}
// Private pods: an invite from a member waits for the pod's creator (or an organizer) to approve it.
// Until then the invited person doesn't see the pod at all. An invite is used up when someone joins.
function canApprove(p) { return !!p && (S.isAdmin || p.by === S.uid); }
function approvals() {
  return S.invites.filter(function (x) { return x.ok !== true && isPrivPod(x.podId) && canApprove(S.priv.pods[x.podId]); });
}
function sendInvite(podId, uid) {
  if (!podId || !uid) { toast('Pick a pod and a person.'); return; }
  var who = S.people[uid], pod = podById()[podId];
  var ok = !(pod && pod.private) || canApprove(pod);
  var owner = pod && S.people[pod.by];
  S.db.doc('invites/' + podId + '_' + uid).set({ podId: podId, uid: uid, by: S.uid, at: Date.now(), ok: ok })
    .then(function () {
      toast(ok ? 'Invite sent to ' + ((who && who.nick) || 'them')
        : 'Sent to ' + ((owner && owner.nick) || "the pod's creator") + ' to approve. ' + ((who && who.nick) || 'They') + ' will see it once approved.');
      $('inviteForm').hidden = true;
    }).catch(writeError);
}
function approveInvite(inv) { S.db.doc('invites/' + inv.id).update({ ok: true }).then(function () { toast('Approved'); }).catch(writeError); }
function declineInvite(inv) {
  if (!armConfirm('dec:' + inv.id, renderInvites)) return;
  S.db.doc('invites/' + inv.id).delete().then(function () { toast('Declined'); }).catch(writeError);
}
function joinFromInvite(inv) {
  if (!canWrite() || needNick()) return;
  saveMe(function (c) {
    c.pods = c.pods || [];
    if (c.pods.indexOf(inv.podId) < 0) { c.pods.push(inv.podId); c.joining = inv.podId; }
  }).then(function () { S.db.doc('invites/' + inv.id).delete().catch(function () {}); helperSync(); });
}
function fillInviteSelects() {
  var pods = invitablePods(), podSel = $('invPod'), whoSel = $('invWho');
  var keepPod = podSel.value, keepWho = whoSel.value;
  podSel.replaceChildren.apply(podSel, pods.map(function (p) { return h('option', { value: p.id, text: p.name }); }));
  if (pods.some(function (p) { return p.id === keepPod; })) podSel.value = keepPod;
  var podId = podSel.value;
  var invited = S.invites.filter(function (x) { return x.podId === podId; }).map(function (x) { return x.uid; });
  var people = livePeople().filter(function (p) { return p.nick && p.id !== S.uid && (p.pods || []).indexOf(podId) < 0 && invited.indexOf(p.id) < 0; })
    .sort(function (a, b) { return a.nick.localeCompare(b.nick); });
  var opts = people.map(function (p) { return h('option', { value: p.id, text: p.nick }); });
  if (!opts.length) opts = [h('option', { value: '', text: 'Everyone is already in or invited' })];
  whoSel.replaceChildren.apply(whoSel, opts);
  if (people.some(function (p) { return p.id === keepWho; })) whoSel.value = keepWho;
}
function renderInvites() {
  var box = $('invites'); box.replaceChildren();
  if (!canWrite()) { $('inviteBox').hidden = true; return; }
  var pm = podById();
  myInvites().forEach(function (inv) {
    var p = pm[inv.podId], from = S.people[inv.by];
    box.append(h('div', { class: 'panel invite' },
      h('p', null, h('b', { text: (from && from.nick) || 'Someone' }), ' invited you to ', h('b', { text: p.name })),
      h('div', { class: 'mact' },
        h('button', { type: 'button', class: 'primary small', onclick: function () { joinFromInvite(inv); } }, 'Join pod'),
        h('button', { type: 'button', class: 'link', onclick: function () { S.db.doc('invites/' + inv.id).delete().catch(writeError); } }, 'No thanks'))));
  });
  approvals().forEach(function (inv) {
    var p = S.priv.pods[inv.podId], from = S.people[inv.by], who = S.people[inv.uid], armed = S.confirm === 'dec:' + inv.id;
    box.append(h('div', { class: 'panel invite approve' },
      h('p', null, h('b', { text: (from && from.nick) || 'Someone' }), ' wants to invite ', h('b', { text: (who && who.nick) || 'someone' }), ' to ', h('b', { text: p.name }), '.'),
      h('div', { class: 'mact' },
        h('button', { type: 'button', class: 'primary small', onclick: function () { approveInvite(inv); } }, 'Approve'),
        h('button', { type: 'button', class: 'link' + (armed ? ' danger' : ''), onclick: function () { declineInvite(inv); } }, armed ? 'Tap again to decline' : 'Decline'))));
  });
  var waiting = S.invites.filter(function (x) { return x.by === S.uid && x.ok === false && isPrivPod(x.podId) && !canApprove(S.priv.pods[x.podId]); });
  if (waiting.length) box.append(h('p', { class: 'hint', text: 'Waiting for approval: ' + waiting.map(function (x) {
    var w = S.people[x.uid]; return ((w && w.nick) || 'someone') + ' to ' + S.priv.pods[x.podId].name; }).join(', ') + '.' }));
  var pods = invitablePods();
  $('inviteBox').hidden = !pods.length;
  var focusIn = $('inviteForm').contains(document.activeElement);
  if (pods.length && !$('inviteForm').hidden && !focusIn) fillInviteSelects();
}
function setPodVis(v) {
  S.podVis = v;
  var p = S.podEdit ? podById()[S.podEdit] : null, locked = !!p && !S.isAdmin;
  document.querySelectorAll('#podVisSeg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.vis === v)); b.disabled = locked; });
  $('podVisHint').textContent = v === 'private'
    ? 'Only its members (and organizers) can see this pod, who is in it, and its games. People join by invite: members can suggest someone, and the pod\'s creator approves. Its games post in its own private Discord channel.'
    : 'Everyone on the board can see this pod and its games.';
  if (locked) $('podVisHint').textContent += ' Only an organizer can change this for an existing pod.';
  $('podJoinField').hidden = v === 'private';
  $('podOpenSeatsRow').hidden = v === 'private';
}
function setPodJoin(v) {
  S.podJoin = v;
  document.querySelectorAll('#podJoinSeg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.join === v)); });
  $('podJoinHint').textContent = v === 'invite'
    ? 'Members invite people in. This pod is still visible to everyone, and anyone can answer its games. To hide it, choose Members only above.'
    : 'Anyone can tap to join.';
}
function openPodForm(p) {
  var f = $('podForm');
  S.podEdit = p ? p.id : null;
  $('podFormH').textContent = p ? 'Edit pod' : 'New pod';
  $('podSubmit').textContent = p ? 'Save pod' : 'Add pod';
  $('podName').value = p ? p.name : '';
  var mana = (p && p.mana) || 'U';
  f.querySelectorAll('input[name=mana]').forEach(function (r) { r.checked = r.value === mana; });
  setPodJoin((p && p.join) || 'open');
  setPodVis(p && p.private ? 'private' : 'public');
  S.podBanner = (p && p.banner) || '';
  renderBannerPick();
  $('podOpenSeats').checked = !p || p.openSeats !== false;
  $('podDelete').hidden = !p;
  $('podDelete').textContent = 'Remove pod';
  f.hidden = false;
  $('podName').focus();
}
function submitPod() {
  if (!canWrite()) return;
  var name = $('podName').value.trim(); if (!name) return;
  var mana = ($('podForm').querySelector('input[name=mana]:checked') || {}).value || 'U';
  var priv = S.podVis === 'private';
  var data = { name: name, mana: mana, join: priv ? 'invite' : S.podJoin, openSeats: priv ? false : $('podOpenSeats').checked, banner: S.podBanner || '' };
  var done = function (msg) { $('podForm').hidden = true; S.podEdit = null; toast(msg); helperSync(); };
  if (S.podEdit) {
    var cur = podById()[S.podEdit];
    if (!cur) return;
    var path = (cur.private ? 'privpods/' : 'pods/') + cur.id;
    var change = S.isAdmin && !!cur.private !== priv;
    S.db.doc(path).update(data).then(function () {
      if (!change) { done('Pod saved'); return; }
      return movePod(Object.assign({}, cur, data), priv).then(function () {
        done(priv ? cur.name + ' is private now' : cur.name + ' is visible to everyone now');
      });
    }).catch(writeError);
  } else {
    S.db.collection(priv ? 'privpods' : 'pods').add(Object.assign(data, { by: S.uid, at: Date.now() })).then(function (ref) {
      if (priv) { S.priv.pods[ref.id] = Object.assign({}, data, { id: ref.id, by: S.uid, private: true }); S.privByMe[ref.id] = true; mergeData(); }
      // the creator is the pod's first member
      if (me() && me().nick) saveMe(function (c) { c.pods = c.pods || []; if (c.pods.indexOf(ref.id) < 0) { c.pods.push(ref.id); c.joining = ref.id; } });
      done('Pod added');
    }).catch(writeError);
  }
}
function deletePodFromForm() {
  var id = S.podEdit; if (!id) return;
  if (S.confirm !== 'p:' + id) {
    S.confirm = 'p:' + id; $('podDelete').textContent = 'Tap again to remove';
    setTimeout(function () { if (S.confirm === 'p:' + id) { S.confirm = null; $('podDelete').textContent = 'Remove pod'; } }, 4000);
    return;
  }
  S.confirm = null;
  var p = podById()[id], ops = [];
  if (p && p.private) {
    ['nights', 'series', 'polls'].forEach(function (k) { S[k].forEach(function (x) { if (x._priv === id) ops.push(['delete', 'privpods/' + id + '/' + k + '/' + x.id]); }); });
    ops.push(['delete', 'privpods/' + id]);
  } else ops.push(['delete', 'pods/' + id]);
  writeAll(ops).then(function () { $('podForm').hidden = true; S.podEdit = null; toast('Pod removed'); }).catch(writeError);
}
function renderDiscordProfile() {
  var box = $('discordProfile');
  box.hidden = !HELPER || !canWrite();
  if (box.hidden) return;
  var row = $('discordLinkRow'); row.replaceChildren();
  if (S.link) {
    var armed = S.confirm === 'unlink';
    row.append(h('span', { class: 'linked' }, 'Connected as ', h('b', { text: S.link.name || 'your Discord account' })),
      h('button', { type: 'button', class: 'link' + (armed ? ' danger' : ''), onclick: unlinkDiscord }, armed ? 'Tap again to disconnect' : 'Disconnect'));
  } else {
    row.append(h('button', { type: 'button', class: 'ghost', id: 'connectDiscord', onclick: connectDiscord }, 'Connect Discord'),
      h('span', { class: 'hint', text: 'Joins our server and gives you your pod roles (and private pod channels) automatically.' }));
  }
  if (document.activeElement !== $('openSeatsMe')) $('openSeatsMe').checked = !!(me() && me().openSeats);
}
function connectDiscord() {
  HELPER.call('/link/start', {}).then(function (r) { BACKEND.go(r.url); }, function () { toast("Couldn't reach the Discord helper. Try again in a minute."); });
}
function unlinkDiscord() {
  if (!armConfirm('unlink', renderDiscordProfile)) return;
  HELPER.call('/link/remove', {}).then(function () { S.link = null; renderAll(); toast('Discord disconnected'); },
    function () { toast("Couldn't reach the Discord helper. Try again in a minute."); });
}

/* ---------- accounts ---------- */
function gated() { return ACCOUNTS && (S.state === 'signedout' || S.state === 'unverified' || S.state === 'notmember'); }
function authErrorText(e) {
  var c = (e && e.code) || '';
  if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return '';
  var map = {
    'auth/invalid-credential': "That email and password don't match.",
    'auth/wrong-password': "That email and password don't match.",
    'auth/user-not-found': "That email and password don't match.",
    'auth/invalid-email': 'That email address looks wrong.',
    'auth/missing-email': 'Enter your email address first.',
    'auth/email-already-in-use': 'That email already has an account. Choose Sign in instead.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/missing-password': 'Enter a password.',
    'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups for this site and try again.',
    'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.',
    'auth/unauthorized-domain': "This site's address isn't on Firebase's Authorized domains list yet. See SETUP.md.",
    'auth/operation-not-allowed': "That sign-in method isn't turned on in Firebase yet. See SETUP.md.",
    'auth/network-request-failed': 'Could not reach Firebase. Check your connection.',
    'permission-denied': 'Could not send that. Check that the latest Firestore rules are published.'
  };
  return map[c] || 'That did not work. Try again.';
}
function authAct(run, onOk) {
  if (S.authBusy) return;
  S.authBusy = true; S.authError = ''; S.authInfo = ''; renderGate();
  Promise.resolve().then(run).then(function (r) {
    S.authBusy = false;
    if (onOk) onOk(r); else BACKEND.afterAuth();
    renderGate();
  }, function (e) { S.authBusy = false; S.authError = authErrorText(e); renderGate(); });
}
function signOutNow() { authAct(function () { return BACKEND.auth.signOut(); }); }

function gateMessages() {
  return [S.authError ? h('p', { class: 'err', role: 'alert', text: S.authError }) : null,
    S.authInfo ? h('p', { class: 'ok', text: S.authInfo }) : null];
}
function gateSignedOut() {
  var A = BACKEND.auth, signup = S.authMode === 'signup';
  var form = h('form', { novalidate: true, onsubmit: function (e) {
    e.preventDefault();
    var em = normEmail($('authEmail').value), pw = $('authPw').value;
    if (!em) { S.authError = 'Enter your email address.'; renderGate(); return; }
    if (!pw) { S.authError = 'Enter a password.'; renderGate(); return; }
    authAct(function () { return signup ? A.signUp(em, pw) : A.signIn(em, pw); });
  } },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Sign in or create an account' },
      h('button', { type: 'button', 'aria-pressed': String(!signup), onclick: function () { S.authMode = 'signin'; S.authError = ''; S.authInfo = ''; renderGate(); } }, 'Sign in'),
      h('button', { type: 'button', 'aria-pressed': String(signup), onclick: function () { S.authMode = 'signup'; S.authError = ''; S.authInfo = ''; renderGate(); } }, 'Create account')),
    h('div', { class: 'field' }, h('label', { 'for': 'authEmail', text: 'Email' }),
      h('input', { id: 'authEmail', type: 'email', autocomplete: 'email', inputmode: 'email' })),
    h('div', { class: 'field' }, h('label', { 'for': 'authPw', text: signup ? 'Choose a password' : 'Password' }),
      h('input', { id: 'authPw', type: 'password', minlength: '6', autocomplete: signup ? 'new-password' : 'current-password' })),
    gateMessages(),
    h('div', { class: 'row' },
      h('button', { class: 'primary', type: 'submit', id: 'authSubmit', disabled: S.authBusy }, signup ? 'Create account' : 'Sign in'),
      signup ? null : h('button', { type: 'button', class: 'link', onclick: function () {
        var em = normEmail($('authEmail').value);
        if (!em) { S.authError = 'Enter your email above, then tap Forgot password.'; renderGate(); return; }
        authAct(function () { return A.resetPassword(em); }, function () { S.authInfo = 'If ' + em + ' has an account, a reset link is on its way. Check spam too.'; });
      } }, 'Forgot password?')),
    signup ? h('p', { class: 'hint', text: "We'll email you a link to confirm the address. Use the same address your organizer has on the list." }) : null);
  return [
    h('h2', { text: 'Sign in to Pod Planner' }),
    h('p', { class: 'hint', text: 'Only invited players can see game nights. Sign in with the account your organizer added, or sign in and ask to join.' }),
    h('button', { type: 'button', class: 'google', id: 'googleBtn', disabled: S.authBusy, onclick: function () { authAct(function () { return A.google(); }); } }, 'Continue with Google'),
    h('div', { class: 'or', text: 'or use email' }),
    form
  ];
}
function gateUnverified() {
  var A = BACKEND.auth;
  return [
    h('h2', { text: 'Check your inbox' }),
    h('p', { text: 'We sent a confirmation link to ' + S.email + '. Tap it, then come back here.' }),
    gateMessages(),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'primary', id: 'verifiedBtn', disabled: S.authBusy, onclick: function () {
        authAct(function () { return A.checkVerified(); }, function (ok) {
          if (ok) BACKEND.afterAuth(); else S.authInfo = "It isn't confirmed yet. Tap the link in the email, then try again.";
        });
      } }, "I've confirmed it"),
      h('button', { type: 'button', class: 'ghost', disabled: S.authBusy, onclick: function () {
        authAct(function () { return A.resendVerification(); }, function () { S.authInfo = 'Sent again. Check your spam folder too.'; });
      } }, 'Send it again')),
    h('button', { type: 'button', class: 'link', onclick: signOutNow }, 'Use a different account')
  ];
}
function gateNotMember() {
  var A = BACKEND.auth;
  var out = [
    h('h2', { text: "You're not on the list yet" }),
    h('p', { text: 'Signed in as ' + S.email + '. Only people an organizer has added can see game nights.' })
  ];
  if (S.request) {
    out.push(h('p', { class: 'ok', text: 'Request sent as ' + (S.request.name || S.email) + '. Once an organizer approves it, tap Check again.' }));
    out.push(h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', id: 'checkAgain', onclick: function () { BACKEND.afterAuth(); } }, 'Check again')));
  } else {
    out.push(h('form', { onsubmit: function (e) {
      e.preventDefault();
      var name = $('joinName').value.trim().slice(0, 40);
      if (!name) { S.authError = 'Add your name so the organizer knows who you are.'; renderGate(); return; }
      authAct(function () { return A.requestAccess(name); }, function () { S.request = { name: name, email: S.email }; });
    } },
      h('div', { class: 'field' }, h('label', { 'for': 'joinName', text: 'Your name' }),
        h('input', { id: 'joinName', type: 'text', maxlength: '40', autocomplete: 'name', value: S.profileName || '' })),
      gateMessages(),
      h('div', { class: 'row' }, h('button', { type: 'submit', class: 'primary', id: 'askJoin', disabled: S.authBusy }, 'Ask to join'))));
  }
  out.push(h('button', { type: 'button', class: 'link', onclick: signOutNow }, 'Use a different account'));
  if (S.request) out.splice(out.length - 1, 0, gateMessages());
  return out;
}
function renderGate() {
  var g = gated();
  $('gate').hidden = !g; $('board').hidden = g;
  if (!g) return;
  keepFocus(function () {
    var parts = S.state === 'signedout' ? gateSignedOut() : S.state === 'unverified' ? gateUnverified() : gateNotMember();
    $('gate').replaceChildren.apply($('gate'), [].concat.apply([], parts).filter(Boolean));
  });
}

/* ---------- members (organizers only) ---------- */
function saveMembers(m) {
  m.emails = Array.from(new Set(m.emails)).sort();
  m.admins = Array.from(new Set(m.admins)).sort();
  S.members = m; renderMembers();
  return S.db.doc('config/members').set({ emails: m.emails, admins: m.admins });
}
function cloneMembers() { return { emails: (S.members.emails || []).slice(), admins: (S.members.admins || []).slice() }; }
function addMember(raw) {
  var e = normEmail(raw);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { toast('That email address looks wrong.'); return Promise.resolve(false); }
  var m = cloneMembers();
  if (m.emails.indexOf(e) >= 0) { toast(e + ' is already on the list'); return Promise.resolve(true); }
  m.emails.push(e);
  return saveMembers(m).then(function () { toast('Added ' + e); return true; }, function (err) { writeError(err); return false; });
}
function approve(r) {
  addMember(r.email).then(function (ok) { if (ok) S.db.doc('requests/' + r.id).delete().catch(writeError); });
}
function dismiss(r) {
  if (!armConfirm('r:' + r.id, renderMembers)) return;
  S.db.doc('requests/' + r.id).delete().then(function () { toast('Request dismissed'); }).catch(writeError);
}
function removeMember(e) {
  if (!armConfirm('m:' + e, renderMembers)) return;
  var m = cloneMembers();
  m.emails = m.emails.filter(function (x) { return x !== e; });
  m.admins = m.admins.filter(function (x) { return x !== e; });
  saveMembers(m).then(function () {
    toast('Removed ' + e);
    if (HELPER) HELPER.call('/sync', { all: true }).catch(function () {});
  }).catch(writeError);
}
function toggleAdmin(e) {
  var m = cloneMembers();
  if (m.admins.indexOf(e) >= 0) m.admins = m.admins.filter(function (x) { return x !== e; });
  else { m.admins.push(e); if (m.emails.indexOf(e) < 0) m.emails.push(e); }
  saveMembers(m).catch(writeError);
}
var WEBHOOK_RE = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/;
function applyDiscord(d) {
  S.discord = { webhook: d.webhook || '', ping: d.ping || '' };
  CONFIG.discordWebhook = S.discord.webhook;
  CONFIG.discordPing = S.discord.ping;
}
function saveSettings(s) {
  S.settings = s; renderAll();
  return S.db.doc('config/settings').set({ open: !!s.open, blocked: s.blocked || [] });
}
function setOpen(open) {
  if (!!S.settings.open === open) return;
  if (open && !armConfirm('open', renderMembers)) return;
  saveSettings({ open: open, blocked: (S.settings.blocked || []).slice() })
    .then(function () { toast(open ? 'The board is open to anyone who signs in' : 'The board is invite only again'); }).catch(writeError);
}
function toggleBlock(p) {
  var b = (S.settings.blocked || []).slice(), i = b.indexOf(p.id);
  if (i < 0) { if (!armConfirm('b:' + p.id, renderMembers)) return; b.push(p.id); } else b.splice(i, 1);
  saveSettings({ open: !!S.settings.open, blocked: b })
    .then(function () {
      toast((p.nick || 'That person') + (i < 0 ? ' is blocked' : ' is unblocked'));
      if (HELPER) HELPER.call('/sync', { uid: p.id }).catch(function () {});
    }).catch(writeError);
}
function saveDiscord(webhook, ping) {
  webhook = String(webhook || '').trim();
  if (webhook && !WEBHOOK_RE.test(webhook)) { toast("That isn't a Discord webhook address. Copy it from Discord again."); return; }
  var d = { webhook: webhook, ping: ping || '' };
  applyDiscord(d); renderMembers();
  S.db.doc('config/discord').set(d).then(function () { toast(webhook ? 'Discord connected' : 'Discord disconnected'); }).catch(writeError);
}
function renderMembers() {
  if (!tabAllowed('organizer')) return;
  $('discordPanel').hidden = !!HELPER;
  var open = !!S.settings.open, openArmed = S.confirm === 'open';
  document.querySelectorAll('#openSeg button').forEach(function (b) {
    var v = b.dataset.open === 'true';
    b.setAttribute('aria-pressed', String(v === open));
    if (v) b.textContent = openArmed ? 'Tap again to open it' : 'Anyone who signs in';
  });
  $('openHint').textContent = open
    ? 'Anyone who signs in with a confirmed email can see and use the board. Block people below if needed. The invite list is kept for when you switch back. Discord settings stay visible only to invited people.'
    : 'Only people on the list below, plus organizers, can see the board. Everyone else can only ask to join.';

  var pl = $('peopleList'); pl.replaceChildren();
  var blocked = S.settings.blocked || [];
  var others = Object.keys(S.people).map(function (k) { return S.people[k]; })
    .filter(function (p) { return p.id !== S.uid && p.nick; })
    .sort(function (a, b) { return a.nick.localeCompare(b.nick); });
  if (!others.length) pl.append(h('p', { class: 'hint', text: 'Nobody else has joined yet.' }));
  others.forEach(function (p) {
    var isBlocked = blocked.indexOf(p.id) >= 0, armed = S.confirm === 'b:' + p.id;
    pl.append(h('div', { class: 'mrow' },
      h('div', { class: 'minfo' }, h('b', { text: p.nick }), isBlocked ? h('span', { class: 'tagline', text: 'Blocked' }) : null),
      h('div', { class: 'mact' }, h('button', { type: 'button', class: 'link' + (armed ? ' danger' : ''), onclick: function () { toggleBlock(p); } },
        isBlocked ? 'Unblock' : (armed ? 'Tap again to block' : 'Block')))));
  });

  $('discordHint').textContent = S.discord.webhook
    ? 'Connected. New nights, polls, updates and Game on messages go to your channel (except private pods\' games). Only invited members and organizers can read this setting.'
    : 'Not connected. In Discord: Edit Channel, Integrations, Webhooks, New Webhook, Copy Webhook URL. Paste it here.';
  if (document.activeElement !== $('discWebhook')) $('discWebhook').value = S.discord.webhook;
  if (document.activeElement !== $('discPing')) $('discPing').value = S.discord.ping;
  $('discRemove').hidden = !S.discord.webhook;
  $('discRemove').textContent = S.confirm === 'dr' ? 'Tap again to disconnect' : 'Disconnect';

  var rq = $('requests'); rq.replaceChildren();
  var reqs = S.requests.slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
  if (!reqs.length) rq.append(h('p', { class: 'hint', text: 'No one is waiting.' }));
  reqs.forEach(function (r) {
    var armed = S.confirm === 'r:' + r.id;
    rq.append(h('div', { class: 'mrow' },
      h('div', { class: 'minfo' }, h('b', { text: r.name || 'No name given' }), h('span', { text: r.email })),
      h('div', { class: 'mact' },
        h('button', { type: 'button', class: 'primary small', onclick: function () { approve(r); } }, 'Approve'),
        h('button', { type: 'button', class: 'link' + (armed ? ' danger' : ''), onclick: function () { dismiss(r); } }, armed ? 'Tap again to dismiss' : 'Dismiss'))));
  });
  var ml = $('memberList'); ml.replaceChildren();
  var all = Array.from(new Set((S.members.emails || []).concat(S.members.admins || []))).sort();
  if (!all.length) ml.append(h('p', { class: 'hint', text: 'Nobody on the list yet. Approve a request or add an email below.' }));
  all.forEach(function (e) {
    var admin = (S.members.admins || []).indexOf(e) >= 0, armed = S.confirm === 'm:' + e;
    ml.append(h('div', { class: 'mrow' },
      h('div', { class: 'minfo' }, h('b', { text: e }), admin ? h('span', { text: 'Organizer: can approve people, edit any game, and see every pod' }) : null),
      h('div', { class: 'mact' },
        h('button', { type: 'button', class: 'link', onclick: function () { toggleAdmin(e); } }, admin ? 'Make regular member' : 'Make organizer'),
        h('button', { type: 'button', class: 'link' + (armed ? ' danger' : ''), onclick: function () { removeMember(e); } }, armed ? 'Tap again to remove' : 'Remove'))));
  });
}

/* ---------- render ---------- */
function renderNotice() {
  var msg = '';
  if (S.state === 'setup') msg = 'Setup is not finished. Paste your Firebase settings into config.js and reload. SETUP.md has the steps.';
  else if (gated()) msg = '';
  else if (S.state === 'signedout') msg = 'Sign in to claude.ai to see and answer game nights.';
  else if (S.state === 'ok' && !S.uid) msg = 'You can look at the board, but this view has no identity to answer with.';
  else if (S.state === 'ok' && !canWrite()) msg = 'You can see the board but not answer or post. Ask whoever set it up to share it with you as a Contributor.';
  else if (S.error) msg = 'The connection to the board was interrupted. Reload the page to reconnect.';
  else if (S.slow) msg = 'Still reaching the board. What you see may be out of date.';
  $('notice').hidden = !msg; $('notice').textContent = msg;
}
function renderMe() {
  var box = $('me'); box.replaceChildren();
  if (gated()) {
    if (S.state !== 'signedout') box.append(h('button', { type: 'button', class: 'link', onclick: signOutNow }, 'Sign out'));
    return;
  }
  if (!canWrite()) return;
  var m = me();
  box.append(m && m.nick
    ? h('button', { class: 'me-btn', type: 'button', onclick: function () { openNick(false); } }, h('span', { text: m.nick }), pips(m.ci), h('small', { text: 'Profile' }))
    : h('button', { class: 'me-btn', type: 'button', onclick: function () { openNick(true); } }, 'Set your name'));
  if (ACCOUNTS) box.append(h('button', { type: 'button', class: 'link', id: 'signOutBtn', onclick: signOutNow }, 'Sign out'));
}
function memberCount(id) {
  return livePeople().filter(function (p) { return p.nick && p.pods && p.pods.indexOf(id) >= 0; }).length;
}
function renderPods() {
  var box = $('pods'); box.replaceChildren();
  if (!S.loaded.pods) { box.append(h('p', { class: 'hint', text: S.db ? 'Loading pods…' : '' })); return; }
  if (!S.pods.length) {
    box.append(h('p', { class: 'hint', text: 'No pods yet. Add the groups you play with, like Tuesday Commander or the shop draft crew.' }));
    return;
  }
  var mine = new Set((me() && me().pods) || []);
  podsSorted().forEach(function (p) {
    var on = mine.has(p.id);
    var chip = h('button', {
      type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), disabled: !canWrite(),
      title: on ? 'You play in this pod. Tap to leave.' : 'Tap to join this pod.',
      onclick: function () { togglePod(p.id); }
    }, h('i', { class: 'dot m-' + p.mana }), p.name, p.private ? h('span', { class: 'badge priv', text: 'private' }) : p.join === 'invite' ? h('span', { class: 'badge', text: 'invite' }) : null, h('span', { class: 'count', text: String(memberCount(p.id)) }), on ? h('span', { class: 'chk', 'aria-hidden': 'true', text: '✓' }) : null);
    var wrap = h('span', { class: 'chipwrap' }, chip);
    if (canWrite() && mineId(p.by)) {
      wrap.append(h('button', { type: 'button', class: 'link podedit', 'aria-label': 'Edit pod ' + p.name, onclick: function () { openPodForm(p); } }, 'Edit'));
    }
    box.append(wrap);
  });
}
// A private pod's game is only for that pod, so picking one clears the others (and the reverse).
// While editing, a game stays where it is: public games can't be moved into a private pod or back.
function renderFormPods() {
  var box = $('formPods'); box.replaceChildren();
  var lock = S.formLock, lockPod = lock ? lock.split('/')[1] : null;
  var list = podsSorted().filter(function (p) {
    if (lock === null || lock === undefined) return !p.private || myPods().indexOf(p.id) >= 0 || S.isAdmin;
    return lockPod ? p.id === lockPod : !p.private;
  });
  if (!list.length) { box.append(h('p', { class: 'hint', text: 'No pods yet. Leave this empty to call everyone, or add a pod first.' })); return; }
  list.forEach(function (p) {
    var id = 'fp_' + p.id;
    var cb = h('input', { type: 'checkbox', id: id, checked: S.formPods.has(p.id), disabled: !!lockPod, onchange: function (e) {
      if (e.target.checked) {
        if (p.private) S.formPods.clear();
        else Array.from(S.formPods).forEach(function (x) { if (isPrivPod(x)) S.formPods.delete(x); });
        S.formPods.add(p.id);
      } else S.formPods.delete(p.id);
      renderFormPods();
    } });
    box.append(h('label', { class: 'pick' + (p.private ? ' privpick' : ''), 'for': id }, cb, h('i', { class: 'dot m-' + p.mana }), p.name, p.private ? h('span', { class: 'badge', text: 'private' }) : null));
  });
  var priv = Array.from(S.formPods).filter(isPrivPod)[0];
  if (priv) box.append(h('p', { class: 'hint fine', text: 'Only ' + (S.priv.pods[priv].name || 'this pod') + ' will see this game. It posts in the pod\'s private Discord channel.' }));
}
function keepFocus(fn) {
  var a = document.activeElement, id = a && a.id, v = null, s = null, e = null;
  if (a && 'value' in a) { v = a.value; try { s = a.selectionStart; e = a.selectionEnd; } catch (x) {} }
  fn();
  if (id) {
    var el = $(id);
    if (el && el !== a) {
      if (v != null && el.value !== v) el.value = v;
      el.focus();
      try { if (s != null) el.setSelectionRange(s, e); } catch (x) {}
    }
  }
}

/* ---------- color identity ---------- */
var CI_ORDER = 'WUBRG';
var CI_NAMES = {
  '': 'Colorless', W: 'Mono-White', U: 'Mono-Blue', B: 'Mono-Black', R: 'Mono-Red', G: 'Mono-Green',
  WU: 'Azorius', UB: 'Dimir', BR: 'Rakdos', RG: 'Gruul', WG: 'Selesnya', WB: 'Orzhov', UR: 'Izzet', BG: 'Golgari', WR: 'Boros', UG: 'Simic',
  WUG: 'Bant', WUB: 'Esper', UBR: 'Grixis', BRG: 'Jund', WRG: 'Naya', WBG: 'Abzan', WUR: 'Jeskai', UBG: 'Sultai', WBR: 'Mardu', URG: 'Temur',
  WUBR: 'Four-color (no green)', UBRG: 'Four-color (no white)', WBRG: 'Four-color (no blue)', WURG: 'Four-color (no black)', WUBG: 'Four-color (no red)',
  WUBRG: 'Five-color'
};
function validCi(ci) {
  ci = String(ci || '').toUpperCase();
  return CI_ORDER.split('').filter(function (c) { return ci.indexOf(c) >= 0; }).join('');
}
function ciName(ci) { return CI_NAMES[validCi(ci)] || 'Multicolor'; }
function pips(ci) {
  ci = validCi(ci);
  return ci ? h('span', { class: 'pips', 'aria-hidden': 'true' }, ci.split('').map(function (c) { return h('i', { class: 'm-' + c }); })) : null;
}
function applyIdentity(ci) {
  ci = validCi(ci);
  var root = document.documentElement;
  if (ci) root.setAttribute('data-ci1', ci[0]); else root.removeAttribute('data-ci1');
  var row = $('ciRow');
  if (row) row.replaceChildren.apply(row, (ci || CI_ORDER).split('').map(function (c) { return h('i', { class: 'dot m-' + c }); }));
}
function renderCiPick() {
  var ci = validCi(S.ciDraft);
  document.querySelectorAll('#ciPick button').forEach(function (b) { b.setAttribute('aria-pressed', String(ci.indexOf(b.dataset.c) >= 0)); });
  $('ciName').textContent = ciName(ci);
}

/* ---------- confetti, in mana colors ---------- */
function confetti() {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var old = $('confetti'); if (old) old.remove();
  var cv = h('canvas', { id: 'confetti', class: 'confetti', 'aria-hidden': 'true' });
  document.body.append(cv);
  var dpr = window.devicePixelRatio || 1, W = window.innerWidth, H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  var ctx = cv.getContext('2d'); if (!ctx) { cv.remove(); return; }
  ctx.scale(dpr, dpr);
  var cs = getComputedStyle(document.documentElement);
  var cols = ['--m-w', '--m-u', '--m-b', '--m-r', '--m-g'].map(function (t) { return cs.getPropertyValue(t).trim() || '#888'; });
  var parts = [];
  for (var i = 0; i < 110; i++) {
    parts.push({ x: W / 2 + (Math.random() - 0.5) * 60, y: H * 0.38, vx: (Math.random() - 0.5) * 13, vy: -4 - Math.random() * 10,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, w: 6 + Math.random() * 6, hgt: 4 + Math.random() * 4, c: cols[i % 5] });
  }
  var start = null;
  function step(t) {
    if (start == null) start = t;
    var age = t - start;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.max(0, 1 - age / 1600);
    parts.forEach(function (p) {
      p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.hgt / 2, p.w, p.hgt); ctx.restore();
    });
    if (age < 1600) requestAnimationFrame(step); else cv.remove();
  }
  requestAnimationFrame(step);
}

/* ---------- card frames ---------- */
var BANNERS = [['', 'Auto'], ['W', 'Dawn'], ['U', 'Tide'], ['B', 'Night'], ['R', 'Ember'], ['G', 'Grove'], ['gold', 'Lattice'], ['C', 'Playmat']];
function frameFor(item, pm) {
  var cols = [], chosen = '';
  (item.podIds || []).forEach(function (id) {
    var p = pm[id]; if (!p) return;
    if (p.mana && cols.indexOf(p.mana) < 0) cols.push(p.mana);
    if (!chosen && p.banner) chosen = p.banner;
  });
  var f = cols.length === 0 ? 'none' : cols.length === 1 ? cols[0] : 'gold';
  var a1 = cols[0] || 'C', a2 = cols[1] || a1;
  // A pod's chosen banner wins; otherwise the pattern follows the frame color.
  var pat = chosen || (f === 'none' ? 'C' : f);
  return { frame: 'f-' + f, art: 'art a1-' + a1 + ' a2-' + a2 + ' pat-' + pat };
}
function renderBannerPick() {
  var box = $('podBannerPick');
  var mana = ($('podForm').querySelector('input[name=mana]:checked') || {}).value || 'U';
  box.replaceChildren.apply(box, BANNERS.map(function (b) {
    var pat = b[0] || mana, on = (S.podBanner || '') === b[0];
    return h('button', { type: 'button', 'aria-pressed': String(on), onclick: function () { S.podBanner = b[0]; renderBannerPick(); } },
      h('span', { class: 'art a1-' + mana + ' a2-' + mana + ' pat-' + pat, 'aria-hidden': 'true' }), b[1]);
  }));
}
function typeLine(kind, item, pm) {
  var pods = podNames(item, pm);
  return kind + ' — ' + (pods.length ? pods.join(' · ') : 'Everyone');
}
function nameList(list) {
  var out = [];
  list.forEach(function (p, i) { if (i) out.push(', '); out.push(h('span', null, p.nick, pips(p.ci))); });
  return out;
}
function initial(nick) { return (Array.from(String(nick || '?'))[0] || '?').toUpperCase(); }

function pollCard(p, pm) {
  var t = pollTally(p, pm);
  var owner = canWrite() && mineId(p.by);
  var fr = frameFor(p, pm);
  var opts = t.opts.map(function (x) {
    var o = x.o, mv = me() ? pollVoteOf(me(), p.id, o.id) : undefined;
    var when = fmtWhen(o.date, o.time);
    var who = [];
    if (x.yes.length) who.push('Can: ' + x.yes.join(', '));
    if (x.maybe.length) who.push('Maybe: ' + x.maybe.join(', '));
    if (x.no.length) who.push('No: ' + x.no.join(', '));
    var votes = h('div', { class: 'votes', role: 'group', 'aria-label': 'Your answer for ' + when });
    [['yes', 'Can'], ['maybe', 'Maybe'], ['no', 'No']].forEach(function (r) {
      votes.append(h('button', { type: 'button', class: 'vb ' + r[0], 'aria-pressed': String(mv === r[0]), disabled: !canWrite(), onclick: function () { votePoll(p, o.id, r[0]); } }, r[1]));
    });
    var armed = S.confirm === 'l:' + p.id + o.id;
    return h('div', { class: 'opt' + (t.best === o.id ? ' best' : '') },
      h('div', { class: 'optinfo' },
        h('div', { class: 'when' }, when, t.best === o.id ? h('span', { class: 'pill on', text: 'Best so far' }) : null),
        h('div', { class: 'optcount', text: x.yes.length + ' can · ' + x.maybe.length + ' maybe' }),
        who.length ? h('div', { class: 'who', text: who.join('   ') }) : null,
        owner ? h('div', null, h('button', { type: 'button', class: 'link' + (armed ? ' danger' : ''), onclick: function () { lockIn(p, o); } }, armed ? 'Tap again to lock in this date' : 'Lock in this date')) : null),
      votes);
  });
  var meta = [];
  if (validRegion(p.region)) meta.push(h('span', { class: 'regionchip', text: p.region }));
  if (p.place) meta.push(p.place);
  if (p.address) meta.push(h('a', { class: 'addr', href: mapsUrl(p.address), target: '_blank', rel: 'noopener', title: 'Directions' }, p.address));
  if (p.host) meta.push('Host: ' + p.host);
  var pd = distanceText(p);
  if (pd) meta.push(pd + ' away');
  var delArmed = S.confirm === 'd:' + p.id;
  return h('article', { class: 'poll card ' + fr.frame },
    h('div', { class: 'card-in' },
      h('div', { class: 'titlebar' }, h('h3', { text: p.title }), h('span', { class: 'cost' + (needsPoll(p, pm) ? ' needs' : ''), text: needsPoll(p, pm) ? 'Needs your vote' : 'Voting open' })),
      h('div', { class: 'typeline' },
        h('span', { text: typeLine((p.format || 'Game') + ' Poll', p, pm) + (hasBrackets(p.format) && p.bracket ? ' · Bracket ' + p.bracket + ' or lower' : '') }),
        h('span', { class: 'pt', 'aria-label': (p.min || 4) + ' players needed', text: '?/' + (p.min || 4) })),
      h('div', { class: 'textbox' },
        meta.length ? h('div', { class: 'meta' }, meta.map(function (m) { return typeof m === 'string' ? h('span', { text: m }) : m; })) : null,
        p.note ? h('p', { class: 'flavor', text: p.note }) : null,
        h('div', { class: 'opts' }, opts),
        t.wait.length ? h('p', { class: 'hint', text: 'Waiting on: ' + t.wait.join(', ') }) : null,
        owner ? h('div', { class: 'foot' }, h('span'), h('button', { type: 'button', class: 'link' + (delArmed ? ' danger' : ''), onclick: function () { deletePoll(p); } }, delArmed ? 'Tap again to delete this poll' : 'Delete poll')) : null)));
}
function renderPolls() {
  var box = $('polls'); box.replaceChildren();
  if (!S.loaded.polls) return;
  var pm = podById();
  var list = S.polls.filter(function (p) { return visibleFor(p, pm); }).sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
  list.forEach(function (p) { box.append(pollCard(p, pm)); });
}

function nightCard(n, pm, g) {
  var ser = n.virtual ? seriesById(n.series) : null;
  var c = tally(n, pm), st = statusOf(n, c), min = n.min || 4;
  var d = parseDate(n.date);
  var fr = frameFor(n, pm);
  var mineAns = me() ? answerOf(me(), n) : undefined;
  var seatsN = Math.max(min, c.yes.length);
  var seats = h('div', { class: 'seats', role: 'img', 'aria-label': c.yes.length + ' in, ' + c.maybe.length + ' maybe, ' + min + ' needed' });
  var credits = [];
  function seat(p, cls, suffix) {
    var ds = decksFor(p, n), d = ds[0], art = d ? safeArt(d.art) : '';
    var over = ds.some(function (x) { return overLimit(x, n); });
    var el = h('span', { class: 'seat ' + cls + (art ? ' hasart' : '') + (over ? ' over' : ''),
      title: p.nick + suffix + (ds.length ? ': ' + ds.map(function (x) { return x.name + (hasBrackets(n.format) && x.b ? ' (B' + x.b + ')' : ''); }).join(', ') : ''),
      text: initial(p.nick) });
    if (art) { el.style.backgroundImage = 'url("' + art + '")'; if (d.artist && credits.indexOf(d.artist) < 0) credits.push(d.artist); }
    return el;
  }
  for (var i = 0; i < seatsN; i++) {
    if (i < c.yes.length) seats.append(seat(c.yes[i], 'yes', ''));
    else if (i < c.yes.length + c.maybe.length) seats.append(seat(c.maybe[i - c.yes.length], 'maybe', ' (maybe)'));
    else seats.append(h('span', { class: 'seat' }));
  }
  var deckRows = [];
  c.yes.concat(c.maybe).forEach(function (p) {
    var ds = decksFor(p, n); if (!ds.length) return;
    deckRows.push(h('span', { class: 'dline' }, h('b', { text: p.nick + ': ' }), ds.map(function (d, j) {
      var link = safeLink(d.url), over = overLimit(d, n);
      return h('span', { class: over ? 'over' : null }, j ? ', ' : null,
        link ? h('a', { href: link, target: '_blank', rel: 'noopener' }, d.name) : d.name,
        d.cmd ? ' (' + d.cmd + ')' : null, hasBrackets(n.format) && d.b ? ' B' + d.b : null, over ? ' · over the limit' : null);
    })));
  });
  var roster = h('dl', { class: 'roster' });
  [['yes', 'In', c.yes], ['maybe', 'Maybe', c.maybe], ['no', 'Out', c.no], ['wait', 'Waiting', c.wait]].forEach(function (r) {
    if (r[2].length) roster.append(h('div', { class: r[0] }, h('dt', { text: r[1] }), h('dd', null, nameList(r[2]))));
  });
  if (c.bring.length) roster.append(h('div', { class: 'bring' }, h('dt', { text: 'Bringing' }), h('dd', { text: c.bring.join('; ') })));
  if (deckRows.length) roster.append(h('div', { class: 'decks' }, h('dt', { text: 'Decks' }), h('dd', null, deckRows)));
  var row = h('div', { class: 'rsvp', role: 'group', 'aria-label': 'Your answer for ' + n.title });
  [['yes', "I'm in"], ['maybe', 'Maybe'], ['no', "Can't"]].forEach(function (r) {
    row.append(h('button', { type: 'button', class: 'rs ' + r[0], 'aria-pressed': String(mineAns === r[0]), disabled: !canWrite(), onclick: function () { answer(n, r[0]); } },
      r[0] === 'yes' ? h('span', { class: 'tapcard', 'aria-hidden': 'true' }) : null, r[1]));
  });
  var bring = null, picker = null;
  if (canWrite() && (mineAns === 'yes' || mineAns === 'maybe')) {
    picker = deckPicker(n);
    var bid = 'br_' + n.id;
    bring = h('div', { class: 'bring' },
      h('label', { 'for': bid, text: 'Bringing something?' }),
      h('input', {
        id: bid, type: 'text', maxlength: '60', placeholder: 'Chips, spare playmat…',
        value: (me() && me().bring && me().bring[n.id]) || '',
        onchange: function (e) { saveBring(n, e.target.value); },
        onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }
      }));
  }
  var cal = h('div', { class: 'cal' },
    h('a', { class: 'link', href: gcalUrl(n), target: '_blank', rel: 'noopener' }, 'Google Calendar'),
    BACKEND.features.ics ? h('button', { type: 'button', class: 'link', onclick: function () { downloadIcs(n); } }, 'Apple or Outlook') : null);
  var owner = h('div', { class: 'owner' });
  if (canWrite() && mineId(n.by) && ser) {
    var k1 = S.confirm === 'k:' + n.id, e1 = S.confirm === 'e:' + ser.id;
    owner.append(h('button', { type: 'button', class: 'link', onclick: function () { startEditSeries(ser); } }, 'Edit series'));
    owner.append(h('button', { type: 'button', class: 'link' + (k1 ? ' danger' : ''), onclick: function () { skipDate(ser, n); } }, k1 ? 'Tap again to skip this date' : 'Skip this date'));
    owner.append(h('button', { type: 'button', class: 'link' + (e1 ? ' danger' : ''), onclick: function () { endSeries(ser); } }, e1 ? 'Tap again to end it' : 'End series'));
  } else if (canWrite() && mineId(n.by)) {
    var a1 = S.confirm === 'n:' + n.id, a2 = S.confirm === 's:' + n.id;
    owner.append(h('button', { type: 'button', class: 'link', onclick: function () { startEdit(n); } }, 'Edit'));
    owner.append(h('button', { type: 'button', class: 'link' + (a1 ? ' danger' : ''), onclick: function () { cancelNight(n); } }, a1 ? 'Tap again to cancel this night' : 'Cancel night'));
    if (n.series) owner.append(h('button', { type: 'button', class: 'link' + (a2 ? ' danger' : ''), onclick: function () { cancelSeries(n); } }, a2 ? 'Tap again to cancel this and later nights' : 'Cancel this and later'));
  }
  var meta = [];
  if (n.place) meta.push(n.place);
  var hp = n.addrIn ? hiddenPlace(n) : null, placeOf = hp || n;
  if (placeOf.address) meta.push(h('a', { class: 'addr', href: mapsUrl(placeOf.address), target: '_blank', rel: 'noopener', title: 'Directions' }, placeOf.address));
  else if (n.addrIn) meta.push(h('span', { class: 'addrlock', text: 'Address shown once you\'re in' }));
  if (n.host) meta.push('Host: ' + n.host);
  var dist = distanceText(placeOf);
  var nightPods = (n.podIds || []).map(function (id) { return pm[id]; }).filter(Boolean);
  if (nightPods.length) meta.push(nightPods.some(function (p) { return p.openSeats === false; }) ? 'Pod only' : 'Open table');
  if (ser) meta.push(repeatLabel(ser)); else if (n.series) meta.push('Weekly');
  var datesRow = null;
  if (g && g.items.length > 1) {
    datesRow = h('div', { class: 'dates', role: 'group', 'aria-label': 'Dates for ' + n.title },
      g.items.slice(0, 8).map(function (o) {
        var a = me() ? answerOf(me(), o) : undefined, on = o.id === n.id;
        return h('button', { type: 'button', class: 'datechip' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: function () { S.sel[g.key] = o.id; renderNights(); } },
          parseDate(o.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          a ? h('i', { class: 'ans ans-' + a, title: a === 'yes' ? "You're in" : a === 'maybe' ? 'Maybe' : "Can't make it" }) : null);
      }));
  }
  var key = g ? g.key : n.id, opened = isOpen(key);
  var more = h('button', { type: 'button', class: 'more', 'aria-expanded': String(opened),
    onclick: function () { S.open[key] = !opened; renderNights(); } }, opened ? 'Less' : 'Details');
  return h('article', { class: 'night card ' + fr.frame + (opened ? '' : ' compact'), 'data-key': key },
    h('div', { class: 'card-in' },
      h('div', { class: 'titlebar' }, h('h3', { text: n.title }),
        h('span', { class: 'cost', text: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) })),
      h('div', { class: fr.art },
        h('div', { class: 'artrow' },
          h('span', { class: 'chiprow' },
            n.time ? h('span', { class: 'timechip', text: fmtTime(n.time) }) : null,
            validRegion(n.region) ? h('span', { class: 'regionchip', text: n.region }) : null,
            dist ? h('span', { class: 'distchip', title: 'Straight-line distance from your area', text: dist }) : null),
          h('span', { class: 'pill ' + st.cls, text: st.text })),
        seats,
        credits.length ? h('span', { class: 'artcredit', text: 'Art: ' + credits.join(', ') }) : null),
      h('div', { class: 'typeline' },
        h('span', { text: typeLine((n.format || 'Game') + ' Night', n, pm) + (hasBrackets(n.format) && n.bracket ? ' · Bracket ' + n.bracket + ' or lower' : '') }),
        h('span', { class: 'pt', 'aria-label': c.yes.length + ' of ' + min + ' seats filled', title: 'Seats filled / needed', text: c.yes.length + '/' + min })),
      h('div', { class: 'textbox' },
        datesRow,
        meta.length ? h('div', { class: 'meta' }, meta.map(function (m) { return typeof m === 'string' ? h('span', { text: m }) : m; })) : null,
        n.note ? h('p', { class: 'flavor', text: n.note }) : null,
        roster.children.length ? roster : null,
        row, bring, picker,
        h('div', { class: 'foot' }, cal, owner),
        more)));
}
function renderNights() {
  keepFocus(function () {
    var box = $('nights'); box.replaceChildren();
    if (!S.loaded.nights || !S.loaded.series) { box.append(h('p', { class: 'empty', text: S.db ? 'Loading the board…' : 'Nothing to show until setup is finished.' })); return; }
    var pm = podById(), today = todayStr(), week = addDaysYmd(today, 7);
    var all = groupNights(upcomingNights());
    var shown = all.filter(function (g) { return visibleFor(g.items[0], pm); });
    var polls = S.polls.filter(function (p) { return visibleFor(p, pm); }).length;
    $('fCount').hidden = !filtersOn();
    $('fCount').textContent = 'Showing ' + shown.length + ' of ' + all.length + (all.length === 1 ? ' game' : ' games')
      + (polls ? ' and ' + polls + (polls === 1 ? ' date poll' : ' date polls') : '') + '.';
    if (!shown.length && !polls) {
      if (!all.length && !S.polls.length) box.append(h('div', { class: 'empty' }, h('h3', { text: 'No nights on the board yet' }), h('p', { text: 'Tap Call a night, pick the pods, and everyone can answer from here.' })));
      else if (filtersOn()) box.append(h('div', { class: 'empty' }, h('h3', { text: 'No games match' }), h('p', { text: 'Try another pod, format or area.' }),
        h('button', { type: 'button', class: 'ghost', onclick: clearFilters }, 'Clear filters')));
      else box.append(h('div', { class: 'empty' }, h('h3', { text: 'No upcoming nights' }), h('p', { text: 'Call the next one.' })));
    }
    var needs = shown.filter(function (g) { return needsNight(g.items[0], pm); });
    var rest = shown.filter(function (g) { return needs.indexOf(g) < 0; });
    var soon = rest.filter(function (g) { return g.items[0].date < week; });
    var later = rest.filter(function (g) { return g.items[0].date >= week; });
    [['Needs your answer', needs], ['Next 7 days', soon], ['Later', later]].forEach(function (sec, i) {
      if (!sec[1].length) return;
      box.append(h('h3', { class: 'grouphead' + (i === 0 ? ' needs' : ''), text: sec[0] }));
      sec[1].forEach(function (g) { box.append(nightCard(selectedIn(g), pm, g)); });
    });

    var past = pastNights().sort(function (x, y) { return (y.date + (y.time || '')).localeCompare(x.date + (x.time || '')); });
    var pw = $('pastWrap'), pb = $('past'); pb.replaceChildren();
    pw.hidden = !past.length;
    $('pastSum').textContent = 'Earlier nights (' + past.length + ')';
    past.slice(0, 20).forEach(function (n) {
      var c = tally(n, pm), d = parseDate(n.date);
      pb.append(h('div', { class: 'pastrow' },
        h('span', { text: n.title + ' · ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }),
        h('span', { text: c.yes.length + ' were in' })));
    });
  });
}
function maybeOpenNick() {
  if (S.nickShown || !canWrite() || !S.loaded.people) return;
  S.nickShown = true;
  if (!(me() && me().nick)) openNick(false);
}
function updateControls() {
  var w = canWrite();
  $('callBtn').disabled = !w; $('addPodBtn').disabled = !w;
  if (!w) { closeSheet(); $('podForm').hidden = true; }
}
function renderAll() {
  applyIdentity(S.ciDraft != null && S.tab === 'me' ? S.ciDraft : (me() && me().ci));
  renderGate(); renderNotice(); renderMe(); renderDecks(); renderPods(); renderInvites(); renderDiscordProfile(); renderFormPods(); renderFilter(); renderPolls(); renderNights(); renderMembers(); updateControls(); maybeOpenNick(); renderTabs();
}

/* ---------- recurring games ----------
   A recurring game is one "series" document holding the rule (every week, every 2 weeks, or the
   nth weekday of each month), when it ends, and any skipped dates. Its dates are worked out here;
   answers are stored per date under the id "<seriesId>_<YYYYMMDD>". */
var STEP = { weekly: 7, biweekly: 14 };
var ORD = { '1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '-1': 'last' };
var DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function nthOf(ymd) { var n = Math.ceil(parseDate(ymd).getDate() / 7); return n >= 5 ? -1 : n; }
function nthWeekday(y, m, weekday, nth) {
  var d;
  if (nth === -1) { d = new Date(y, m + 1, 0); while (d.getDay() !== weekday) d.setDate(d.getDate() - 1); return d; }
  d = new Date(y, m, 1); while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 7 * (nth - 1));
  return d.getMonth() === m ? d : null;
}
// The series' dates from "from" to "to" (inclusive), minus skipped ones; stops after "max" results.
function seriesDates(s, from, to, max) {
  var out = [], skips = s.skips || [], n = 0, guard = 0, start = parseDate(s.date);
  function take(ymd) {
    n++;
    if ((s.count && n > s.count) || (s.until && ymd > s.until) || ymd > to) return false;
    if (ymd >= from && skips.indexOf(ymd) < 0) out.push(ymd);
    return !(max && out.length >= max);
  }
  if (s.freq === 'monthly') {
    var y = start.getFullYear(), m = start.getMonth(), nth = s.nth || nthOf(s.date);
    while (guard++ < 1200) {
      var d = nthWeekday(y, m, start.getDay(), nth);
      if (d && fmtYmd(d) >= s.date && !take(fmtYmd(d))) break;
      if (++m > 11) { m = 0; y++; }
    }
  } else {
    var c = new Date(start.getFullYear(), start.getMonth(), start.getDate()), step = STEP[s.freq] || 7;
    while (guard++ < 2600 && take(fmtYmd(c))) c.setDate(c.getDate() + step);
  }
  return out;
}
function occurrence(s, ymd) {
  return { id: s.id + '_' + ymd.replace(/-/g, ''), date: ymd, time: s.time || '', title: s.title, place: s.place || '', host: s.host || '',
    address: s.address || '', lat: s.lat, lng: s.lng, bracket: s.bracket || 0, region: s.region || '', format: s.format, min: s.min || 4, podIds: s.podIds || [], note: s.note || '', by: s.by, at: s.at, series: s.id, virtual: true, _priv: s._priv };
}
function repeatLabel(s) {
  var day = parseDate(s.date).toLocaleDateString(undefined, { weekday: 'long' });
  var out = s.freq === 'monthly' ? 'Monthly on the ' + ORD[String(s.nth || nthOf(s.date))] + ' ' + day
    : (s.freq === 'biweekly' ? 'Every 2 weeks' : 'Every week') + ' on ' + day + 's';
  if (s.count) out += ', ' + s.count + ' games';
  else if (s.until) out += ', until ' + parseDate(s.until).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return out;
}
function seriesById(id) { return S.series.filter(function (s) { return s.id === id; })[0]; }
function seriesLines(s, pm) {
  var lines = nightDetails(s, pm);
  lines[0] = repeatLabel(s) + (s.time ? ' at ' + fmtTime(s.time) : '') + ', starting ' + fmtWhen(s.date, '', true) + (s.place ? ', ' + s.place : '');
  return lines;
}
function rrule(s) {
  var r = s.freq === 'monthly' ? 'FREQ=MONTHLY;BYDAY=' + (s.nth || nthOf(s.date)) + DOW[parseDate(s.date).getDay()]
    : 'FREQ=WEEKLY;INTERVAL=' + (s.freq === 'biweekly' ? 2 : 1);
  if (s.count) r += ';COUNT=' + s.count;
  else if (s.until) r += ';UNTIL=' + s.until.replace(/-/g, '') + (s.time ? 'T235959' : '');
  return 'RRULE:' + r;
}
// Everything upcoming: one-off nights, older weekly copies, and the next dates of every recurring game.
function upcomingNights() {
  var today = todayStr(), horizon = addDaysYmd(today, 400);
  var list = S.nights.filter(function (n) { return n.date >= today; });
  S.series.forEach(function (s) { seriesDates(s, today, horizon, 10).forEach(function (d) { list.push(occurrence(s, d)); }); });
  return list;
}
function pastNights() {
  var today = todayStr(), yesterday = addDaysYmd(today, -1);
  var list = S.nights.filter(function (n) { return n.date < today; });
  S.series.forEach(function (s) { if (s.date < today) seriesDates(s, s.date, yesterday).slice(-10).forEach(function (d) { list.push(occurrence(s, d)); }); });
  return list;
}
// One group per one-off night, and one per series (recurring or older weekly copies).
function groupNights(list) {
  var key = function (n) { return (n.date || '') + (n.time || ''); };
  list.sort(function (a, b) { return key(a).localeCompare(key(b)); });
  var groups = [], byKey = {};
  list.forEach(function (n) {
    var k = n.series ? 's:' + n.series : 'n:' + n.id;
    if (!byKey[k]) { byKey[k] = { key: k, items: [], series: n.virtual ? seriesById(n.series) : null }; groups.push(byKey[k]); }
    byKey[k].items.push(n);
  });
  return groups;
}
function selectedIn(g) { var id = S.sel[g.key]; return g.items.filter(function (n) { return n.id === id; })[0] || g.items[0]; }
function skipDate(s, n) {
  if (!armConfirm('k:' + n.id, renderNights)) return;
  S.db.doc(baseOf(s) + 'series/' + s.id).update({ skips: (s.skips || []).concat([n.date]) })
    .then(function () { toast('Skipped ' + fmtWhen(n.date, '')); }).catch(writeError);
}
function endSeries(s) {
  if (!armConfirm('e:' + s.id, renderNights)) return;
  var today = todayStr();
  var done = s.date >= today ? S.db.doc(baseOf(s) + 'series/' + s.id).delete() : S.db.doc(baseOf(s) + 'series/' + s.id).update({ until: addDaysYmd(today, -1) });
  done.then(function () { toast('Recurring game ended'); }).catch(writeError);
}

/* ---------- filters ---------- */
function filtersOn() { return !!(S.f.q || S.f.pod !== 'all' || S.f.format || S.f.region); }
function visibleFor(item, pm) {
  var f = S.f, ids = (item.podIds || []).filter(function (id) { return pm[id]; });
  if (f.pod === 'mine') {
    var mp = myPods();
    if (!(ids.length === 0 || ids.some(function (id) { return mp.indexOf(id) >= 0; }))) return false;
  } else if (f.pod !== 'all' && ids.indexOf(f.pod) < 0) return false;
  if (f.format && item.format !== f.format) return false;
  if (f.region && item.region !== f.region) return false;
  if (f.q) {
    var hay = [item.title, item.place, item.address, item.region, item.host, item.note, item.format].join(' ').toLowerCase();
    if (hay.indexOf(f.q.toLowerCase()) < 0) return false;
  }
  return true;
}
function renderFilter() {
  var podSel = $('fPod'), fmtSel = $('fFormat');
  if (document.activeElement !== podSel) {
    var opts = [h('option', { value: 'all', text: 'All pods' }), h('option', { value: 'mine', text: 'My pods' })]
      .concat(podsSorted().map(function (p) { return h('option', { value: p.id, text: p.name }); }));
    podSel.replaceChildren.apply(podSel, opts);
    podSel.value = S.f.pod;
    if (podSel.value !== S.f.pod) { S.f.pod = 'all'; podSel.value = 'all'; }
  }
  if (document.activeElement !== fmtSel) {
    var seen = {};
    S.nights.concat(S.series, S.polls).forEach(function (x) { if (x.format) seen[x.format] = true; });
    var fmts = FORMATS.filter(function (f) { return seen[f]; }).concat(Object.keys(seen).filter(function (f) { return FORMATS.indexOf(f) < 0; }));
    fmtSel.replaceChildren.apply(fmtSel, [h('option', { value: '', text: 'Any format' })].concat(fmts.map(function (f) { return h('option', { value: f, text: f }); })));
    fmtSel.value = S.f.format;
    if (fmtSel.value !== S.f.format) { S.f.format = ''; fmtSel.value = ''; }
  }
  $('fClear').hidden = !filtersOn();
}
function clearFilters() {
  S.f = { q: '', pod: 'all', format: '', region: '' };
  $('fRegion').value = '';
  $('fSearch').value = '';
  renderFilter(); renderPolls(); renderNights();
}

/* ---------- night and poll form ---------- */
function setMode(m) {
  S.mode = m;
  document.querySelectorAll('#modeSeg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.m === m)); });
  $('fixedFields').hidden = m !== 'fixed';
  $('pollFields').hidden = m !== 'poll';
  updateRepeatUI();
}
function updateRepeatUI() {
  var date = $('nDate').value || todayStr(), day = parseDate(date).toLocaleDateString(undefined, { weekday: 'long' });
  $('optWeekly').textContent = 'Every week on ' + day + 's';
  $('optBiweekly').textContent = 'Every 2 weeks on ' + day + 's';
  $('optMonthly').textContent = 'Every month on the ' + ORD[String(nthOf(date))] + ' ' + day;
  var repeating = $('nRepeat').value !== 'none';
  $('endsFields').hidden = !repeating || S.mode !== 'fixed' || !!S.editing;
  $('nCountField').hidden = $('nEnds').value !== 'count';
  $('nUntilField').hidden = $('nEnds').value !== 'until';
  $('nightSubmit').textContent = S.editing || S.editingSeries ? 'Save changes' : (S.mode === 'poll' ? 'Post poll' : 'Post night');
  updateAddrInUI();
}
function addPollRow(date, time) {
  var row = h('div', { class: 'optrow' },
    h('input', { type: 'date', value: date || '', 'aria-label': 'Date option' }),
    h('input', { type: 'time', value: time || '19:00', 'aria-label': 'Start time for this date' }),
    h('button', { type: 'button', class: 'link', onclick: function () { if ($('pollRows').children.length > 2) row.remove(); else toast('A poll needs at least two dates.'); } }, 'Remove'));
  $('pollRows').append(row);
}
function updateBracketUI() { $('bracketField').hidden = !hasBrackets($('nFormat').value); if ($('addrInRow')) updateAddrInUI(); }
function resetNightForm() {
  $('nightForm').reset();
  S.editing = null; S.editingSeries = null;
  var t = todayStr();
  $('nDate').value = t; $('nTime').value = '19:00'; $('nMin').value = '4';
  $('nBracket').value = '0'; S.formLock = null;
  try { $('nRegion').value = validRegion(localStorage.getItem('pp.region')); } catch (e) {}
  $('nRepeat').value = 'none'; $('optNone').disabled = false; $('nEnds').value = 'never'; $('nCount').value = '6'; $('nUntil').value = '';
  $('pollRows').replaceChildren();
  addPollRow(addDaysYmd(t, 2)); addPollRow(addDaysYmd(t, 3)); addPollRow(addDaysYmd(t, 4));
  S.formPods.clear(); renderFormPods();
  $('formH').textContent = 'Call a night';
  $('modeSeg').hidden = false; $('repeatField').hidden = false;
  updateBracketUI();
  setMode('fixed');
}
function startEdit(n) {
  resetNightForm();
  S.editing = n.id;
  $('nTitle').value = n.title || ''; $('nDate').value = n.date; $('nTime').value = n.time || '';
  $('nFormat').value = n.format || 'Commander'; $('nMin').value = n.min || 4;
  $('nPlace').value = n.place || ''; $('nHost').value = n.host || ''; $('nNote').value = n.note || ''; $('nAddress').value = n.address || '';
  $('nBracket').value = String(n.bracket || 0); updateBracketUI(); $('nRegion').value = validRegion(n.region);
  if (n.addrIn) { $('nAddress').value = (S.hidden[n.id] && S.hidden[n.id].address) || ''; $('nAddrIn').checked = true; }
  S.formLock = baseOf(n);
  S.formPods = new Set(n.podIds || []); renderFormPods();
  $('formH').textContent = 'Edit night';
  $('modeSeg').hidden = true; $('repeatField').hidden = true;
  setMode('fixed');
  openSheet();
}
function startEditSeries(s) {
  resetNightForm();
  S.editingSeries = s.id;
  $('nTitle').value = s.title || ''; $('nDate').value = s.date; $('nTime').value = s.time || '';
  $('nFormat').value = s.format || 'Commander'; $('nMin').value = s.min || 4;
  $('nPlace').value = s.place || ''; $('nHost').value = s.host || ''; $('nNote').value = s.note || ''; $('nAddress').value = s.address || '';
  $('nBracket').value = String(s.bracket || 0); updateBracketUI(); $('nRegion').value = validRegion(s.region);
  S.formLock = baseOf(s);
  $('nRepeat').value = s.freq; $('optNone').disabled = true;
  $('nEnds').value = s.count ? 'count' : s.until ? 'until' : 'never';
  if (s.count) $('nCount').value = s.count;
  if (s.until) $('nUntil').value = s.until;
  S.formPods = new Set(s.podIds || []); renderFormPods();
  $('formH').textContent = 'Edit recurring game';
  $('modeSeg').hidden = true;
  setMode('fixed');
  openSheet();
}
// The series rule from the form. Returns null (after explaining why) if the end date doesn't make sense.
function seriesFromForm(date, time) {
  var s = Object.assign(formCommon(), { date: date, time: time, freq: $('nRepeat').value });
  if (s.freq === 'monthly') s.nth = nthOf(date);
  var ends = $('nEnds').value;
  if (ends === 'count') s.count = Math.min(104, Math.max(2, parseInt($('nCount').value, 10) || 6));
  if (ends === 'until') {
    var u = $('nUntil').value;
    if (!u || u < date) { toast('Pick a last date on or after the first game.'); return null; }
    s.until = u;
  }
  return s;
}
function submitSeries(date, time) {
  var s = seriesFromForm(date, time); if (!s) return;
  s.skips = []; s.by = S.uid; s.at = Date.now();
  var base = formBase();
  S.db.collection(base + 'series').add(s).then(function (ref) {
    s.id = ref.id; if (base) s._priv = base.split('/')[1];
    var first = seriesDates(s, date, addDaysYmd(date, 400), 1)[0];
    if (first) saveMe(function (c) { c.res = c.res || {}; c.res[occurrence(s, first).id] = 'yes'; });
    var text = ['New game night: ' + s.title].concat(seriesLines(s, podById()), ['Answer in one tap: ' + PAGE]).join('\n');
    resetNightForm(); closeSheet();
    toast('Recurring game posted');
    return announce(text, 'Recurring game posted', { kind: 'series', id: ref.id, pod: podOfBase(base) });
  }).catch(writeError);
}
function submitSeriesEdit() {
  var old = seriesById(S.editingSeries);
  if (!old) { toast('That game is gone.'); resetNightForm(); closeSheet(); return; }
  var date = $('nDate').value;
  if (!date) { toast('Pick a date first.'); return; }
  var s = seriesFromForm(date, $('nTime').value || ''); if (!s) return;
  var full = Object.assign(s, { skips: old.skips || [], by: old.by, at: old.at || Date.now() });
  var moved = ['date', 'time', 'place', 'host', 'address', 'region', 'bracket', 'freq', 'count', 'until'].some(function (k) { return (full[k] || '') !== (old[k] || ''); });
  S.db.doc(baseOf(old) + 'series/' + old.id).set(full).then(function () {
    resetNightForm(); closeSheet();
    toast('Recurring game updated');
    if (moved) {
      full.id = old.id;
      var text = ['Updated: ' + full.title].concat(seriesLines(full, podById()), ['Details: ' + PAGE]).join('\n');
      return announce(text, 'Update posted', { kind: 'seriesUpdated', id: old.id, pod: old._priv || '' });
    }
  }).catch(writeError);
}
// "Only show the address to people who are in": the address moves to a separate, locked-down document.
function hideAddress(doc) {
  var on = $('nAddrIn').checked && !$('addrInRow').hidden && !!doc.address;
  doc.addrIn = on;
  if (!on) return null;
  var hidden = { address: doc.address, lat: doc.lat, lng: doc.lng };
  doc.address = ''; doc.lat = null; doc.lng = null;
  return hidden;
}
function updateAddrInUI() {
  $('addrInRow').hidden = S.mode === 'poll' || $('nRepeat').value !== 'none' || !!S.editingSeries;
}
function formCommon() {
  var format = $('nFormat').value;
  return {
    title: $('nTitle').value.trim() || format + ' night',
    format: format,
    min: Math.min(12, Math.max(2, parseInt($('nMin').value, 10) || 4)),
    place: $('nPlace').value.trim(), host: $('nHost').value.trim(),
    address: $('nAddress').value.trim().slice(0, 120), lat: S.formPlace.lat, lng: S.formPlace.lng,
    region: validRegion($('nRegion').value),
    bracket: hasBrackets(format) ? Math.min(4, Math.max(0, parseInt($('nBracket').value, 10) || 0)) : 0,
    podIds: Array.from(S.formPods), note: $('nNote').value.trim()
  };
}
function submitNights() {
  var date = $('nDate').value;
  if (!date) { toast('Pick a date first.'); return; }
  if (needNick()) return;
  var time = $('nTime').value || '';
  if ($('nRepeat').value !== 'none') { submitSeries(date, time); return; }
  var doc = Object.assign(formCommon(), { date: date, time: time, by: S.uid, at: Date.now() });
  var hide = hideAddress(doc), base = formBase();
  S.db.collection(base + 'nights').add(doc).then(function (ref) {
    if (hide) { S.hidden[ref.id] = hide; S.db.doc(base + 'nights/' + ref.id + '/hidden/place').set(hide).catch(writeError); }
    saveMe(function (c) { c.res = c.res || {}; c.res[ref.id] = 'yes'; });
    var text = ['New game night: ' + doc.title].concat(nightDetails(doc, podById()), ['Answer in one tap: ' + PAGE]).join('\n');
    resetNightForm(); closeSheet();
    toast('Night posted');
    return announce(text, null, { kind: 'night', ids: [ref.id], pod: podOfBase(base) });
  }).catch(writeError);
}
function submitPoll() {
  if (needNick()) return;
  var seen = {}, options = [];
  document.querySelectorAll('#pollRows .optrow').forEach(function (r) {
    var ins = r.querySelectorAll('input'), date = ins[0].value, time = ins[1].value || '';
    if (!date || seen[date + time]) return;
    seen[date + time] = true;
    options.push({ date: date, time: time });
  });
  if (options.length < 2) { toast('Add at least two different dates.'); return; }
  options.sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
  options.forEach(function (o, i) { o.id = 'o' + i; });
  var doc = Object.assign(formCommon(), { options: options, by: S.uid, at: Date.now() });
  var base = formBase();
  S.db.collection(base + 'polls').add(doc).then(function (ref) {
    var pm = podById();
    var lines = ['Which night works? ' + doc.title];
    options.forEach(function (o) { lines.push('- ' + fmtWhen(o.date, o.time, true)); });
    var meta = [doc.format, 'need ' + doc.min + ' players'];
    if (doc.place) meta.push(doc.place);
    lines.push(meta.join(', '));
    var pods = podNames(doc, pm);
    if (pods.length) lines.push('Calling: ' + pods.join(', '));
    if (doc.note) lines.push(doc.note);
    lines.push('Vote here: ' + PAGE);
    var text = lines.join('\n');
    resetNightForm(); closeSheet();
    toast('Poll posted');
    return announce(text, 'Poll posted', { kind: 'poll', id: ref.id, pod: podOfBase(base) });
  }).catch(writeError);
}
function submitEdit() {
  var old = S.nights.filter(function (x) { return x.id === S.editing; })[0];
  if (!old) { toast('That night is gone.'); resetNightForm(); closeSheet(); return; }
  var date = $('nDate').value;
  if (!date) { toast('Pick a date first.'); return; }
  var patch = Object.assign(formCommon(), { date: date, time: $('nTime').value || '' });
  var hide = hideAddress(patch), hpath = baseOf(old) + 'nights/' + old.id + '/hidden/place';
  var moved = patch.date !== old.date || patch.time !== (old.time || '') || patch.place !== (old.place || '') || patch.host !== (old.host || '');
  var merged = Object.assign({}, old, patch);
  if (hide) { S.hidden[old.id] = hide; S.db.doc(hpath).set(hide).catch(writeError); }
  else if (old.addrIn) S.db.doc(hpath).delete().catch(function () {});
  S.db.doc(baseOf(old) + 'nights/' + old.id).update(patch).then(function () {
    resetNightForm(); closeSheet();
    toast('Night updated');
    if (moved) {
      var text = ['Updated: ' + merged.title].concat(nightDetails(merged, podById()), ['Details: ' + PAGE]).join('\n');
      return announce(text, 'Update posted', { kind: 'updated', id: old.id, pod: old._priv || '' });
    }
  }).catch(writeError);
}
function copyText(text) {
  var done = function () { toast('Copied'); };
  var fallback = function () { var t = $('announceText'); t.focus(); t.select(); toast('Select the message and copy it'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
}
function wireForms() {
  FORMATS.forEach(function (f) { $('nFormat').append(h('option', { value: f, text: f })); });
  REGIONS.forEach(function (r) { $('nRegion').append(h('option', { value: r, text: r })); $('fRegion').append(h('option', { value: r, text: r })); });
  $('fRegion').addEventListener('change', function (e) { S.f.region = validRegion(e.target.value); renderFilter(); renderPolls(); renderNights(); });
  resetNightForm();
  $('callBtn').addEventListener('click', function () {
    if (needNick()) return;
    resetNightForm(); openSheet();
  });
  $('sheetClose').addEventListener('click', function () { resetNightForm(); closeSheet(); });
  $('sheetBackdrop').addEventListener('click', function () { resetNightForm(); closeSheet(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('nightForm').hidden) { e.preventDefault(); resetNightForm(); closeSheet(); }
  });
  document.querySelectorAll('#tabs button').forEach(function (b) { b.addEventListener('click', function () { setTab(b.dataset.tab); }); });
  window.addEventListener('popstate', function () { setTab(tabFromHash() || 'games', true); });
  window.addEventListener('hashchange', function () { var t = tabFromHash(); if (t && t !== S.tab) setTab(t, true); });
  document.querySelectorAll('#cardsSeg button').forEach(function (b) { b.addEventListener('click', function () { setCardsPref(b.dataset.cards); }); });
  renderCardsSeg();
  $('nightCancel').addEventListener('click', function () { resetNightForm(); closeSheet(); });
  $('addPodBtn').addEventListener('click', function () { if (!$('podForm').hidden && !S.podEdit) { $('podForm').hidden = true; return; } openPodForm(null); });
  $('podCancel').addEventListener('click', function () { $('podForm').hidden = true; S.podEdit = null; });
  $('podDelete').addEventListener('click', deletePodFromForm);
  $('podForm').querySelectorAll('input[name=mana]').forEach(function (r) { r.addEventListener('change', renderBannerPick); });
  document.querySelectorAll('#podJoinSeg button').forEach(function (b) { b.addEventListener('click', function () { setPodJoin(b.dataset.join); }); });
  document.querySelectorAll('#podVisSeg button').forEach(function (b) { b.addEventListener('click', function () { setPodVis(b.dataset.vis); }); });
  $('nAddrIn').addEventListener('change', function () {});
  $('inviteOpen').addEventListener('click', function () { var f = $('inviteForm'); f.hidden = !f.hidden; if (!f.hidden) fillInviteSelects(); });
  $('inviteCancel').addEventListener('click', function () { $('inviteForm').hidden = true; });
  $('invPod').addEventListener('change', fillInviteSelects);
  $('inviteForm').addEventListener('submit', function (e) { e.preventDefault(); if (canWrite()) sendInvite($('invPod').value, $('invWho').value); });
  $('openSeatsMe').addEventListener('change', function (e) {
    if (!canWrite()) return;
    var on = e.target.checked;
    saveMe(function (c) { if (on) c.openSeats = true; else delete c.openSeats; }).then(helperSync);
  });
  $('nickCancel').addEventListener('click', closeNick);
  document.querySelectorAll('#ciPick button').forEach(function (b) {
    b.addEventListener('click', function () {
      var ci = validCi(S.ciDraft), c = b.dataset.c;
      S.ciDraft = ci.indexOf(c) >= 0 ? ci.replace(c, '') : validCi(ci + c);
      renderCiPick();
      applyIdentity(S.ciDraft);
    });
  });
  $('closeAnnounce').addEventListener('click', function () { $('announce').hidden = true; });
  $('copyAnnounce').addEventListener('click', function () { copyText($('announceText').value); });
  $('addOpt').addEventListener('click', function () {
    var rows = $('pollRows').children;
    if (rows.length >= 6) { toast('Six dates is the most a poll can hold.'); return; }
    var last = rows.length ? rows[rows.length - 1].querySelector('input').value : todayStr();
    addPollRow(addDaysYmd(last || todayStr(), 1));
  });
  document.querySelectorAll('#modeSeg button').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.m); }); });
  $('fSearch').addEventListener('input', function (e) { S.f.q = e.target.value.trim(); $('fClear').hidden = !filtersOn(); renderPolls(); renderNights(); });
  $('fPod').addEventListener('change', function (e) { S.f.pod = e.target.value; renderFilter(); renderPolls(); renderNights(); });
  $('fFormat').addEventListener('change', function (e) { S.f.format = e.target.value; renderFilter(); renderPolls(); renderNights(); });
  $('fClear').addEventListener('click', clearFilters);
  ['nDate', 'nRepeat', 'nEnds'].forEach(function (id) { $(id).addEventListener('change', updateRepeatUI); });
  $('nDate').addEventListener('input', updateRepeatUI);
  document.querySelectorAll('#openSeg button').forEach(function (b) {
    b.addEventListener('click', function () { if (S.isAdmin) setOpen(b.dataset.open === 'true'); });
  });
  $('discordForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (S.isAdmin) saveDiscord($('discWebhook').value, $('discPing').value);
  });
  $('discRemove').addEventListener('click', function () {
    if (!S.isAdmin || !armConfirm('dr', renderMembers)) return;
    $('discWebhook').value = '';
    saveDiscord('', '');
  });
  $('addMemberForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!S.isAdmin) return;
    addMember($('newMember').value).then(function (ok) { if (ok) $('newMember').value = ''; });
  });

  $('nickForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('nick').value.trim().slice(0, 24); if (!v || !canWrite()) return;
    var ci = validCi(S.ciDraft);
    var area = $('area').value.trim().slice(0, 60), m = me() || {};
    var same = area === (m.area || '');
    var lookup = !area ? Promise.resolve(null) : same && typeof m.alat === 'number' ? Promise.resolve({ lat: m.alat, lng: m.alng }) : geocode(area);
    lookup.then(function (g) {
      saveMe(function (c) {
        c.nick = v; if (ci) c.ci = ci; else delete c.ci;
        if (area && g) { c.area = area; c.alat = roundTo(g.lat, 2); c.alng = roundTo(g.lng, 2); }
        else if (area && same) { c.area = area; }
        else { delete c.area; delete c.alat; delete c.alng; if (area) c.area = area; }
      }).then(function () { toast(area && !g ? "Saved. Couldn't find that area on the map, so distances are off." : 'Saved'); });
    });
    closeNick();
    $('callBtn').focus();
  });
  $('podForm').addEventListener('submit', function (e) { e.preventDefault(); submitPod(); });
  $('nightForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!canWrite() || S.placeBusy) return;
    var old = S.editingSeries ? seriesById(S.editingSeries) : S.editing ? S.nights.filter(function (x) { return x.id === S.editing; })[0] : null;
    var btn = $('nightSubmit'), label = btn.textContent;
    var address = $('nAddress').value.trim().slice(0, 120);
    try { if (validRegion($('nRegion').value)) localStorage.setItem('pp.region', $('nRegion').value); } catch (e) {}
    S.placeBusy = true;
    if (address && !(old && old.address === address)) { btn.disabled = true; btn.textContent = 'Finding the address…'; }
    resolvePlace(address, old).then(function (pl) {
      S.placeBusy = false; btn.disabled = false; btn.textContent = label;
      S.formPlace = pl;
      if (address && pl.lat == null) toast("Couldn't find that address on the map, so no distance. Directions still work.");
      if (S.editingSeries) submitSeriesEdit();
      else if (S.editing) submitEdit();
      else if (S.mode === 'poll') submitPoll();
      else submitNights();
    });
  });
  $('hereBtn').addEventListener('click', useHere);
  $('addDeckBtn').addEventListener('click', function () { if (!$('deckForm').hidden && !S.deckEdit) { closeDeckForm(); return; } openDeckForm(null); });
  $('deckCancel').addEventListener('click', closeDeckForm);
  $('deckDelete').addEventListener('click', deleteDeck);
  $('deckForm').addEventListener('submit', function (e) { e.preventDefault(); submitDeck(); });
  $('dCmd').addEventListener('input', onCmdInput);
  $('dCmd').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { if (moveCmd(1)) e.preventDefault(); }
    else if (e.key === 'ArrowUp') { if (moveCmd(-1)) e.preventDefault(); }
    else if (e.key === 'Enter' && !$('dCmdList').hidden && S.cmdActive >= 0) { e.preventDefault(); pickCommander(S.cmdOptions[S.cmdActive]); }
    else if (e.key === 'Escape' && !$('dCmdList').hidden) { e.preventDefault(); cmdList(false); }
  });
  $('dCmd').addEventListener('blur', function () { setTimeout(function () { cmdList(false); }, 120); });
  $('nFormat').addEventListener('change', updateBracketUI);
}

/* ---------- loading the board: public data plus the private pods you can see ---------- */
function tagged(list, podId) { return list.map(function (o) { o._priv = podId; return o; }); }
function mergeData() {
  var privPods = Object.keys(S.priv.pods).map(function (id) { return S.priv.pods[id]; });
  var pubIds = {}; S.pub.pods.forEach(function (p) { pubIds[p.id] = true; });
  S.pods = S.pub.pods.concat(privPods.filter(function (p) { return !pubIds[p.id]; }));
  ['nights', 'series', 'polls'].forEach(function (k) {
    var all = S.pub[k].slice();
    Object.keys(S.priv.data).forEach(function (id) { if (S.priv.data[id][k]) all = all.concat(S.priv.data[id][k]); });
    S[k] = all;
  });
}
function snapDocs(snap) { return snap.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }); }
function unsub(key) { var f = S.subs[key]; if (f) { try { f(); } catch (e) {} delete S.subs[key]; } }
// Private pods you can see: as an organizer, all of them; otherwise the ones you're in, invited to, or created.
function syncPrivate() {
  if (!S.db || S.state !== 'ok' || !S.uid) return;
  var pubIds = {}; S.pub.pods.forEach(function (p) { pubIds[p.id] = true; });
  var want = {};
  if (!S.isAdmin) {
    myPods().concat(S.invites.filter(function (x) { return x.uid === S.uid && x.ok === true; }).map(function (x) { return x.podId; }))
      .forEach(function (id) { if (id && !pubIds[id]) want[id] = true; });
    Object.keys(want).forEach(function (id) {
      var key = 'pod:' + id;
      if (S.subs[key]) return;
      S.subs[key] = S.db.doc('privpods/' + id).onSnapshot(function (snap) {
        if (snap.exists) { var o = snap.data(); o.id = id; o.private = true; S.priv.pods[id] = o; }
        else if (!S.privByMe[id]) delete S.priv.pods[id];
        mergeData(); syncPrivate(); renderAll();
      }, function () { delete S.priv.pods[id]; mergeData(); renderAll(); });
    });
    Object.keys(S.subs).forEach(function (key) {
      if (key.indexOf('pod:') === 0 && !want[key.slice(4)]) {
        unsub(key);
        var id = key.slice(4);
        if (!S.privByMe[id]) delete S.priv.pods[id];
      }
    });
  }
  // The games of private pods you're in (organizers: every private pod).
  var mine = {}; myPods().forEach(function (id) { mine[id] = true; });
  var dataFor = {};
  Object.keys(S.priv.pods).forEach(function (id) { if (S.isAdmin || mine[id]) dataFor[id] = true; });
  Object.keys(dataFor).forEach(function (id) {
    ['nights', 'series', 'polls'].forEach(function (k) {
      var key = 'data:' + id + ':' + k;
      if (S.subs[key]) return;
      S.subs[key] = S.db.collection('privpods/' + id + '/' + k).onSnapshot(function (snap) {
        (S.priv.data[id] = S.priv.data[id] || {})[k] = tagged(snapDocs(snap), id);
        mergeData(); renderAll();
      }, function () { if (S.priv.data[id]) delete S.priv.data[id][k]; mergeData(); renderAll(); });
    });
  });
  Object.keys(S.subs).forEach(function (key) {
    if (key.indexOf('data:') !== 0) return;
    var id = key.split(':')[1];
    if (!dataFor[id]) { unsub(key); delete S.priv.data[id]; }
  });
  mergeData();
}
// A hidden address ("only people who are in"): readable by the host, organizers and people who said I'm in.
function canSeeHidden(n) { return S.isAdmin || mineId(n.by) || (me() && answerOf(me(), n) === 'yes'); }
function hiddenPlace(n) {
  if (!n.addrIn || n.virtual) return null;
  var path = baseOf(n) + 'nights/' + n.id + '/hidden/place';
  var ok = canSeeHidden(n), key = path + (ok ? ':ok' : ':no');
  if (!ok) { if (S.hiddenSubs[path]) { try { S.hiddenSubs[path].stop(); } catch (e) {} delete S.hiddenSubs[path]; } delete S.hidden[n.id]; return null; }
  var cur = S.hiddenSubs[path];
  if (!cur || (cur.failed && Date.now() - cur.failed > 2000)) {
    if (cur) { try { cur.stop(); } catch (e) {} }
    var rec = { stop: null, failed: 0 };
    S.hiddenSubs[path] = rec;
    rec.stop = S.db.doc(path).onSnapshot(function (snap) {
      if (snap.exists) S.hidden[n.id] = snap.data(); else delete S.hidden[n.id];
      renderNights();
    }, function () { rec.failed = Date.now(); setTimeout(renderNights, 2500); });
  }
  return S.hidden[n.id] || null;
}
// Several writes that must happen together (a batch where the backend has one).
function writeAll(ops) {
  if (S.db.batch) {
    var b = S.db.batch();
    ops.forEach(function (o) { if (o[0] === 'delete') b.delete(o[1]); else b[o[0]](o[1], o[2]); });
    return b.commit();
  }
  return ops.reduce(function (p, o) { return p.then(function () { var d = S.db.doc(o[1]); return o[0] === 'delete' ? d.delete() : d[o[0]](o[2]); }); }, Promise.resolve());
}
function stripLocal(o) { var c = JSON.parse(JSON.stringify(o)); delete c.id; delete c._priv; delete c.private; delete c.virtual; return c; }
// Organizers can move a pod (and the games that are only for it) between the public board and private.
function movePod(p, toPrivate) {
  var id = p.id, ops = [], from = toPrivate ? '' : 'privpods/' + id + '/', to = toPrivate ? 'privpods/' + id + '/' : '';
  var pod = stripLocal(p);
  if (toPrivate) { pod.join = 'invite'; pod.openSeats = false; }
  ops.push(['set', toPrivate ? 'privpods/' + id : 'pods/' + id, pod]);
  ['nights', 'series', 'polls'].forEach(function (k) {
    S[k].forEach(function (x) {
      var ids = x.podIds || [];
      if (toPrivate ? (x._priv || ids.indexOf(id) < 0) : x._priv !== id) return;
      if (toPrivate && ids.length > 1) { ops.push(['update', k + '/' + x.id, { podIds: ids.filter(function (y) { return y !== id; }) }]); return; }
      ops.push(['set', to + k + '/' + x.id, stripLocal(x)]);
      if (k === 'nights' && x.addrIn && S.hidden[x.id]) {
        ops.push(['set', to + 'nights/' + x.id + '/hidden/place', S.hidden[x.id]]);
        ops.push(['delete', from + 'nights/' + x.id + '/hidden/place']);
      }
      ops.push(['delete', from + k + '/' + x.id]);
    });
  });
  ops.push(['delete', toPrivate ? 'pods/' + id : 'privpods/' + id]);
  return writeAll(ops);
}

/* ---------- boot ---------- */
function allConfirmed() { return S.confirmed.pods && S.confirmed.nights && S.confirmed.polls && S.confirmed.people && S.confirmed.series; }
function sub(name, key, assign) {
  S.db.collection(name).onSnapshot(function (snap) {
    assign(snap.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }));
    if (key) {
      S.loaded[key] = true;
      if (!snap.metadata.fromCache) S.confirmed[key] = true;
      if (allConfirmed()) S.slow = false;
    }
    renderAll();
  }, function () { if (key) S.error = true; renderAll(); });
}
async function boot() {
  var hash = location.hash;
  if (/^#discord=/.test(hash)) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    setTimeout(function () {
      toast(hash === '#discord=linked' ? 'Discord connected. Your pod roles are on their way.' : "Discord didn't connect. Try again from your profile.");
    }, 400);
  }
  S.tab = tabFromHash() || 'games';
  wireForms();
  renderAll();
  var r = await BACKEND.connect();
  S.state = r.state; S.db = r.db || null; S.uid = r.uid || null; S.isAdmin = !!(r.isAdmin || r.canEdit);
  S.canWriteFlag = r.canWrite == null ? null : r.canWrite; S.profileName = r.profileName || '';
  S.email = r.email || ''; S.request = r.request || null;
  if (S.tab === 'me') fillNick();
  renderAll();
  if (!S.db || S.state !== 'ok') return;
  setTimeout(function () { if (!allConfirmed()) { S.slow = true; renderAll(); } }, 10000);
  S.privByMe = {};
  sub('pods', 'pods', function (a) { S.pub.pods = a; mergeData(); syncPrivate(); });
  sub('nights', 'nights', function (a) { S.pub.nights = a; mergeData(); });
  sub('polls', 'polls', function (a) { S.pub.polls = a; mergeData(); });
  sub('series', 'series', function (a) { S.pub.series = a; mergeData(); });
  if (S.isAdmin) {
    S.db.collection('privpods').onSnapshot(function (snap) {
      var m = {}; snapDocs(snap).forEach(function (o) { o.private = true; m[o.id] = o; });
      S.priv.pods = m; mergeData(); syncPrivate(); renderAll();
    }, function () {});
  } else if (S.db.collection('privpods').where) {
    S.db.collection('privpods').where('by', '==', S.uid).onSnapshot(function (snap) {
      var mineNow = {};
      snapDocs(snap).forEach(function (o) { o.private = true; mineNow[o.id] = true; S.priv.pods[o.id] = o; });
      Object.keys(S.privByMe).forEach(function (id) { if (!mineNow[id] && !S.subs['pod:' + id]) delete S.priv.pods[id]; });
      S.privByMe = mineNow; mergeData(); syncPrivate(); renderAll();
    }, function () {});
  }
  sub(PEOPLE, 'people', function (a) { var m = {}; a.forEach(function (p) { m[p.id] = p; }); S.people = m; syncPrivate(); });
  sub('invites', null, function (a) { S.invites = a; syncPrivate(); });
  if (HELPER && S.uid) subDoc('links/' + S.uid, function (d) { S.link = d.discordId ? d : null; });
  if (ACCOUNTS) {
    subDoc('config/settings', function (d) { S.settings = { open: !!d.open, blocked: d.blocked || [] }; });
    subDoc('config/discord', applyDiscord);
    if (S.isAdmin) {
      subDoc('config/members', function (d) { S.members = { emails: d.emails || [], admins: d.admins || [] }; });
      sub('requests', null, function (a) { S.requests = a; });
    }
  }
}
function subDoc(path, assign) {
  // Settings that a viewer may not be allowed to read just stay at their defaults.
  S.db.doc(path).onSnapshot(function (snap) { assign(snap.exists ? (snap.data() || {}) : {}); renderAll(); }, function () {});
}
boot();
})();
