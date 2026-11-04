/* Test backend: an in-memory stand-in for Firebase. Seed with window.__seed; pick the sign-in state with window.__auth. */
var BACKEND = (function () {
  var store = window.__seed || {}, listeners = {}, n = 0;
  var A = window.__auth || { state: 'ok', uid: 'me1', email: 'me@example.com', isAdmin: false };
  window.__store = store; window.__calls = []; window.__afterAuth = 0;
  function snapshot(name) {
    var c = store[name] || {};
    return { docs: Object.keys(c).map(function (id) { return { id: id, data: function () { return JSON.parse(JSON.stringify(c[id])); } }; }), metadata: { fromCache: false } };
  }
  var docListeners = {};
  function docSnap(name, id) {
    var c = store[name] || {}, has = Object.prototype.hasOwnProperty.call(c, id);
    return { exists: has, data: function () { return has ? JSON.parse(JSON.stringify(c[id])) : undefined; }, metadata: { fromCache: false } };
  }
  function fire(name) {
    (listeners[name] || []).forEach(function (fn) { Promise.resolve().then(function () { fn(snapshot(name)); }); });
    Object.keys(docListeners).forEach(function (p) {
      var parts = p.split('/');
      if (parts[0] === name) docListeners[p].forEach(function (fn) { Promise.resolve().then(function () { fn(docSnap(parts[0], parts[1])); }); });
    });
  }
  function stub(name, value) {
    return function () {
      window.__calls.push([name].concat([].slice.call(arguments)));
      var fail = (window.__authFail || {})[name];
      return fail ? Promise.reject({ code: fail }) : Promise.resolve(typeof value === 'function' ? value.apply(null, arguments) : value);
    };
  }
  var db = {
    collection: function (name) {
      return {
        onSnapshot: function (next) { (listeners[name] = listeners[name] || []).push(next); Promise.resolve().then(function () { next(snapshot(name)); }); return function () {}; },
        add: function (data) { var id = 'auto' + (++n); (store[name] = store[name] || {})[id] = JSON.parse(JSON.stringify(data)); fire(name); return Promise.resolve({ id: id }); }
      };
    },
    doc: function (path) {
      var parts = path.split('/'), name = parts[0], id = parts[1];
      return {
        set: function (d) { (store[name] = store[name] || {})[id] = JSON.parse(JSON.stringify(d)); fire(name); return Promise.resolve(); },
        update: function (d) { if (!store[name] || !store[name][id]) return Promise.reject({ code: 'not-found' }); Object.assign(store[name][id], JSON.parse(JSON.stringify(d))); fire(name); return Promise.resolve(); },
        delete: function () { if (store[name]) delete store[name][id]; fire(name); return Promise.resolve(); },
        onSnapshot: function (next, err) {
          if ((window.__denyDocs || []).indexOf(path) >= 0) { Promise.resolve().then(function () { err && err({ code: 'permission-denied' }); }); return function () {}; }
          (docListeners[path] = docListeners[path] || []).push(next);
          Promise.resolve().then(function () { next(docSnap(name, id)); });
          return function () {};
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
