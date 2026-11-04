// Your Firebase settings: Firebase console > Project settings > Your apps > Web app > Config.
// These identify your project. They are not passwords; your database rules are what protect the data.
// The Discord webhook does NOT go here. Organizers paste it into the app, where only invited members can read it.
window.POD_CONFIG = {
  firebase: {
    apiKey: 'PASTE_API_KEY',
    authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
    projectId: 'PASTE_PROJECT_ID',
    appId: 'PASTE_APP_ID'
  },
  // Optional: your Discord helper's address, for example 'https://pod-planner-helper.yourname.workers.dev'.
  // Leave it empty to keep using the webhook in Organizer tools.
  helperUrl: ''
};
