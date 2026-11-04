/* Preview backend: the claude.ai page stores data with the db capability. */
var BACKEND = {
  config: { discordWebhook: '', discordPing: '' },
  peopleCol: 'rsvps',
  features: { accounts: false, ics: false },
  pageUrl: 'https://claude.ai/artifact/CF5F7JcB5upjgYaZv7coR3',
  afterAuth: function () {},
  auth: null,
  async connect() {
    var claude = window.claude, db = null, user = null;
    try { db = claude ? await claude.use('db') : null; } catch (e) { db = null; }
    try { user = claude ? await claude.use('user') : null; } catch (e) { user = null; }
    if (!db) return { state: 'signedout' };
    var out = { state: 'ok', db: db, uid: null, canEdit: false, canWrite: null, profileName: '' };
    if (user) {
      try {
        out.uid = await user.id();
        var m = await user.me(); out.profileName = m.name || '';
        out.canWrite = await user.can('data.write');
        out.canEdit = await user.canEdit();
      } catch (e) {}
    }
    return out;
  },
  saveFile: function () { return Promise.reject(new Error('unsupported')); }
};
