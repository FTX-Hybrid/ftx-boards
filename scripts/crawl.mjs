// FTX Group Boards — nightly crawler (v2: real per-workout performance)
// Logs into Exercise.com, and for each group:
//   1) pulls the "Logged Workout History" report  -> user_ids, names, compliance counts
//   2) per athlete, pulls logged workouts + per-exercise numbers via the internal API
//      - /api/v4/calendar?user_id=<uid>&object_type=logged_workout&start=<epoch>&end=<epoch>
//      - /api/v3/workout_blocks?workout_id=<logged_id>&fetch_all=true
//   3) computes streaks, PRs (by exercise_id), and the most recent session detail
//   Writes site/data/<GROUP>.json
//
// Requires GitHub secrets: EXERCISE_EMAIL, EXERCISE_PASSWORD
// Run:  node scripts/crawl.mjs

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'https://app.ftxhybrid.com';
const EMAIL = process.env.EXERCISE_EMAIL;
const PASSWORD = process.env.EXERCISE_PASSWORD;
const DAYS = 45;                      // performance lookback window
const TZ = 'America/Chicago';

// Optional Supabase system-of-record. If these are set, the crawler upserts
// athletes + per-exercise results as it goes. If not, it just writes JSON.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SB_ON = !!(SUPABASE_URL && SUPABASE_KEY);

