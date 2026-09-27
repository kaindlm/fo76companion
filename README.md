# FO76 Companion

A private Fallout 76 companion site for you and a friend. Everything is set up in a web browser. You never install anything.

## What's in it

**Builds.** Paste a Nukes & Dragons or FalloutBuilds planner link, a Reddit post or guide link, or a YouTube link (it reads the video description and follows any planner link in it). The build becomes an editable checklist: S.P.E.C.I.A.L., perk cards, legendary perks, mutations, weapons with legendary effects, armor, power armor, and consumables. Every row has a dropdown to swap it (for example, one armor set for another). Tick what you have. Weapons, armor, mutations, and plans show market prices. Weapons also show what the legendary mod boxes would cost to craft that roll yourself.

**Inventory.** Anything you tick goes into your personal inventory, so it counts as owned in every build. Swapping a row or deleting a build never erases it.

**Game changes in your builds.** When a game update buffs, nerfs, fixes, or removes something in one of your builds, that row gets a colored note (red for nerfs, green for buffs). Opening a build with changes you haven't seen yet pops up a list; tap "Got it" and it won't pop up again for those changes.

**Checklist.** Legendary fish, all 64 fish, magazines, bobbleheads, collectibles, every tradable plan and recipe, and your own tasks, with links to the wiki and Ghoul Earth.

**Challenges.** Today's daily challenges, this week's weeklies with reset countdowns, events happening now and coming up, and the current season. The **Patch log** view lists every logged game change with a link to its source.

**Market.** Xbox trade prices from r/Market76, plus the full item database from the game files. Prices come from the last 30 days. Items nobody has posted lately show their most recent prices, marked "Older" with how long ago they were seen.

## How your data stays safe

- You and your friend each have your own builds, inventory, and ticks. Neither of you can see or change the other's.
- Every change is saved on your device first and stays queued until the server confirms it, so nothing is lost if you're offline, even if you close the app.
- If you edit the same build on your phone and your computer, both edits are kept.

## What you need

- A computer with Chrome, Edge, Firefox, or Safari. Setup needs a computer because it involves dragging folders into a web page. After setup, everything works on your phone.
- About an hour.
- The file `fo76-companion.zip`.
- A few dollars for the Anthropic account (see Costs).

---

## Step 1: Unzip the files

1. Find `fo76-companion.zip` on your computer.
2. **Windows:** right-click it, choose **Extract All**, then click **Extract**.
   **Mac:** double-click it.
3. You now have a folder named `fo76-companion`. Open it. Inside you should see: `.github`, `data`, `docs`, `scraper`, `worker`, and `README.md`.
4. **Mac only:** the `.github` folder is hidden. With the folder open in Finder, press **Cmd + Shift + .** (period). It appears, slightly faded. You need to see it for the next step.

## Step 2: Put the files on GitHub

GitHub hosts the site for free and runs the automatic jobs that update prices, challenges, and patch notes.

1. Go to **github.com** and click **Sign up**. Make a free account and verify your email.
2. Click the **+** in the top right corner, then **New repository**.
3. Fill in:
   - **Repository name:** `fo76`
   - Select **Public**. (Free GitHub Pages needs a public repository. It only holds game data and code. Your builds and ticks live in your private database, not here.)
   - Leave **Add a README file** unchecked. The repository must start empty.
4. Click **Create repository**.
5. On the next page, find the line "…or create a new file or **uploading an existing file**" and click **uploading an existing file**.
6. Go back to the open `fo76-companion` folder on your computer. Select everything inside it: **Ctrl + A** on Windows, **Cmd + A** on Mac. That selects `.github`, `data`, `docs`, `scraper`, `worker`, and `README.md`.
7. **Drag the selection onto the GitHub page**, into the box that says "Drag files here."
   - **Drag. Do not click "choose your files."** The "choose your files" button flattens every file into one folder and skips `.github`, which breaks the site. Dragging keeps the folders.
8. Wait for the upload list to finish. Scroll through it: the files should show folder paths, like `.github/workflows/daily.yml`, `docs/js/core.js`, and `worker/worker.js`.
9. At the bottom, in the first box under **Commit changes**, type `First upload`. Click the green **Commit changes** button.
10. **Check it worked.** You're now on your repository's main page. The top of the file list should show exactly these six things: `.github`, `data`, `docs`, `scraper`, `worker`, `README.md`.
    - If loose files like `index.html` or `core.js` sit at the top level, the upload was flattened. Delete the repository (**Settings** tab, scroll to the bottom, **Delete this repository**) and redo this step, dragging instead of choosing files.
    - If everything is there except `.github`, see "If .github is missing" at the end of this step.
