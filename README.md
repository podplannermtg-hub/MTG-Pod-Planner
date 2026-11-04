# Pod Planner setup

Everything runs on free tiers: Firebase for accounts and the database, GitHub Pages for hosting, GitHub Actions for daily reminders, and an optional Discord webhook. Setup takes about 45 minutes.

Files:

| File | What it is | Goes on GitHub? |
|---|---|---|
| `index.html` | The page | Yes |
| `app.js` | The app code. You shouldn't need to edit it. | Yes |
| `config.js` | Your Firebase settings. The only file you edit. | Yes |
| `reminders/remind.mjs` and `.github/workflows/reminders.yml` | The daily Discord reminder job | Yes |
| `.gitignore` | Keeps keys and the rules file out of GitHub if you use git | Yes |
| `firestore.rules` | Database permissions, including the members list. Contains your email. | **No.** Paste it into Firebase only. |

## Can strangers cost me money or get in?

**Money:** no, as long as the Firebase project stays on the free **Spark** plan, which is the default and needs no card. With no billing account attached, Firebase has no way to charge you. If a free daily limit is ever reached, that part pauses until the next day.

**Getting in:** while the board is invite only, the database lets only people on your members list see or change anything. Anyone else who signs in can only leave a "please let me in" request. The database itself enforces this, not just the screen, so it holds even against someone who copies your settings.

## What it does

- **Accounts** with Google, or email and password with a confirmed address. Answers follow people to any device.
- **Organizer tools**, which only you and the organizers you pick can see:
  - **Who can join:** *Invite only* (the default) or *Anyone who signs in*. See "Opening it to the public" below.
  - **Join requests** you approve in one tap, or add people by email. Removing someone takes effect immediately.
  - **Block** anyone on the board. It shuts them out immediately, in either mode.
  - **Discord announcements:** paste the webhook here once. It's stored in the database, where only invited members can read it, not in the page.
- **Game nights** for one or more pods, date polls, weekly repeats, edits, seat counts, a bringing list, calendar links, and Game on messages.
- **Daily reminders** to Discord.

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com and sign in with a Google account.
2. Create a project. Name it anything, like `pod-planner`. You can turn Google Analytics off.
3. In the project, add a **Web app** (the `</>` icon). Skip hosting. Firebase shows a block of settings that includes `apiKey`, `authDomain`, `projectId` and `appId`. Keep that page open.

Don't upgrade to the Blaze plan. Nothing here needs it.

## 2. Turn on sign-in

1. Open **Authentication** and click **Get started**.
2. On the **Sign-in method** tab, enable **Google**. Pick a support email when it asks, and save.
3. Enable **Email/Password**. Turn on the first switch only and leave **Email link (passwordless sign-in)** off, because the free plan sends only 5 of those emails a day.
4. If **Anonymous** is turned on from an earlier version, turn it off.

## 3. Create the database and rules

1. Open **Firestore Database**, click **Create database**, pick a location near you, and start in **production mode**.
2. Open `firestore.rules` in a text editor. Near the top, replace `PASTE_YOUR_EMAIL` with the email you'll sign in with, in lowercase. That makes you the owner. The owner is always an organizer and can't be blocked.
3. In Firestore, open the **Rules** tab, replace everything with the edited file, and click **Publish**.

Check the rules before inviting anyone. The Rules tab has a **Rules playground**:
- Simulate a `get` on `/pods/test` with **Authenticated** on, a made-up email, and `email_verified` set to true. It should be **denied**.
- Do the same with your own email. It should be **allowed**.

## 4. Paste your settings into config.js

Open `config.js` and replace the four `PASTE_...` values with the ones from step 1. These identify your project and aren't passwords. Every Firebase website has them in its page source, and step 3's rules are what protect the data. The page also carries a security policy that refuses to run code from anywhere except your site and Google's Firebase servers.

## 5. Put it online (GitHub Pages)

1. Create a free account at https://github.com and make a new **public** repository, for example `pod-planner`.
2. Upload everything **except** `firestore.rules`: `index.html`, `app.js`, `config.js`, `.gitignore`, the `reminders` folder and the `.github` folder. If your browser hides the `.github` folder or `.gitignore`, create them by hand: choose **Add file**, then **Create new file**, type the name (for example `.github/workflows/reminders.yml`), and paste in the contents.
3. Open the repository **Settings**, then **Pages**. Choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After a minute or two the page is live at `https://YOUR-USERNAME.github.io/pod-planner/`.
5. In Firebase, open **Authentication**, then **Settings**, then **Authorized domains**, and add `YOUR-USERNAME.github.io`. Google sign-in won't work until you do.

## 6. Let your friends in

