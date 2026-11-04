/* Test backend: an in-memory stand-in for Firebase. Seed with window.__seed; pick the sign-in state with window.__auth. */
var BACKEND = (function () {
  var store = window.__seed || {}, n = 0;
  var A = window.__auth || { state: 'ok', uid: 'me1', email: 'me@example.com', isAdmin: false };
  window.__store = store; window.__calls = []; window.__afterAuth = 0;
  // Collections are keyed by their full path ("nights", "privpods/p1/nights").
  function uid() { return A.uid; }
  function person() { return (store.people || {})[uid()] || {}; }
  function inPod(id) { return (person().pods || []).indexOf(id) >= 0; }
  function invitedTo(id) { return !!(store.invites || {})[id + '_' + uid()]; }
  // With window.__rules on, reads the real database rules would refuse fail the same way here.
  function canListCol(col, w) {
    if (!window.__rules || A.isAdmin) return true;
    if (col === 'privpods') return !!(w && w[0] === 'by' && w[2] === uid());
    var m = /^privpods\/([^/]+)\/(nights|series|polls)$/.exec(col);
    if (m) return inPod(m[1]);
    return true;
  }
  function canReadDoc(path) {
    if (!window.__rules || A.isAdmin) return true;
    var parts = path.split('/');
    if (parts[0] === 'privpods' && parts.length === 2) { var p = (store.privpods || {})[parts[1]]; return (p && p.by === uid()) || inPod(parts[1]) || invitedTo(parts[1]); }
    if (parts[0] === 'privpods' && parts.length === 4) return inPod(parts[1]);
    if (parts[parts.length - 2] === 'hidden') {
      var nightCol = parts.slice(0, -3).join('/'), nid = parts[parts.length - 3];
      if (nightCol.indexOf('privpods/') === 0 && !inPod(nightCol.split('/')[1])) return false;
      var night = (store[nightCol] || {})[nid];
      return !!night && (night.by === uid() || ((person().res || {})[nid] === 'yes'));
    }
    return true;
  }
  function matches(d, w) { return !w || (w[1] === '==' && d[w[0]] === w[2]); }
  function snapshot(name, w) {
    var c = store[name] || {};
    return { docs: Object.keys(c).filter(function (id) { return matches(c[id], w); }).map(function (id) { return { id: id, data: function () { return JSON.parse(JSON.stringify(c[id])); } }; }), metadata: { fromCache: false } };
  }
  var listeners = [], docListeners = [];
  function split(path) { var parts = path.split('/'); return { col: parts.slice(0, -1).join('/'), id: parts[parts.length - 1] }; }
  function docSnap(path) {
    var s2 = split(path), c = store[s2.col] || {}, has = Object.prototype.hasOwnProperty.call(c, s2.id);
    return { exists: has, data: function () { return has ? JSON.parse(JSON.stringify(c[s2.id])) : undefined; }, metadata: { fromCache: false } };
  }
  function fire(col) {
    listeners.forEach(function (l) { if (l.col === col && l.on) Promise.resolve().then(function () { if (l.on) l.next(snapshot(col, l.w)); }); });
    docListeners.forEach(function (l) {
      if (split(l.path).col !== col || !l.on) return;
      Promise.resolve().then(function () {
        if (!l.on) return;
        if (!canReadDoc(l.path)) { l.on = false; if (l.err) l.err({ code: 'permission-denied' }); return; }
        l.next(docSnap(l.path));
      });
    });
  }
  function stub(name, value) {
    return function () {
      window.__calls.push([name].concat([].slice.call(arguments)));
      var fail = (window.__authFail || {})[name];
      return fail ? Promise.reject({ code: fail }) : Promise.resolve(typeof value === 'function' ? value.apply(null, arguments) : value);
    };
  }
  function colListen(name, w, next, err) {
    window.__listens = (window.__listens || []).concat([[name].concat(w || [])]);
    if (!canListCol(name, w)) { Promise.resolve().then(function () { err && err({ code: 'permission-denied' }); }); return function () {}; }
    var l = { col: name, w: w, next: next, on: true };
    listeners.push(l);
    Promise.resolve().then(function () { if (l.on) next(snapshot(name, w)); });
    return function () { l.on = false; };
  }
  function write(op, path, d) {
    var s2 = split(path);
    if (op === 'set') (store[s2.col] = store[s2.col] || {})[s2.id] = JSON.parse(JSON.stringify(d));
    else if (op === 'update') { if (!store[s2.col] || !store[s2.col][s2.id]) throw { code: 'not-found' }; Object.assign(store[s2.col][s2.id], JSON.parse(JSON.stringify(d))); }
    else if (store[s2.col]) delete store[s2.col][s2.id];
    return s2.col;
  }
  var db = {
    collection: function (name) {
      return {
        onSnapshot: function (next, err) { return colListen(name, null, next, err); },
        where: function (f, op, v) { return { onSnapshot: function (next, err) { return colListen(name, [f, op, v], next, err); } }; },
        add: function (data) { var id = 'auto' + (++n); (store[name] = store[name] || {})[id] = JSON.parse(JSON.stringify(data)); fire(name); return Promise.resolve({ id: id }); }
      };
    },
    batch: function () {
      var ops = [];
      return {
        set: function (p, d) { ops.push(['set', p, d]); }, update: function (p, d) { ops.push(['update', p, d]); }, delete: function (p) { ops.push(['delete', p]); },
        commit: function () {
          window.__batches = (window.__batches || 0) + 1;
          try { var cols = ops.map(function (o) { return write(o[0], o[1], o[2]); }); cols.filter(function (c, i) { return cols.indexOf(c) === i; }).forEach(fire); return Promise.resolve(); }
          catch (e) { return Promise.reject(e); }
        }
      };
    },
    doc: function (path) {
      return {
        set: function (d) { fire(write('set', path, d)); return Promise.resolve(); },
        update: function (d) { try { fire(write('update', path, d)); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
        delete: function () { fire(write('delete', path)); return Promise.resolve(); },
        onSnapshot: function (next, err) {
          if ((window.__denyDocs || []).indexOf(path) >= 0 || !canReadDoc(path)) { Promise.resolve().then(function () { err && err({ code: 'permission-denied' }); }); return function () {}; }
          var l = { path: path, next: next, err: err, on: true };
          docListeners.push(l);
          Promise.resolve().then(function () { if (l.on) next(docSnap(path)); });
          return function () { l.on = false; };
        }
      };
    }
  };
  return {
    config: { discordWebhook: '', discordPing: '' },
    peopleCol: 'people',
    features: { accounts: true, ics: true },
    pageUrl: 'https://example.test/pods/',
    afterAuth: function () { window.__afterAuth++; },
    helper: window.__helper ? {
      call: function (path, body) {
        (window.__helperCalls = window.__helperCalls || []).push([path, body]);
        return Promise.resolve(path === '/link/start' ? { url: 'https://discord.com/oauth2/authorize?test' } : path === '/announce' ? { posted: true } : { ok: true });
      }
    } : null,
    go: function (url) { window.__went = url; },
    auth: {
      google: stub('google'), signIn: stub('signIn'), signUp: stub('signUp'),
      resendVerification: stub('resend'), checkVerified: stub('checkVerified', function () { return !!window.__verified; }),
      resetPassword: stub('reset'), signOut: stub('signOut'),
      requestAccess: stub('request', function (name) {
        (store.requests = store.requests || {})[A.uid] = { email: A.email, name: name, at: Date.now() };
      })
    },
    connect: function () {
      var base = { uid: A.uid, email: A.email, profileName: A.profileName || '', state: A.state };
      if (A.state !== 'ok') return Promise.resolve(Object.assign(base, { request: A.request || null }));
      return Promise.resolve(Object.assign(base, { db: db, isAdmin: !!A.isAdmin, canEdit: !!A.isAdmin, canWrite: true }));
    },
    saveFile: function (name, mime, text) { window.__saved = (window.__saved || []).concat([{ name: name, mime: mime, text: text }]); return Promise.resolve(); }
  };
})();