async function sbUpsert(table, rows, onConflict) {
  if (!SB_ON || !rows.length) return;
  // chunk to keep requests small
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) console.log(`  ! supabase ${table} upsert failed ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
}

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
  return { startDate: start.toString(), endDate: end.toString(), date: end.toString(), dateFilter: '', utc: false };
}
function reportUrl(groupId) {
  const f = JSON.stringify(last30());
  return `${BASE}/ex4/report/logged_workout_history_report?page=1&f_date=${encodeURIComponent(encodeURIComponent(f))}&f_groupId=${groupId}`;
}
function hoursLabel(txt) {
  if (!txt || /^0 seconds/i.test(txt)) return '—';
  let h = 0;
  const d = txt.match(/(\d+)\s*day/);   if (d)  h += +d[1] * 24;
  const hr = txt.match(/(\d+)\s*hour/); if (hr) h += +hr[1];
  const m = txt.match(/(\d+)\s*minute/);if (m)  h += m[1] / 60;
  return h >= 1 ? `${Math.round(h)}h` : (h > 0 ? '<1h' : '—');
}
// current consecutive-day streak (counting today or yesterday as the anchor)
function currentStreak(datesISO) {
  const set = new Set(datesISO);
  let streak = 0;
  const d = new Date();
  // allow the streak to be "alive" if they logged today or yesterday
  const iso = x => x.toISOString().slice(0, 10);
  if (!set.has(iso(d))) d.setDate(d.getDate() - 1);
  while (set.has(iso(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

// Pull one athlete's performance (logged workouts + per-exercise), IN PAGE CONTEXT.
async function pullAthlete(page, uid, days, tz) {
  return page.evaluate(async ({ uid, days, tz }) => {
    const now = Math.floor(Date.now() / 1000);
    const start = now - days * 24 * 3600;
    let logged = [];
    try {
      const cal = await (await fetch(`/api/v4/calendar?user_id=${uid}&object_type=logged_workout&start=${start}&end=${now}&time_zone=${encodeURIComponent(tz)}`, { headers: { Accept: 'application/json' } })).json();
      logged = (Array.isArray(cal) ? cal : Object.values(cal))
        .filter(x => x && x.object_type === 'logged-workout' && !/rest\s*day|mobility|recovery/i.test(x.text || ''));
    } catch { return null; }

    const dates = new Set();
    const prs = {};           // exercise_id -> {name, reps, weight, date}
    const sessions = [];      // {date, title, moves:[{name,reps,weight,time}]}
    const rows = [];          // flat per-exercise rows for Supabase
    for (const w of logged) {
      const date = (w.data && w.data.calendar_date) || new Date(w.date * 1000).toISOString().slice(0, 10);
      dates.add(date);
      let blocks = [];
      try { blocks = await (await fetch(`/api/v3/workout_blocks?workout_id=${w.object_id}&fetch_all=true`, { headers: { Accept: 'application/json' } })).json(); } catch { continue; }
      const moves = [];
      for (const b of (blocks || [])) for (const ex of (b.exercises || [])) {
        if (!ex.name) continue;
        const mv = { name: ex.name, id: ex.exercise_id, reps: ex.total_reps || 0, weight: ex.total_weight || 0, time: ex.total_time || 0 };
        moves.push(mv);
        rows.push({
          logged_date: date, ex_workout_id: w.object_id, workout_title: (w.text || '').trim(),
          exercise_id: ex.exercise_id, exercise_name: ex.name,
          reps: mv.reps, weight: mv.weight, time_sec: mv.time, is_pr: !!ex.pr,
        });
        // PR by best total volume (weight) for weighted moves, else best reps
        const key = ex.exercise_id;
        const better = mv.weight > 0
          ? (!prs[key] || mv.weight > prs[key].weight)
          : (!prs[key] || mv.reps > prs[key].reps);
        if (better) prs[key] = { name: mv.name, reps: mv.reps, weight: mv.weight, date };
      }
      if (moves.length) sessions.push({ date, title: (w.text || '').trim(), moves });
    }
    sessions.sort((a, b) => (a.date < b.date ? 1 : -1));   // newest first
    return {
      loggedDates: [...dates].sort(),
      recent: sessions[0] || null,
      prs: Object.values(prs).filter(p => p.weight > 0 || p.reps > 0).slice(0, 8),
      sessionCount: sessions.length,
      rows,
    };
  }, { uid, days, tz });
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
    console.log(`\n=== ${name} (group ${id}) ===`);
    await page.goto(reportUrl(id), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('table tbody tr, [role="row"]', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);

    // report rows: UserID, First, Last, Email, #Logins, FollowingCal, NotFollowing, #LoggedWorkouts, WorkoutTime
    const rows = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('table tbody tr').forEach(tr => {
        const c = [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
        if (c.length < 9) return;
        out.push({ userId: c[0], first: c[1], last: c[2], logged: +c[7] || 0, time: c[8] });
      });
      return out;
    });
    console.log(`  report: ${rows.length} athletes`);

    const members = [];
    const athleteRows = [];     // -> Supabase athletes
    const resultRows = [];      // -> Supabase results
    for (const r of rows) {
      const uid = +r.userId || r.userId;
      const m = { n: `${r.first} ${r.last}`.trim(), w: r.logged, h: hoursLabel(r.time), uid };
      if (Number.isFinite(uid)) athleteRows.push({ exercise_user_id: uid, first_name: r.first, last_name: r.last, grp: name });
      // performance pull (best-effort; only for people who logged at least once)
      if (r.logged > 0) {
        try {
          const perf = await pullAthlete(page, m.uid, DAYS, TZ);
          if (perf) {
            m.streak = currentStreak(perf.loggedDates);
            if (perf.recent) m.detail = perf.recent;   // {date, title, moves:[{name,reps,weight,time}]}
            if (perf.prs && perf.prs.length) m.prs = perf.prs;
            if (perf.rows && Number.isFinite(uid)) for (const row of perf.rows) resultRows.push({ exercise_user_id: uid, ...row });
          }
        } catch (e) { console.log(`  ! perf failed for ${m.n}: ${e.message}`); }
      }
      // lifetime career total
      try {
        const u = await page.evaluate(async uid => {
          const res = await fetch('/api/v4/users/' + uid, { headers: { Accept: 'application/json' } });
          if (!res.ok) return null; const j = await res.json(); return j.num_workouts ?? null;
        }, m.uid);
        if (u && u > 0) m.c = u;
      } catch {}
      delete m.uid;                         // don't ship raw ids to the public board
      members.push(m);
      console.log(`  ${m.n}: ${m.w} logged, streak ${m.streak ?? 0}${m.detail ? `, last "${m.detail.title}"` : ''}`);
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
    await writeFile(new URL(`../site/data/${name}.json`, import.meta.url), JSON.stringify(payload, null, 2));
    console.log(`  wrote ${members.length} members (${members.filter(m => m.w > 0).length} logging)`);

    // system-of-record: push to Supabase (no-op if secrets aren't set)
    if (SB_ON) {
      await sbUpsert('athletes', athleteRows, 'exercise_user_id');
      await sbUpsert('results', resultRows, 'exercise_user_id,ex_workout_id,exercise_id');
      console.log(`  supabase: ${athleteRows.length} athletes, ${resultRows.length} result rows`);
    }
  }

  await browser.close();
  console.log('\nDone.');
}
main().catch(e => { console.error(e); process.exit(1); });
