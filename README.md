# Clash of Realms – online version

A 1 vs 1 fighting game. This folder is a complete website with its own game server.
It needs no extra packages: just Node.js 18 or newer.

## Put it online for free (Render)

1. Make a free GitHub account at https://github.com and create a new repository (for example `clash-of-realms`).
2. In the new repository, click **Add file → Upload files** and drag in everything from this folder:
   `server.js`, `package.json`, `README.md` and the `public` folder. Click **Commit changes**.
3. Make a free account at https://render.com and sign in with GitHub.
4. Click **New → Web Service**, pick your `clash-of-realms` repository, and use:
   - Language / Runtime: **Node**
   - Build command: `npm install`
   - Start command: `node server.js`
   - Instance type: **Free**
5. Click **Create Web Service** and wait a few minutes. Render gives you a link like
   `https://clash-of-realms.onrender.com`.
6. Send that link to your friend. You both open it, one clicks **Create a room**,
   the other types the 4-digit code and clicks **Join**.

The free plan puts the server to sleep after about 15 minutes without players.
The first visit after that takes up to a minute to load. That's normal.

## Run it on your own computer (for testing)

Install Node.js from https://nodejs.org, open a terminal in this folder and run:

    node server.js

Then open http://localhost:3000 in two browser windows to play against yourself.
