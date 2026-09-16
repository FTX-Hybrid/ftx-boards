// FTX Group Boards — nightly crawler
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'https://app.ftxhybrid.com';
const EMAIL = process.env.EXERCISE_EMAIL;
const PASSWORD = process.env.EXERCISE_PASSWORD;
const DAYS = 45;
const TZ = 'America/Chicago';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SB_ON = !!(SUPABASE_URL && SUPABASE_KEY);

async function sbUpsert(table, rows, onConflict) {
  if (!SB_ON || !rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) console.log(`  ! supabase ${table} upsert failed ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
}

const GROUPS = { ATHENA: 16830, MAVERICK: 16847, HYROX: 15342, HYROXONLINE: 16778, HYBRID: 15308 };

function currentStreak(datesISO) {
  const set = new Set(datesISO);
  let streak = 0;
  const d = new Date();
  const iso = x => x.toISOString().slice(0, 10);
  if (!set.has(iso(d))) d.setDate(d.getDate() - 1);
  while (set.has(iso(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

async function resolveMemberIds(page, gid) {
  return page.evaluate(async (gid) => {
    const log = [];
    const tryGet = async (u) => { try { const r = await fetch(u, { headers: { Accept: 'application/json' } }); const j = r.ok ? await r.json().catch(() => null) : null; return { s: r.status, j }; } catch (e) { return { s: 'ERR', j: null }; } };
    const extractIds = (j) => {
      if (!j) return null;
      const arrays = [j.group_members, j.member_ids, j.user_ids, j.client_ids, j.members, j.users, j.clients, j.client, j.data, Array.isArray(j) ? j : null];
      for (const a of arrays) if (Array.isArray(a) && a.length) return a.map(x => (x && typeof x === 'object') ? (x.user_id || (x.user && x.user.id) || x.client_id || x.member_id || x.id) : x).filter(Boolean).map(String);
      return null;
    };
    const sources = [
      `/api/v3/group_members?group_id=${gid}&fetch_all=true`,
      `/api/v3/group_members?f_groupId=${gid}&fetch_all=true`,
      `/api/v3/group_members?group_id=${gid}&per_page=1000`,
      `/api/v4/group_members?group_id=${gid}&fetch_all=true`,
    ];
    for (const u of sources) {
      const { s, j } = await tryGet(u);
      const ids = extractIds(j);
      log.push(`${u.split('?')[0].slice(-40)} -> ${s}${ids ? ` ids=${ids.length}` : (j && !Array.isArray(j) ? ` keys=[${Object.keys(j).slice(0, 12).join(',')}]` : '')}`);
      if (ids && ids.length && ids.length < 1000) return { ids: [...new Set(ids)], log };
    }
    return { ids: null, log };
  }, gid);
}

async function pullAthlete(page, uid, days, tz) {
  return page.evaluate(async ({ uid, days, tz }) => {
    const now = Math.floor(Date.now() / 1000);
    const start = now - days * 24 * 3600;
    let logged = [];
    try {
      const cal = await (await fetch(`/api/v4/calendar?user_id=${uid}&object_type=logged_workout&start=${start}&end=${now}&time_zone=${encodeURIComponent(tz)}`, { headers: { Accept: 'application/json' } })).json();
      logged = (Array.isArray(cal) ? cal : Object.values(cal)).filter(x => x && x.object_type === 'logged-workout' && !/rest\s*day|mobility|recovery/i.test(x.text || ''));
    } catch { return null; }
    const dates = new Set(); const prs = {}; const sessions = []; const rows = [];
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
        rows.push({ logged_date: date, ex_workout_id: w.object_id, workout_title: (w.text || '').trim(), exercise_id: ex.exercise_id, exercise_name: ex.name, reps: mv.reps, weight: mv.weight, time_sec: mv.time, is_pr: !!ex.pr });
        const key = ex.exercise_id;
        const better = mv.weight > 0 ? (!prs[key] || mv.weight > prs[key].weight) : (!prs[key] || mv.reps > prs[key].reps);
        if (better) prs[key] = { name: mv.name, reps: mv.reps, weight: mv.weight, date };
      }
      if (moves.length) sessions.push({ date, title: (w.text || '').trim(), moves });
    }
    sessions.sort((a, b) => (a.date < b.date ? 1 : -1));
    return { loggedDates: [...dates].sort(), recent: sessions[0] || null, prs: Object.values(prs).filter(p => p.weight > 0 || p.reps > 0).slice(0, 8), workouts: logged.length, rows };
  }, { uid, days, tz });
}

async function main() {
  if (!EMAIL || !PASSWORD) throw new Error('Set EXERCISE_EMAIL and EXERCISE_PASSWORD env vars.');
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name*="email" i]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Log"), button:has-text("Sign")').first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3500);
  const me = await page.evaluate(async () => { try { const r = await fetch('/api/v4/users/me', { headers: { Accept: 'application/json' } }); return r.ok ? (await r.json()).id : null; } catch { return null; } });
  if (!me) throw new Error('LOGIN FAILED — check EXERCISE_EMAIL / EXERCISE_PASSWORD.');
  console.log(`Logged in OK (user ${me}).`);

  const users = await page.evaluate(async () => {
    try { const r = await fetch('/api/v4/users?fetch_all=true', { headers: { Accept: 'application/json' } }); const j = await r.json(); const arr = Array.isArray(j) ? j : (j.users || j.data || []); return arr.map(u => ({ id: String(u.id), first: u.first_name || '', last: u.last_name || '' })); } catch { return []; }
  });
  const byId = new Map(users.map(u => [u.id, u]));
  console.log(`Account roster: ${users.length} users.`);
  await mkdir(new URL('../site/data/', import.meta.url), { recursive: true });

  for (const [name, id] of Object.entries(GROUPS)) {
    console.log(`\n=== ${name} (group ${id}) ===`);
    const { ids, log } = await resolveMemberIds(page, id);
    for (const l of log) console.log(`   ${l}`);
    if (!ids) { console.log(`  ! ${name}: could not resolve a per-group member list — skipping (preserving last-good data)`); continue; }
    const roster = ids.map(uid => byId.get(String(uid))).filter(Boolean).filter(u => u.first || u.last);
    console.log(`  ${name}: ${roster.length} members`);
    if (roster.length === 0 || roster.length >= 1000) { console.log(`  ! ${name}: roster size ${roster.length} looks wrong — skipping`); continue; }

    const members = [], athleteRows = [], resultRows = [];
    for (const u of roster) {
      const uid = +u.id || u.id;
      const m = { n: `${u.first} ${u.last}`.trim(), w: 0, h: '—', uid };
      if (Number.isFinite(uid)) athleteRows.push({ exercise_user_id: uid, first_name: u.first, last_name: u.last, grp: name });
      try {
        const perf = await pullAthlete(page, m.uid, DAYS, TZ);
        if (perf) {
          m.w = perf.workouts; m.streak = currentStreak(perf.loggedDates);
          if (perf.recent) m.detail = perf.recent;
          if (perf.prs && perf.prs.length) m.prs = perf.prs;
          if (perf.rows && Number.isFinite(uid)) for (const row of perf.rows) resultRows.push({ exercise_user_id: uid, ...row });
        }
      } catch (e) { console.log(`  ! perf failed for ${m.n}: ${e.message}`); }
      try { const c = await page.evaluate(async uid => { const res = await fetch('/api/v4/users/' + uid, { headers: { Accept: 'application/json' } }); if (!res.ok) return null; const j = await res.json(); return j.num_workouts ?? null; }, m.uid); if (c && c > 0) m.c = c; } catch {}
      delete m.uid; members.push(m);
      console.log(`  ${m.n}: ${m.w} logged, streak ${m.streak ?? 0}`);
    }
    members.sort((a, b) => b.w - a.w);
    const payload = { group: name, updated: new Date().toISOString().slice(0, 10), window: 'last 45 days', total: members.length, members, zerosNamed: members.filter(m => m.w === 0).map(m => m.n).slice(0, 8) };
    await writeFile(new URL(`../site/data/${name}.json`, import.meta.url), JSON.stringify(payload, null, 2));
    console.log(`  wrote ${members.length} members (${members.filter(m => m.w > 0).length} logging)`);
    if (SB_ON) { await sbUpsert('athletes', athleteRows, 'exercise_user_id'); await sbUpsert('results', resultRows, 'exercise_user_id,ex_workout_id,exercise_id'); console.log(`  supabase: ${athleteRows.length} athletes, ${resultRows.length} result rows`); }
  }
  await browser.close();
  console.log('\nDone.');
}
main().catch(e => { console.error(e); process.exit(1); });