11. Click `.github`, then `workflows`. You should see `challenges.yml` and `daily.yml`.

**If .github is missing** (the rest uploaded fine):
1. On your repository's main page, click **Add file**, then **Create new file**.
2. In the name box, type exactly: `.github/workflows/daily.yml`. Each `/` you type turns the text before it into a folder.
3. On your computer, open `fo76-companion/.github/workflows/daily.yml` in Notepad (Windows) or TextEdit (Mac). Select all, copy, and paste into the big box on GitHub.
4. Click **Commit changes**, then **Commit changes** again in the pop-up.
5. Repeat for `.github/workflows/challenges.yml`.

## Step 3: Get an Anthropic API key (Claude)

This powers the price reading, challenge lists, patch notes, and build imports.

1. Go to **console.anthropic.com** and sign up.
2. Open **Billing** (under Settings) and buy credits. $5 is plenty to start.
3. **Set a spend limit.** Look under Settings for **Limits** (or the spend limit in Billing) and set a monthly limit, for example $10. Nothing can cost more than this.
4. Open **API Keys** and click **Create Key**. Name it `fo76-github`. Copy the key and paste it somewhere safe for a minute; it's only shown once.
5. Create a second key named `fo76-cloudflare` and copy it too. (One key works for both places, but two let you see which part is spending what.)

## Step 4: Add your key to GitHub

1. On github.com, open your `fo76` repository and click the **Settings** tab (top of the page).
2. In the left menu, click **Secrets and variables**, then **Actions**.
3. Click the green **New repository secret** button.
4. **Name:** `ANTHROPIC_API_KEY`. **Secret:** paste your `fo76-github` key. Click **Add secret**.

That's the only secret you need. Skip the Reddit secrets; Step 10 covers them if you ever want them.

## Step 5: Turn on the website

1. Still in **Settings**, click **Pages** in the left menu.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Under **Branch**, pick `main` in the first dropdown and `/docs` in the second. Click **Save**.
4. Wait 2 to 5 minutes, then refresh the page. A box at the top says "Your site is live at…" with an address like `https://yourname.github.io/fo76/`. Copy it.
5. Open that address. The site should load with the Builds, Checklist, Challenges, and Market tabs. The Market tab will be empty until Step 6 runs.

## Step 6: Run the automatic jobs the first time

1. On your repository, click the **Actions** tab.
2. If you see a message about workflows, click **I understand my workflows, go ahead and enable them**.
3. In the left list, click **Price update**. On the right, click **Run workflow**, then the green **Run workflow** button.
4. Click **Challenges, events, and patch notes** in the left list and do the same.
5. Each takes a few minutes. A green check means it worked; a red X means it didn't.

**Check the price job:**
1. Click the finished **Price update** run.
2. Click **update** on the left.
3. Click the **Fetch and parse posts** step to expand it.
4. You should see `No Reddit API keys set, using RSS feed.` and a line like `Fetched 180 posts, 41 Xbox.`
5. If it failed with **403** or **429** in the message, Reddit is blocking GitHub's servers. Copy the message and send it over; it can be worked around.

From now on, the jobs run on their own: prices every 3 hours, and challenges and patch notes every afternoon (Eastern).

## Step 7: Create the database (Cloudflare)

Cloudflare's free tier holds your builds and ticks and does build imports.

1. Go to **dash.cloudflare.com** and sign up for a free account. Verify your email.
2. In the left sidebar, open **Storage & databases**, then **D1 SQL database**.
3. Click **Create database**. **Name:** `fo76`. Leave the rest as is and click **Create**.
4. Open the new `fo76` database and click the **Console** tab.
5. Get the database setup text: in a new browser tab, open your GitHub repository, click the `worker` folder, then `schema.sql`. Click the **Copy raw file** button (two overlapping squares, at the top right of the file).
6. Back in Cloudflare's Console, paste it into the box and click **Execute**.
7. It should report success. If it complains about running several statements at once, paste and execute each `CREATE …;` block separately. There are five.

## Step 8: Create the server (Cloudflare Worker)

