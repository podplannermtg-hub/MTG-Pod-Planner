# Pod Planner

A small, homemade web app for organizing Magic: The Gathering game nights across a few friend groups.

**This is a personal project.** Right now it's run for a group of friends and is invite-only. It isn't a public service: there's no sign-up page for strangers and nothing to buy.

## Why it exists

We play in several small groups, or "pods": a Tuesday Commander crew, people who draft at the local shop, and so on. Planning used to mean group chats full of "who's in?" messages that got buried. Pod Planner replaces that with one shared board:

- **Call a night once.** Pick the date and the pods, and everyone in those pods sees it.
- **Answer in one tap.** I'm in, Maybe, or Can't. Each game shows its seats filling up and says **Game on** when there are enough players.
- **Not sure of the date?** Post a quick poll with a few dates and lock in the winner.
- **Where and how far:** add an address and people can tap it for directions. Set your area (a city or ZIP, never your street) and each game shows roughly how far away it is. Addresses stay in the app, not Discord.
- **Decks:** keep your decklists on your profile (Moxfield, Archidekt, TappedOut or any link), pick which ones you're bringing to each game, and your commander's art shows in your seat. Hosts can set a bracket limit; decks above it are flagged in red, not blocked.
- **Recurring games**, like every other Thursday or the first Friday of the month, show as one card with their upcoming dates.
- **Discord** gets the announcements and a reminder the day before, so nobody has to remember to check.

It's built to work well on a phone and can be added to your home screen like an app.

## How it's built

It's kept simple and free to run:

- one web page hosted on GitHub Pages
- Firebase for sign-in and the shared board
- an optional Discord bot for pod roles and pings

Only people on the invite list can see or change anything. The database enforces that, not just the page.

## Running your own

You're welcome to set up a copy for your own playgroup. [SETUP.md](SETUP.md) walks through it step by step, and everything fits within free plans.

## Not affiliated with Wizards of the Coast

Pod Planner is unofficial fan content. It is not approved or endorsed by Wizards of the Coast. Magic: The Gathering is a trademark of Wizards of the Coast LLC.