1. Open the page and sign in yourself first. **Organizer tools** appears at the bottom.
2. Under **Discord announcements**, paste your webhook. In Discord: Edit Channel, then Integrations, then Webhooks, then New Webhook, then Copy Webhook URL. Choose a ping if you want one, and save.
3. Send your friends the link. They sign in and tap **Ask to join**, and you tap **Approve**. Approving requests is safer than typing emails, because it uses the exact address they signed in with. You can also add emails directly.
4. **Make organizer** lets someone else approve people, edit or cancel any night, and change these settings.

On a phone, people can use the browser's **Add to Home Screen** option so it opens like an app. If the Google window won't open from a home-screen icon on an iPhone, use email and password there instead.

## 7. Turn on the daily reminders (optional)

The reminder job needs a key that can **read** the database and nothing else.

1. Open https://console.cloud.google.com and pick your Firebase project at the top. It's the same project.
2. Go to **IAM & Admin**, then **Service accounts**, then **Create service account**. Name it `reminders`. When it asks for a role, choose **Cloud Datastore Viewer**, which is read-only, and click **Done**.
3. Open the new account, go to **Keys**, then **Add key**, then **Create new key**, then **JSON**. A file downloads.
4. In your GitHub repository, go to **Settings**, then **Secrets and variables**, then **Actions**, then **New repository secret**. Name it `FIREBASE_SERVICE_ACCOUNT` and paste the **entire** contents of the file. Then **delete the downloaded file** from your computer.
5. Open `.github/workflows/reminders.yml` in the repository, click the pencil icon, replace `PASTE_PAGE_URL` with your page address, set `TIMEZONE`, and commit.
6. Open the **Actions** tab, choose **Game night reminders**, click **Run workflow**, and check Discord.

The job uses the Discord webhook you saved in the app. A GitHub secret named `DISCORD_WEBHOOK_URL` overrides it, if you ever want reminders in a different channel. To also remind people on the day of the game, set `REMIND_DAYS` to `'1,0'`. GitHub pauses scheduled jobs after 60 days with no activity in the repository. If reminders stop, open the Actions tab and turn the workflow back on.

## Security checklist (all free)

These are already built in:
- The database checks every write: who is asking, the exact allowed fields, length and size limits, valid dates, and that the Discord setting really is a Discord webhook. Nobody can stuff in junk or huge data to burn your free limits.
- Join requests can only describe the person sending them, one per account.
- The page refuses to run code from anywhere except your site and Firebase. It never inserts what people type as page code, so names and notes can't run code.
- The Discord webhook isn't in the page. Only invited members and organizers can read it, and only organizers can change it. Messages are capped below Discord's limit, and pings only happen if you turned one on.
- The reminder workflow runs with read-only GitHub permissions and a read-only database key.

Five minutes in the Firebase console:
- [ ] **Authentication, then Settings, then User actions:** make sure **Email enumeration protection** is on, so the sign-in screen won't confirm whether an email has an account. It's on by default for new projects.
- [ ] **Authentication, then Settings, then Authorized domains:** once everything works, remove `localhost`. Keep your `github.io` address and the two Firebase addresses.
- [ ] **Stay on the Spark plan.** Don't add a billing account unless you're deliberately going public (see below).
- [ ] Optional: in the Google Cloud console under **APIs & Services, then Credentials**, open the Browser key and add a **website restriction** for your `github.io` address and `YOUR-PROJECT.firebaseapp.com`. Then test sign-in. If anything breaks, remove the restriction.

If something leaks:
- **Discord webhook:** delete it in Discord, make a new one, and paste it into Organizer tools.
- **Reminder key:** in the Google Cloud console, open the `reminders` service account, delete the key under **Keys**, and create a new one.
- **Unwanted person:** use **Block** in Organizer tools. It takes effect immediately.

## Opening it to the public

Switching **Who can join** to *Anyone who signs in* lets anyone with a confirmed email use the board right away. You'll be asked to tap twice. Some things to know:

- **It's still one shared board.** Everyone sees the same pods and nights. That works for a store or club running public nights. A product where many separate groups each get their own private space, and that you could charge for, needs those spaces built first.
- **Free limits become the ceiling.** Spark allows 50,000 reads, 20,000 writes and 1,000 confirmation emails a day. Real public traffic will hit those, and things pause until the next day rather than cost money. Growing past that means the Blaze plan, plus a budget alert and **App Check** (which blocks requests that don't come from your page).
- **Public users don't see the Discord webhook.** Only invited people and organizers can read it, so posts made by public users show the copy-and-paste message instead.
- **Collecting public data has obligations.** Before opening it to strangers, add a short privacy policy saying what you store: email, display name and answers.
- Switching back to *Invite only* takes effect immediately and keeps your invite list.

## Things to know

- **No push notifications to phones.** The Discord messages and daily reminders are the notifications.
- **Upgrading from an earlier version.** Upload the new `app.js` and `config.js`, re-enter your settings in `config.js`, publish the new rules, and save the Discord webhook in Organizer tools. Remove it from anywhere else it was stored.