1. In the left sidebar, click **Workers & Pages**.
2. Click **Create** (or **Create application**), then **Start with Hello World!** (or the **Hello World** template).
3. **Name:** `fo76`. Click **Deploy**.
   - The first time, Cloudflare asks you to pick a `workers.dev` subdomain. Pick anything, like your username.
4. Click **Edit code**.
5. Get the server code: in your GitHub tab, open the `worker` folder, then `worker.js`, and click **Copy raw file**.
6. Back in Cloudflare's code editor, click inside the code, select all (**Ctrl + A** or **Cmd + A**), delete it, and paste.
7. Click **Deploy** (top right). Confirm if asked.
8. Go back to the Worker's page (click `fo76` in the breadcrumb at the top). Note the address, something like `https://fo76.yourname.workers.dev`. Copy it.

## Step 9: Connect the server to the database and your key

On the `fo76` Worker's page, click the **Settings** tab.

**Connect the database:**
1. Find **Bindings** and click **Add** (or **Add binding**).
2. Choose **D1 database**.
3. **Variable name:** `DB` (capital letters, exactly). **D1 database:** `fo76`.
4. Click **Add binding** or **Deploy**.

**Add the secrets and setting:** find **Variables and Secrets** and click **Add** once for each of these:

| Type | Name | Value |
|---|---|---|
| Secret | `ANTHROPIC_API_KEY` | your `fo76-cloudflare` key |
| Secret | `GROUP_KEY` | a long passphrase you make up, like `appalachia-rust-mothman-4471`. You'll give this to your friend. |
| Text | `ALLOWED_ORIGIN` | your site's address **without** the `/fo76/` part, like `https://yourname.github.io` |

Click **Deploy** (or **Save and deploy**) after adding them.

## Step 10: Connect your phone and your friend

**You:**
1. Open your site (the address from Step 5) on your phone.
2. Tap **Not synced** in the top right corner.
3. **Server address:** the Worker address from Step 8. **Group key:** your passphrase. **Your name:** your first name.
4. Tap **Save**. It should say "Connected" and reload. The top corner now says **Synced**.
5. Add it to your home screen:
   - **iPhone (Safari):** tap the Share button (square with an up arrow), then **Add to Home Screen**.
   - **Android (Chrome):** tap the three-dot menu, then **Add to Home screen** (or **Install app**).
6. Do steps 1 to 4 on any other device you use, with **the same name**.

**Your friend:**
1. Send them the site address and the group key.
2. They do the same steps with **their own name**. Their builds, inventory, and ticks are separate from yours.

## Step 11 (optional, once): Fill in older prices

The regular price job only sees recent posts. This one-time job searches Reddit item by item to add up to a year of older Xbox prices, which mostly helps rare items that aren't posted often. Do it after Step 6 has run once.

1. On your repository, click the **Actions** tab.
2. In the left list, click **Backfill price history (run once)**.
3. Click **Run workflow** on the right. A small form opens:
   - **mode:** pick one.
     - `quick`: weapons, armor sets, power armor sets, legendary mods, and serums. About 1 to 2 hours. **Start here.**
     - `full`: also every plan and piece of apparel. About 3 runs.
     - `deep`: the quick list again, but each item searched 7 different ways (different sort orders, plus "leaders," "caps," and "XB"). Each way returns a different slice of the year, so common items reach back months instead of weeks. About 2 to 3 runs. Run `quick` first; deep reuses its progress and only runs the extra searches.
   - **max_posts:** the most posts sent to Claude this run. This is your spending cap. `3000` is roughly $1.50.
   - **extra_terms:** optional extra searches, separated by commas, like `Beta Wave Tuner, Fasnacht Crown`.
4. Click the green **Run workflow** button.
5. When it finishes, click the run, then **backfill**, then **Search and read older posts**. The end of the log shows how many posts were found, the estimated cost, and how many price records were added.

**If it says "Search time limit reached" or "saved for the next run":** run it again the same way. It continues where it stopped and doesn't search or pay for anything twice.

**If it says "Five searches in a row failed":** Reddit is slowing it down. Wait a few hours and run it again; it picks up where it stopped.

While it's running, the regular price updates wait their turn and run right after. To start over from scratch, delete the file `data/backfill_state.json` in your repository (open it, click the three-dot menu at the top right of the file, then **Delete file**, then **Commit changes**).

## Optional: Reddit API

The app works without this. It reads Reddit's public feed instead. Reddit now approves API access by hand, and requests can take weeks or go unanswered.

