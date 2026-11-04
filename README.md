
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
- **Pods** that anyone can join, or that are invite only. Members invite people, and each pod chooses whether its short nights are advertised to @Open Seats.
- **Game nights** for one or more pods, date polls, edits, seat counts, a bringing list, calendar links, and Game on messages.
- **Recurring games** every week, every 2 weeks, or monthly on a weekday such as "the 1st Friday". They can end never, after a number of games, or on a date. Each recurring game is one card with its upcoming dates; people answer each date separately, and the host can skip a date, edit the series or end it. Calendar links add it as a repeating event.
- **Finding games:** search by name, place or host, filter by pod or format, and see upcoming games grouped into the next 7 days and later.
- **Made for phones:** a tab bar along the bottom (Games, Pods, Me, and Organizer for organizers) with counts for games you haven't answered and pod invites. Games that need your answer come first, cards stay compact until you tap Details, and Call a night opens as a full-screen sheet. On a computer the tabs sit along the top, cards show everything, games sit two to a row, and Call a night is a centered window.
- **Home-screen app:** Add to Home Screen gives a proper icon and a full-screen app window.
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

On a phone, people can use the browser's **Add to Home Screen** option (on iPhone: the Share button, then Add to Home Screen) so it opens like an app, with the Pod Planner icon. If the Google window won't open from a home-screen icon on an iPhone, use email and password there instead.

## 7. Turn on the daily reminders (optional)

The reminder job needs a key that can **read** the database and nothing else.

1. Open https://console.cloud.google.com and pick your Firebase project at the top. It's the same project.
2. Go to **IAM & Admin**, then **Service accounts**, then **Create service account**. Name it `reminders`. When it asks for a role, choose **Cloud Datastore Viewer**, which is read-only, and click **Done**.
3. Open the new account, go to **Keys**, then **Add key**, then **Create new key**, then **JSON**. A file downloads.
4. In your GitHub repository, go to **Settings**, then **Secrets and variables**, then **Actions**, then **New repository secret**. Name it `FIREBASE_SERVICE_ACCOUNT` and paste the **entire** contents of the file. Then **delete the downloaded file** from your computer.
5. Open `.github/workflows/reminders.yml` in the repository, click the pencil icon, replace `PASTE_PAGE_URL` with your page address, set `TIMEZONE`, and commit.
6. Open the **Actions** tab, choose **Game night reminders**, click **Run workflow**, and check Discord.

The job uses the Discord webhook you saved in the app. A GitHub secret named `DISCORD_WEBHOOK_URL` overrides it, if you ever want reminders in a different channel. To also remind people on the day of the game, set `REMIND_DAYS` to `'1,0'`. GitHub pauses scheduled jobs after 60 days with no activity in the repository. If reminders stop, open the Actions tab and turn the workflow back on.

## 9. Discord roles and pod pings (optional)

This adds a small free helper on Cloudflare that:
- creates a Discord role for every pod, plus an **Open Seats** role;
- gives people their pod roles automatically when they join pods in the app, and takes them away when they leave;
- pings only the pods involved when a night is called, changed or locked in;
- calls **@Open Seats** the day before when a night is short, but only for pods that allow it;
- posts "Game on" and reminders for full nights silently.

Players tap **Connect Discord** once in their profile. That also adds them to your server if they aren't in it yet.

Setup takes about 30 minutes. Keep a notepad open: you'll copy values between four sites.

### 9a. Publish the updated database rules
Open `firestore.rules`, put your email back in on the `PASTE_YOUR_EMAIL` line, paste it into **Firestore → Rules**, and click **Publish**.

### 9b. A key the helper can write with
1. Open https://console.cloud.google.com and pick your Firebase project at the top.
2. Go to **IAM & Admin → Service accounts → Create service account**. Name it `discord-helper`, give it the role **Cloud Datastore User**, and click **Done**.
3. Open it, then go to **Keys → Add key → Create new key → JSON**. Keep the file for step 9d, then delete it.

