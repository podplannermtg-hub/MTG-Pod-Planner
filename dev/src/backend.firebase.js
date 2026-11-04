/* Firebase backend. Your settings live in config.js, not here. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, query, where, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const CONFIG = {
  firebase: ((window.POD_CONFIG || {}).firebase) || {},
  // Filled in from the members-only database after sign-in.
  discordWebhook: '',
  discordPing: ''
};

let fbAuth = null, fs = null;
const HELPER_URL = String(((window.POD_CONFIG || {}).helperUrl) || '').replace(/\/+$/, '');

// The Discord helper (optional). Every call carries the signed-in person's Firebase token,
// which the helper checks before doing anything.
const HELPER = HELPER_URL ? {
  async call(path, body) {
    const token = await fbAuth.currentUser.getIdToken();
    const r = await fetch(HELPER_URL + path, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || ('helper ' + r.status)), { status: r.status });
    return j;
  }
} : null;

const BACKEND = {
  config: CONFIG,
  peopleCol: 'people',
  features: { accounts: true, ics: true },
  pageUrl: location.href.split('#')[0].split('?')[0],
  helper: HELPER,
  go(url) { location.href = url; },
  afterAuth() { location.reload(); },
  auth: {
    google() { return signInWithPopup(fbAuth, new GoogleAuthProvider()); },
    signIn(email, pw) { return signInWithEmailAndPassword(fbAuth, email, pw); },
    async signUp(email, pw) {
      const cred = await createUserWithEmailAndPassword(fbAuth, email, pw);
      await sendEmailVerification(cred.user);
    },
    resendVerification() { return sendEmailVerification(fbAuth.currentUser); },
    async checkVerified() {
      await fbAuth.currentUser.reload();
      if (!fbAuth.currentUser.emailVerified) return false;
      await fbAuth.currentUser.getIdToken(true);
      return true;
    },
    resetPassword(email) { return sendPasswordResetEmail(fbAuth, email); },
    signOut() { return signOut(fbAuth); },
    requestAccess(name) {
      const u = fbAuth.currentUser;
      return setDoc(doc(fs, 'requests', u.uid), { email: (u.email || '').toLowerCase(), name, at: Date.now() });
    }
  },
  async connect() {
    const key = String(CONFIG.firebase.apiKey || '');
    if (!key || key.indexOf('PASTE') === 0) return { state: 'setup' };
    const app = initializeApp(CONFIG.firebase);
    fbAuth = getAuth(app);
    fs = getFirestore(app);
    const user = await new Promise((resolve) => { const stop = onAuthStateChanged(fbAuth, (u) => { stop(); resolve(u); }); });
    if (!user) return { state: 'signedout' };
    const base = { uid: user.uid, email: (user.email || '').toLowerCase(), profileName: user.displayName || '' };
    if (!user.emailVerified) return Object.assign(base, { state: 'unverified' });

    // Only members can read the board. A refusal here means "not on the list" (or blocked).
    try { await getDoc(doc(fs, 'people', user.uid)); }
    catch (e) {
      if (e && e.code === 'permission-denied') {
        let request = null;
        try { const r = await getDoc(doc(fs, 'requests', user.uid)); if (r.exists()) request = r.data(); } catch (x) {}
        return Object.assign(base, { state: 'notmember', request });
      }
    }
    // Only organizers can read the members list.
    let isAdmin = false;
    try { await getDoc(doc(fs, 'config', 'members')); isAdmin = true; } catch (e) {}

    const listen = (q, next, err) => onSnapshot(q, (snap) => {
      next({ docs: snap.docs.map((d) => ({ id: d.id, data: () => d.data() })), metadata: snap.metadata });
    }, err);
    const db = {
      collection(name) {
        return {
          onSnapshot(next, err) { return listen(collection(fs, name), next, err); },
          where(field, op, value) {
            return { onSnapshot(next, err) { return listen(query(collection(fs, name), where(field, op, value)), next, err); } };
          },
          add(data) { return addDoc(collection(fs, name), data).then((r) => ({ id: r.id })); }
        };
      },
      batch() {
        const b = writeBatch(fs), ref = (path) => doc(fs, ...path.split('/'));
        return {
          set(path, d) { b.set(ref(path), d); },
          update(path, d) { b.update(ref(path), d); },
          delete(path) { b.delete(ref(path)); },
          commit() { return b.commit(); }
        };
      },
      doc(path) {
        const ref = doc(fs, ...path.split('/'));
        return {
          set: (d) => setDoc(ref, d),
          update: (d) => updateDoc(ref, d),
          delete: () => deleteDoc(ref),
          onSnapshot: (next, err) => onSnapshot(ref, (s) => next({ exists: s.exists(), data: () => s.data(), metadata: s.metadata }), err)
        };
      }
    };
    return Object.assign(base, { state: 'ok', db, isAdmin, canEdit: isAdmin, canWrite: true });
  },
  saveFile(name, mime, text) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return Promise.resolve();
  }
};
