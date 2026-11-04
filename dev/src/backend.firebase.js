/* Firebase backend. Your settings live in config.js, not here. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const CONFIG = {
  firebase: ((window.POD_CONFIG || {}).firebase) || {},
  // Filled in from the members-only database after sign-in.
  discordWebhook: '',
  discordPing: ''
};

let fbAuth = null, fs = null;

const BACKEND = {
  config: CONFIG,
  peopleCol: 'people',
  features: { accounts: true, ics: true },
  pageUrl: location.href.split('#')[0].split('?')[0],
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

    const db = {
      collection(name) {
        return {
          onSnapshot(next, err) {
            return onSnapshot(collection(fs, name), (snap) => {
              next({ docs: snap.docs.map((d) => ({ id: d.id, data: () => d.data() })), metadata: snap.metadata });
            }, err);
          },
          add(data) { return addDoc(collection(fs, name), data).then((r) => ({ id: r.id })); }
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
