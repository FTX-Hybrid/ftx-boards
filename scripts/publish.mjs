// Public output for the FTX boards (GitHub Pages, public repo).
//
// Privacy rule (Talon, 10/25/2026): the public boards show WHO is in each group:
// a basic athlete profile (name + group). Training data (workout counts, streaks,
// lifts, weights, workout details) is published ONLY for members who opted in.
// Never billing, payment, card, contact info, notes, goals or injuries.
//
// Full training data never touches this repo. It goes to Supabase only.
//
// Opt-in: Exercise.com has no "share my training publicly" field that the crawler
// can read, so opt-in is the list in public-optin.json (Exercise.com user ids).
// Empty list = everyone gets the basic profile only.
import { readFile, writeFile } from 'node:fs/promises';

export const GROUP_ORDER = ['ATHENA', 'MAVERICK', 'HYROX', 'HYROXONLINE', 'HYBRID'];
const SITE = new URL('../site/', import.meta.url);

export async function loadOptIn() {
  try {
    const j = JSON.parse(await readFile(new URL('../public-optin.json', import.meta.url), 'utf8'));
    return new Set((j.training_public_user_ids || []).map(String));
  } catch { return new Set(); }
}

// members: [{ n, uid, w?, streak?, detail?, prs? }] (full data, in memory only)
export function publicPayload(group, members, optIn) {
  const seen = new Set();
  const out = [];
  for (const m of members) {
    const k = (m.n || '').trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const p = { n: m.n.trim() };
    if (m.uid != null && optIn.has(String(m.uid))) {
      p.training = { workouts: m.w || 0, streak: m.streak || 0 };
      if (m.prs && m.prs.length) p.training.prs = m.prs.map(x => ({ name: x.name, reps: x.reps, weight: x.weight }));
    }
    out.push(p);
  }
  out.sort((a, b) => a.n.localeCompare(b.n)); // alphabetical: no ranking by activity
  return { group, updated: new Date().toISOString().slice(0, 10), total: out.length, members: out };
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CSS = `body{background:#0b0b0c;color:#f4f3f1;font:16px/1.5 system-ui,sans-serif;margin:0}
.wrap{max-width:760px;margin:0 auto;padding:24px 16px 64px}h1{font-size:22px;letter-spacing:.02em;margin:0 0 4px}
h1 b{color:#d63027}h2{font-size:18px;margin:28px 0 8px;color:#d63027;letter-spacing:.08em}
.sub{color:#78766f;font-size:13px;margin-bottom:16px}ul{list-style:none;padding:0;margin:0}
li{padding:10px 12px;border-bottom:1px solid #212124}.t{color:#b8b6b1;font-size:13px}`;

function groupSection(p) {
  const items = p.members.map(m => {
    let t = '';
    if (m.training) {
      t = `<div class="t">${m.training.workouts} workouts logged · streak ${m.training.streak}` +
        (m.training.prs ? ' · PRs: ' + m.training.prs.map(x => esc(x.name) + (x.weight ? ` ${x.weight}` : ` ×${x.reps}`)).join(', ') : '') + '</div>';
    }
    return `<li>${esc(m.n)}${t}</li>`;
  }).join('');
  return `<h2>${esc(p.group)}</h2><div class="sub">${p.total} athletes</div><ul>${items}</ul>`;
}
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">
<h1>FTX <b>HYBRID</b> ATHLETICS</h1><div class="sub">1% Better Every Day</div>${body}</div></body></html>\n`;
}

// Writes site/data/<GROUP>.json (public payload only), one page per group,
// the coaches page (all groups), and the landing page.
export async function publish(payloads, coachFile) {
  const have = GROUP_ORDER.filter(g => payloads[g]);
  for (const g of have) {
    await writeFile(new URL(`data/${g}.json`, SITE), JSON.stringify(payloads[g], null, 2) + '\n');
    await writeFile(new URL(`${g.toLowerCase()}.html`, SITE), page(`FTX ${g}`, groupSection(payloads[g])));
  }
  if (have.length) await writeFile(new URL(coachFile, SITE), page('FTX Groups', have.map(g => groupSection(payloads[g])).join('')));
  await writeFile(new URL('index.html', SITE), page('FTX Athlete Boards', '<p class="sub">Open your group\'s link to see who\'s in it.</p>'));
  return have;
}