1. Log into Reddit. Older, active accounts have better odds.
2. Go to `https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164`.
3. Use this as the description:
   > Personal, non-commercial project. A script reads new posts from r/Market76 to track Fallout 76 trade prices for me and one friend. Read-only, a few requests per day, no posting, no ads, no data resale. Built with a "script" type app using OAuth client credentials.
4. Submit and wait for an email.

**Only if approved:**
1. Go to `https://www.reddit.com/prefs/apps` and click **create another app** (or **create app**).
2. **name:** `fo76-price-tracker`. Select **script**. Leave **description** and **about url** blank. **redirect uri:** `http://localhost:8080`. Click **create app**.
3. Copy the **client ID** (the short string right under the app name) and the **secret**.
4. In your GitHub repository: **Settings**, then **Secrets and variables**, then **Actions**, then **New repository secret**. Add three secrets:
   - `REDDIT_CLIENT_ID`: the client ID
   - `REDDIT_CLIENT_SECRET`: the secret
   - `REDDIT_USER_AGENT`: `fo76-tracker/0.1 by u/YourRedditName`
5. Run **Price update** from the Actions tab. The log should no longer say "using RSS feed." No code changes needed.

---

## Costs (estimate)

| Piece | Monthly |
|---|---|
| Market prices (Claude Haiku, half-price batch processing, checked every 3 hours; each post is read once, so checking often doesn't add cost) | about $1–2 |
| Challenges and events, twice a day | under $0.50 |
| Patch notes, a few patches a month | under $0.50 |
| Build imports, about 5–10 cents each (20 a month) | about $1–2 |
| One-time backfill of older prices (Step 11), set by your spending cap: quick about $1–2, full about $3–6, deep about $2–5 | about $1.50 per 3,000 posts, once |
| Cloudflare server and database (free tier) | $0 |
| GitHub hosting and scheduled jobs | $0 |
| **Total** | **about $2–5** |

These are estimates from Anthropic's published rates and typical post volume. Your real number shows in the Anthropic console after the first week, and the spend limit from Step 3 caps it.

## Known limits

- **Older prices:** neither Reddit's feed nor its API lists more than recent posts, so the backfill (Step 11) searches item by item instead, always within the last year. Each search is capped by Reddit, so with quick mode common items only reach back weeks while rare items can reach back the full year. Deep mode searches each item 7 ways to reach further back; how far depends on how busy the item is. After launch, the tracker builds its own year of history going forward.
- **Reddit feed vs. API:** the public feed has no post flair, so a post counts as Xbox if its title says so, or, when the title names no platform, if its first lines do. It shows about 100 posts at a time, which is why prices are checked every 3 hours. If Reddit blocks GitHub's servers, the price job fails with a 403 or 429 message.
- **Videos:** YouTube imports read the description and any planner link in it. For videos without one, paste the transcript (YouTube's "Show transcript").
- **Challenges** come from fan sites (fo76challenges.com, Index76) and event calendars (FalloutBuilds, Nuka Knights) that transcribe Bethesda's Community Calendar, which Bethesda posts as an image. If a source is late, the tab keeps the last good list and says so.
- **Patch notes** come from the Fallout wiki, which usually posts Bethesda's notes within a day or two of a patch. Buff and nerf labels are Claude's reading of the notes; check the source link for anything important. Added and removed items are also caught directly from the game files. To add another source, put its address in a GitHub secret named `PATCH_SOURCE_URLS`.
- **Build imports** are Claude's reading of the source. Check the result once; every row can be fixed with the dropdowns.
- **Market prices** are asking and offering prices, not confirmed sales. Medians with 3 or more posts are the reliable ones. Prices marked "Older" can be out of date after a patch.
- **Perk cards:** 269 cards from FalloutBuilds' perk database as of September 2026. After a big perk rework, `docs/data/perks.json` needs updating.
- **Ghoul Earth** links open the map's home page; the site doesn't offer links to specific items.
- **Look:** blue and yellow with an original civil-defense shelter mark (a public-domain US government symbol). It doesn't use Bethesda's logos or characters. Ticking something fires confetti, skipped if your phone's "reduce motion" setting is on.

## For a bigger app later

Everything the site shows comes from plain data files in `docs/data/` (catalog, effects, perks, prices, challenges, changes) and the Worker's API, so a future phone app can use both directly.
