// FTX Group Boards — nightly crawler
// Logs into Exercise.com, pulls the "Logged Workout History" report for each group,
// enriches with lifetime workout totals, and writes site/data/<GROUP>.json
//
// Requires GitHub secrets: EXERCISE_EMAIL, EXERCISE_PASSWORD
// Run:  node scripts/crawl.mjs
//
// NOTE: the login step is the one piece to validate on first run. If Exercise.com
// blocks the automated login, use the manual fallback in README (drop the CSV export).

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'https://app.ftxhybrid.com';
const EMAIL = process.env.EXERCISE_EMAIL;
const PASSWORD = process.env.EXERCISE_PASSWORD;

// Group name -> Exercise.com group id (from the report URL f_groupId)
const GROUPS = {
  ATHENA:      16830,
  MAVERICK:    16847,
  HYROX:       15342,
  HYROXONLINE: 16778,
  HYBRID:      15308,
};

// -- helpers ---------------------------------------------------------------
function last30() {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const mk = d => ({ // matches the report's expected shape
    startDate: start.toString(), endDate: end.toString(), date: end.toString(),
    dateFilter: '', utc: false,
  });
  return mk();
}
function reportUrl(groupId) {
  const f = JSON.stringify(last30());
  // the app double-encodes this query value
  return `${BASE}/ex4/report/logged_workout_history_report?page=1&f_date=${encodeURIComponent(encodeURIComponent(f))}&f_groupId=${groupId}`;
}
function hoursLabel(txt) {
  if (!txt || /^0 seconds/i.test(txt)) return '—';
  let h = 0;
  const d = txt.match(/(\d+)\s*day/);      if (d) h += +d[1] * 24;
  const hr = txt.match(/(\d+)\s*hour/);    if (hr) h += +hr[1];
  const m = txt.match(/(\d+)\s*minute/);   if (m) h += m[1] / 60;
  return h >= 1 ? `${Math.round(h)}h` : (h > 0 ? '<1h' : '—');
}

// -- main ------------------------------------------------------------------
async function main() {
  if (!EMAIL || !PASSWORD) throw new Error('Set EXERCISE_EMAIL and EXERCISE_PASSWORD env vars.');
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // 1) LOGIN
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name*="email" i]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Log"), button:has-text("Sign")').first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);

  await mkdir(new URL('../site/data/', import.meta.url), { recursive: true });

  for (const [name, id] of Object.entries(GROUPS)) {
    console.log(`Crawling ${name} (group ${id})…`);
    await page.goto(reportUrl(id), { waitUntil: 'domcontentloaded' });
    // wait for the report table to populate
    await page.waitForSelector('table tbody tr, [role="row"]', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);

    // Extract rows from the rendered report. Columns:
    // UserID, First, Last, Email, #Logins, FollowingCal, NotFollowing, #LoggedWorkouts, WorkoutTime, ...
    const rows = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('table tbody tr').forEach(tr => {
        const c = [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
        if (c.length < 9) return;
        out.push({ userId: c[0], first: c[1], last: c[2], logged: +c[7] || 0, time: c[8] });
      });
      return out;
    });

    const members = [];
    for (const r of rows) {
      const m = { n: `${r.first} ${r.last}`.trim(), w: r.logged, h: hoursLabel(r.time) };
      // lifetime career total via the user API (best-effort)
      try {
        const u = await page.evaluate(async uid => {
          const res = await fetch('/api/v4/users/' + uid, { headers: { Accept: 'application/json' } });
          if (!res.ok) return null; const j = await res.json(); return j.num_workouts ?? null;
        }, r.userId);
        if (u && u > 0) m.c = u;
      } catch {}
      members.push(m);
    }
    members.sort((a, b) => b.w - a.w);

    const payload = {
      group: name,
      updated: new Date().toISOString().slice(0, 10),
      window: 'last 30 days',
      total: members.length,
      members,
      zerosNamed: members.filter(m => m.w === 0).map(m => m.n).slice(0, 8),
    };
    const url = new URL(`../site/data/${name}.json`, import.meta.url);
    await writeFile(url, JSON.stringify(payload, null, 2));
    console.log(`  wrote ${members.length} members (${members.filter(m => m.w > 0).length} logging)`);
  }

  await browser.close();
  console.log('Done.');
}
main().catch(e => { console.error(e); process.exit(1); });
