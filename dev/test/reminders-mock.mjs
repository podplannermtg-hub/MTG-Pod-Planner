// Preload for testing remind.mjs: a real RSA service-account key, a fake Google token endpoint
// that checks the signed JWT, fake Firestore REST, and a fake Discord webhook.
import { generateKeyPairSync, createVerify } from 'node:crypto';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account', project_id: 'demo-pods', client_email: 'bot@demo-pods.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token'
});
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const S = (s) => ({ stringValue: s }), M = (o) => ({ mapValue: { fields: o } }), A = (l) => ({ arrayValue: { values: l } });
const D = (col, id, fields) => ({ name: 'projects/demo-pods/databases/(default)/documents/' + col + '/' + id, fields });
const docs = {
  nights: [
    D('nights', 'n1', { title: S('Thursday Commander'), date: S(tomorrow), time: S('19:00'), place: S("Dan's place"), host: S('Dan'), min: { integerValue: '4' }, podIds: A([S('p1')]) }),
    D('nights', 'n3', { title: S('Poll winner'), date: S(tomorrow), time: S('20:00'), min: { integerValue: '2' }, podIds: A([S('p1')]), fromPoll: S('poll1'), fromOpt: S('o1') })
  ],
  pods: [D('pods', 'p1', { name: S('Tuesday Commander') })],
  people: [
    D('people', 'a', { nick: S('Sam'), pods: A([S('p1')]), res: M({ n1: S('yes') }), bring: M({ n1: S('chips') }), pv: M({ poll1: M({ o1: S('yes') }) }) }),
    D('people', 'b', { nick: S('Dana'), pods: A([S('p1')]), res: M({ n1: S('maybe') }) }),
    D('people', 'c', { nick: S('Lee'), pods: A([S('p1')]), res: M({ n1: S('no') }) }),
    D('people', 'd', { nick: S('Marcus'), pods: A([S('p1')]) }),
    D('people', 'g', { nick: S('Outsider'), pods: A([S('other')]) })
  ]
};
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b, text: async () => JSON.stringify(b) });
  if (url === 'https://oauth2.googleapis.com/token') {
    const p = new URLSearchParams(opts.body);
    const [h, c, sig] = p.get('assertion').split('.');
    const v = createVerify('RSA-SHA256'); v.update(h + '.' + c);
    const claims = JSON.parse(fromB64url(c));
    const good = p.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer' && v.verify(publicKey, fromB64url(sig))
      && claims.iss === 'bot@demo-pods.iam.gserviceaccount.com' && claims.scope === 'https://www.googleapis.com/auth/datastore'
      && claims.aud === 'https://oauth2.googleapis.com/token' && claims.exp - claims.iat === 3600;
    console.log('TOKEN REQUEST signature+claims valid: ' + good);
    return good ? json({ access_token: 'sa-token' }) : json({ error: 'invalid_grant' }, 400);
  }
  if (url.includes('firestore.googleapis.com')) {
    if ((opts.headers || {}).Authorization !== 'Bearer sa-token') return json({ error: 'unauth' }, 403);
    if (!url.includes('/projects/demo-pods/')) return json({ error: 'wrong project' }, 404);
    const col = url.split('/documents/')[1].split('?')[0];
    if (col === 'config/discord') return json(D('config', 'discord', { webhook: S('https://discord.test/hook-from-db'), ping: S('@here') }));
    if (col === 'people' && !url.includes('pageToken')) return json({ documents: docs.people.slice(0, 2), nextPageToken: 'next' });
    if (col === 'people') return json({ documents: docs.people.slice(2) });
    return json({ documents: docs[col] });
  }
  if (url.startsWith('https://discord.test/hook')) { const b = JSON.parse(opts.body); console.log('DISCORD POST to ' + url + ' mentions=' + JSON.stringify(b.allowed_mentions) + ' >>>\n' + b.content + '\n<<<'); return { ok: true, status: 204, text: async () => '' }; }
  throw new Error('unexpected fetch ' + url);
};
