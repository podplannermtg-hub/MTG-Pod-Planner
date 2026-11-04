// Loads the real standalone build over http with its Content Security Policy, with Firebase's
// modules replaced by stand-ins, and checks that nothing the app needs is blocked.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = process.argv[2];

const STUBS = {
  'firebase-app.js': 'export function initializeApp(c){ return { c }; }',
  'firebase-auth.js': [
    'export function getAuth(){ return {}; }',
    'export function onAuthStateChanged(a, cb){ setTimeout(() => cb(null)); return () => {}; }',
    'export class GoogleAuthProvider {}',
    'export async function signInWithPopup(){ sessionStorage.setItem("popup", "1"); }',
    'export async function signInWithEmailAndPassword(){}', 'export async function createUserWithEmailAndPassword(){ return { user: {} }; }',
    'export async function sendEmailVerification(){}', 'export async function sendPasswordResetEmail(){}', 'export async function signOut(){}'
  ].join('\n'),
  'firebase-firestore.js': ['getFirestore', 'collection', 'doc', 'getDoc', 'onSnapshot', 'addDoc', 'setDoc', 'updateDoc', 'deleteDoc']
    .map((n) => 'export function ' + n + '(){ return {}; }').join('\n')
};

const results = [];
const check = (name, ok, extra) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); };

(async () => {
  const server = http.createServer((req, res) => {
    const f = path.join(DIR, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(DIR) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
    fs.createReadStream(f).pipe(res);
  }).listen(8765);
  const browser = await chromium.launch();

  for (const configured of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
    await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
    await page.route('**/*', (route) => {
      const u = route.request().url();
      const m = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z]+\.js)$/);
      if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: STUBS[m[1]] });
      if (configured && u.split('?')[0].endsWith('/config.js')) return route.fulfill({ status: 200, contentType: 'text/javascript',
        body: "window.POD_CONFIG = { firebase: { apiKey: 'AIzaTEST', authDomain: 'demo.firebaseapp.com', projectId: 'demo', appId: '1:2:web:3' } };" });
      if (u.startsWith('http://localhost:8765/')) return route.continue();
      return route.abort();
    });
    await page.goto('http://localhost:8765/');
    if (!configured) {
      await page.waitForSelector('#notice:not([hidden])');
      check('unconfigured: app runs under the CSP and asks for setup', (await page.innerText('#notice')).startsWith('Setup is not finished'));
    } else {
      await page.waitForSelector('#googleBtn');
      check('configured: sign-in screen renders under the CSP', await page.locator('#googleBtn').isVisible());
      await page.click('#googleBtn');
      await page.waitForFunction(() => sessionStorage.getItem('popup') === '1');
      check('configured: Google button reaches Firebase sign-in', true);
    }
    const csp = await page.evaluate(() => window.__csp);
    check((configured ? 'configured' : 'unconfigured') + ': no CSP violations', csp.length === 0, csp);
    check((configured ? 'configured' : 'unconfigured') + ': no errors', errors.length === 0, errors);
    // and prove the policy is active: an injected inline script must be refused
    const injected = await page.evaluate(() => new Promise((res) => {
      window.__ran = false;
      const s = document.createElement('script'); s.textContent = 'window.__ran = true'; document.body.append(s);
      setTimeout(() => res(window.__ran), 50);
    }));
    check((configured ? 'configured' : 'unconfigured') + ': injected inline script is blocked', injected === false);
    await page.close();
  }
  await browser.close(); server.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
  process.exit(failed ? 1 : 0);
})();