### 9c. A Discord application and bot
1. Go to https://discord.com/developers/applications and click **New Application**. Name it `Pod Planner`.
2. Under **OAuth2**, copy the **Client ID**, then click **Reset Secret** and copy the **Client Secret**.
3. Under **Bot**, click **Reset Token** and copy the **token**. No privileged intents are needed.
4. Add the bot to your server by opening this link, with your Client ID in place of `CLIENT_ID`:
   `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot&permissions=268569601`
   This grants Manage Roles, View Channels, Send Messages, Mention roles, and Create Invite.
5. In Discord, turn on **User Settings → Advanced → Developer Mode**. Then right-click your server and choose **Copy Server ID**, and right-click your game-nights channel and choose **Copy Channel ID**.
6. Optional but recommended: go to **Server Settings → Overview → Default Notification Settings** and choose **Only @mentions**. Then only the pinged pods get notified.

### 9d. The helper on Cloudflare
1. Create a free account at https://dash.cloudflare.com. No card needed.
2. Go to **Workers & Pages → Create → Create Worker**. Name it `pod-planner-helper` and click **Deploy**.
3. Click **Edit code**, replace everything with the contents of `helper/worker.js`, and click **Deploy**.
4. Go to **Settings → Variables and Secrets** and add each of these. Use type **Secret** for the four marked secret.

   | Name | Value |
   |---|---|
   | `APP_URL` | your page address, for example `https://podplannermtg-hub.github.io/MTG-Pod-Planner/` |
   | `OWNER_EMAIL` | the email you put in `firestore.rules` |
   | `DISCORD_CLIENT_ID` | from 9c step 2 |
   | `DISCORD_CLIENT_SECRET` (secret) | from 9c step 2 |
   | `DISCORD_BOT_TOKEN` (secret) | from 9c step 3 |
   | `DISCORD_GUILD_ID` | the Server ID from 9c step 5 |
   | `DISCORD_CHANNEL_ID` | the Channel ID from 9c step 5 |
   | `FIREBASE_SERVICE_ACCOUNT` (secret) | the whole contents of the JSON file from 9b |
   | `STATE_SECRET` (secret) | any random text of at least 32 characters, for example from a password generator |
   | `TIMEZONE` | for example `America/New_York` |

5. Go to **Settings → Triggers → Cron Triggers → Add** and enter `0 14 * * *`. That runs the daily reminders and role check at about 9 to 10 AM Eastern.
6. Copy your Worker's address. It looks like `https://pod-planner-helper.YOURNAME.workers.dev`.

### 9e. Connect the pieces
1. Back in the Discord developer portal, under **OAuth2 → Redirects**, add your Worker address followed by `/link/callback`, then save. For example: `https://pod-planner-helper.YOURNAME.workers.dev/link/callback`.
2. In your GitHub repository, edit `config.js` and add a `helperUrl` line after the `firebase` block, so the end of the file looks like this:
   ```js
       appId: '...'
     },
     helperUrl: 'https://pod-planner-helper.YOURNAME.workers.dev'
   };
   ```

### 9f. Try it
1. Open the app, tap your name, and tap **Connect Discord**. Approve it on Discord's screen. You'll come back to the app with a "Discord connected" message.
2. In Discord, your pod roles should appear within a few seconds. Opening `https://pod-planner-helper.YOURNAME.workers.dev` in a browser should say "Pod Planner helper is running."
3. Call a test night for one pod. Only that pod's role gets pinged.

Once the helper is running, the GitHub reminder job sees that and stops sending its own reminders, so nobody gets two. With the helper on, the webhook setting in Organizer tools is no longer used.

**Pods in the app:**
- **Who can join:** *Anyone* means people tap to join. *Invite only* means members invite people in, and the invitee taps **Join pod**. Everyone can still see an invite-only pod's nights and answer them.
- **@Open Seats:** whether that pod's short nights get advertised to @Open Seats. Nights show "Open table" or "Pod only".

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
