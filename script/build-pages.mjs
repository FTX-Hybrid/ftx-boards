// Build isolated, self-contained group pages + one combined coaches page.
// Each group page has ONLY its own data baked in (window.__DATA__) and is locked
// to that group (window.__ONLY__). No shared JSON is published, so an athlete on
// the Athena page has no path to any other group's data. The combined coaches
// page (all 5) is written to an unguessable filename for the 3 coaches.
//
//   node scripts/build-pages.mjs
//
// Reads group payloads from DATA_DIR (default: site/data), the board template
// from site/_board.html, and writes pages into site/.

import { readFile, writeFile, readdir } from 'node:fs/promises';

const SITE = new URL('../site/', import.meta.url);
const DATA_DIR = new URL('data/', SITE);
const GROUPS = ['ATHENA', 'MAVERICK', 'HYROX', 'HYROXONLINE', 'HYBRID'];
// Stable unguessable filename for the coaches' all-groups page. Override via env
// to rotate it (kills the old URL).
const COACH_FILE = process.env.COACH_FILE || 'coaches-a8f3k2d9.html';

function inject(tpl, scriptObj) {
  const s = `<script>${Object.entries(scriptObj).map(([k, v]) => `window.${k}=${JSON.stringify(v)};`).join('')}</script>`;
  return tpl.replace('</head>', s + '\n</head>');
}

async function main() {
  const tpl = await readFile(new URL('_board.html', SITE), 'utf8');

  // load whatever group data exists
  const data = {};
  for (const g of GROUPS) {
    try { data[g] = JSON.parse(await readFile(new URL(`${g}.json`, DATA_DIR), 'utf8')); } catch {}
  }
  const have = Object.keys(data);
  if (!have.length) throw new Error('No group data found in site/data — run the crawler first.');

  // 1) one isolated, locked page per group (only its own data baked in)
  for (const g of have) {
    const page = inject(tpl, { __ONLY__: g, __DATA__: { [g]: data[g] } });
    await writeFile(new URL(`${g.toLowerCase()}.html`, SITE), page);
    console.log(`  wrote ${g.toLowerCase()}.html  (isolated: ${g} only)`);
  }

  // 2) combined coaches page — all groups, switcher on, unguessable filename
  const coach = inject(tpl, { __DATA__: data });     // no __ONLY__ => full switcher
  await writeFile(new URL(COACH_FILE, SITE), coach);
  console.log(`  wrote ${COACH_FILE}  (coaches: all ${have.length} groups)`);

  // 3) neutral root landing — no data, nothing to scrape
  const landing = `<!doctype html><meta charset="utf-8"><title>FTX Athlete Boards</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#0b0b0c;color:#eee;font:16px/1.6 system-ui;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}h1{letter-spacing:.02em}p{color:#888;max-width:32ch}</style>
<div><h1>FTX HYBRID ATHLETICS</h1><p>Athlete boards are private. Open your group's link to view it.</p></div>`;
  await writeFile(new URL('index.html', SITE), landing);
  console.log('  wrote index.html  (neutral landing, no data)');
}
main().catch(e => { console.error(e); process.exit(1); });
