# FTX Group Boards

Real accountability boards for **Athena, Maverick, Hyrox, Hybrid** — who's logging, who's
slipping, who to chase. A static site (`site/`) that reads JSON, plus a nightly crawler
(`scripts/crawl.mjs`) that refreshes that JSON from Exercise.com.

**It works the moment you deploy** — real data is already baked into `site/data/*.json`,
so the boards render before the crawler ever runs. The crawler just keeps them current.

---

## One-time setup (~10 minutes)

1. **Create the repo** under the `FTX-Hybrid` org (private recommended) and push these files.

2. **Add your Exercise.com login as secrets**
   Repo → *Settings → Secrets and variables → Actions → New repository secret*:
   - `EXERCISE_EMAIL` = your Exercise.com login email
   - `EXERCISE_PASSWORD` = your Exercise.com password
   These are encrypted. They are never printed and never leave GitHub.

3. **Turn on Pages**
   Repo → *Settings → Pages → Build and deployment → Source = GitHub Actions*.

4. **Run it once**
   Repo → *Actions → "Nightly FTX board refresh" → Run workflow*.
   When it finishes, your boards are live at the Pages URL it prints
   (e.g. `https://ftx-hybrid.github.io/ftx-boards/`).

After that it refreshes **every night at 7:30 PM Central** on its own.

### Optional: your own domain
Point a CNAME (e.g. `boards.ftxhybrid.com`) at the Pages URL and set it under
*Settings → Pages → Custom domain*.

---

## What's real vs. what's next

- **Live now (100% real):** every athlete, workout count, training time, career total,
  and the chase list — pulled from your account's "Logged Workout History" report.
- **Coming next — per-workout results** (times, loads, splits, full history under each
  athlete): needs one more thing. The report gives *counts*, not the actual logged
  numbers. To wire those, capture the workout request from your browser DevTools
  (Network tab → open a completed workout → copy the request), and the crawler can pull
  per-workout detail the same way it pulls career totals. Until then, athlete rows show
  "wire in here" instead of fake numbers.

---

## Two things to validate on the first run

1. **Login.** `scripts/crawl.mjs` logs in with your secrets. If Exercise.com blocks the
   automated login (bot check / MFA), the run will fail at that step — tune the login
   selectors near the top of `main()`, or use the fallback below.

2. **Report load.** The crawler navigates each group's report URL and scrapes the table.
   Group IDs are in `GROUPS` at the top of the script (Athena 16830, Maverick 16847,
   Hyrox 15342, Hybrid 15308). If a group returns empty, open that URL in a browser to
   confirm the id and date range.

### Fallback if the automated login won't cooperate
Export the "Logged Workout History" report to CSV per group from Exercise.com, drop the
CSVs in `/incoming/`, and swap the crawler's data source to read those instead of the live
site. (Same downstream — the boards don't care where the JSON came from.)

---

## Files
```
site/index.html        the four-group board (reads site/data/*.json)
site/data/*.json       one file per group — the crawler overwrites these nightly
scripts/crawl.mjs      the nightly crawler
.github/workflows/     the schedule + build + deploy
```

*1% Better Every Day.*
