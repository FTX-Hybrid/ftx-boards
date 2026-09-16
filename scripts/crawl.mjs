// FTX Group Boards — nightly crawler
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'https://app.ftxhybrid.com';
const EMAIL = process.env.EXERCISE_EMAIL;
const PASSWORD = process.env.EXERCISE_PASSWORD;
const SINCE = 1767225600; // 2026-01-01 00:00 UTC — pull full workout history from Jan 1
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
const GROUP_ORDER = ['ATHENA', 'MAVERICK', 'HYROX', 'HYROXONLINE', 'HYBRID'];
// Coaches' all-groups page — unguessable filename. Override via COACH_FILE env to rotate it.
const COACH_FILE = process.env.COACH_FILE || 'coaches-a8f3k2d9.html';
// The board UI template, base64-encoded so it lives in this one file (no separate _board.html / build-pages.mjs).
const BOARD_TPL_B64 = 'PCFkb2N0eXBlIGh0bWw+PGh0bWwgbGFuZz0iZW4iPjxoZWFkPgo8bWV0YSBjaGFyc2V0PSJ1dGYtOCI+PG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLCB2aWV3cG9ydC1maXQ9Y292ZXIiPgo8dGl0bGU+RlRYIEdyb3VwIEJvYXJkczwvdGl0bGU+CjxsaW5rIHJlbD0icHJlY29ubmVjdCIgaHJlZj0iaHR0cHM6Ly9mb250cy5nb29nbGVhcGlzLmNvbSI+CjxsaW5rIHJlbD0icHJlY29ubmVjdCIgaHJlZj0iaHR0cHM6Ly9mb250cy5nc3RhdGljLmNvbSIgY3Jvc3NvcmlnaW4+CjxsaW5rIHJlbD0ic3R5bGVzaGVldCIgaHJlZj0iaHR0cHM6Ly9mb250cy5nb29nbGVhcGlzLmNvbS9jc3MyP2ZhbWlseT1Pc3dhbGQ6d2dodEA1MDA7NjAwOzcwMCZmYW1pbHk9QXJjaGl2bzp3Z2h0QDQwMDs1MDA7NjAwOzcwMDs4MDAmZGlzcGxheT1zd2FwIj4KPHN0eWxlPgogIDpyb290ewogICAgLS1ncm91bmQ6IzBCMEIwQzsgLS1zdXJmYWNlOiMxNDE0MTY7IC0tc3VyZmFjZS0yOiMxQjFCMUU7IC0tbGluZTojMkEyQTJFOyAtLWxpbmUtc29mdDojMjEyMTI0OwogICAgLS1pbms6I0Y0RjNGMTsgLS1pbmstMjojQjhCNkIxOyAtLWluay0zOiM3ODc2NkY7CiAgICAtLXJlZDojRDYzMDI3OyAtLWJsdWU6IzJFN0REMTsgLS1hbWJlcjojRTBBODJFOwogICAgLS1nb29kOiM0RkIwNkE7IC0td2FybjojRTBBODJFOyAtLWJhZDojRDYzMDI3OyAtLWFjY2VudDojRDYzMDI3OwogICAgLS1zaGFkb3c6MCAxcHggMCByZ2JhKDAsMCwwLC41KSwgMCAxNHB4IDM0cHggcmdiYSgwLDAsMCwuNSk7CiAgfQogICp7Ym94LXNpemluZzpib3JkZXItYm94fQogIGh0bWwsYm9keXttYXJnaW46MH0KICBib2R5e2JhY2tncm91bmQ6dmFyKC0tZ3JvdW5kKTsgY29sb3I6dmFyKC0taW5rKTsgZm9udC1mYW1pbHk6IkFyY2hpdm8iLHN5c3RlbS11aSxzYW5zLXNlcmlmOyAtd2Via2l0LWZvbnQtc21vb3RoaW5nOmFudGlhbGlhc2VkfQogIGltZ3ttYXgtd2lkdGg6MTAwJX1baGlkZGVuXXtkaXNwbGF5Om5vbmUhaW1wb3J0YW50fQogIC53cmFwe21heC13aWR0aDo5NDBweDsgbWFyZ2luOjAgYXV0bzsgcGFkZGluZzoxNnB4OyBwYWRkaW5nLWJsb2NrOjIwcHggNjRweH0KICAudG51bXtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXN9CiAgLnRvcHtkaXNwbGF5OmZsZXg7IGFsaWduLWl0ZW1zOmNlbnRlcjsganVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47IGdhcDoxNHB4OyBtYXJnaW4tYm90dG9tOjIwcHh9CiAgLmxvZ297Zm9udC1mYW1pbHk6Ik9zd2FsZCI7IGZvbnQtd2VpZ2h0OjcwMDsgZm9udC1zaXplOjIycHg7IGxldHRlci1zcGFjaW5nOi4wMmVtfQogIC5sb2dvIGJ7Y29sb3I6dmFyKC0tcmVkKX0KICAuY3JlZWR7Zm9udC1zaXplOjExcHg7IGxldHRlci1zcGFjaW5nOi4yMmVtOyB0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7IGNvbG9yOnZhcigtLWluay0zKTsgZm9udC13ZWlnaHQ6NzAwfQogIC5zd2l0Y2h7ZGlzcGxheTpmbGV4OyBnYXA6OHB4OyBmbGV4LXdyYXA6d3JhcDsgbWFyZ2luLWJvdHRvbToyMnB4fQogIC5zd3tmb250LWZhbWlseToiT3N3YWxkIjsgZm9udC13ZWlnaHQ6NjAwOyBmb250LXNpemU6MTZweDsgbGV0dGVyLXNwYWNpbmc6LjA0ZW07IHRleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTsgY29sb3I6dmFyKC0taW5rLTIpOyBiYWNrZ3JvdW5kOnZhcigtLXN1cmZhY2UpOyBib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpOyBwYWRkaW5nOjEwcHggMThweDsgYm9yZGVyLXJhZGl1czo4cHg7IGN1cnNvcjpwb2ludGVyfQogIC5zd1thcmlhLXNlbGVjdGVkPSJ0cnVlIl17Y29sb3I6I2ZmZjsgYmFja2dyb3VuZDp2YXIoLS1hY2NlbnQpOyBib3JkZXItY29sb3I6dHJhbnNwYXJlbnR9CiAgLm5hbWVwbGF0ZXtwb3NpdGlvbjpyZWxhdGl2ZTsgYm9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTsgYm9yZGVyLWxlZnQ6NXB4IHNvbGlkIHZhcigtLWFjY2VudCk7IGJhY2tncm91bmQ6bGluZWFyLWdyYWRpZW50KDEwMGRlZyx2YXIoLS1zdXJmYWNlKSx2YXIoLS1zdXJmYWNlLTIpKTsgYm9yZGVyLXJhZGl1czoxNHB4OyBwYWRkaW5nOjIycHggMjRweDsgbWFyZ2luLWJvdHRvbToxOHB4OyBvdmVyZmxvdzpoaWRkZW47IGJveC1zaGFkb3c6dmFyKC0tc2hhZG93KX0KICAubmFtZXBsYXRlIC5leWVicm93e2ZvbnQtc2l6ZToxMXB4OyBsZXR0ZXItc3BhY2luZzouMjRlbTsgdGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlOyBjb2xvcjp2YXIoLS1hY2NlbnQpOyBmb250LXdlaWdodDo4MDB9CiAgLm5hbWVwbGF0ZSBoMXtmb250LWZhbWlseToiT3N3YWxkIjsgZm9udC13ZWlnaHQ6NzAwOyBmb250LXNpemU6Y2xhbXAoNDBweCwxMHZ3LDc0cHgpOyBsaW5lLWhlaWdodDouOTsgbWFyZ2luOjZweCAwIDJweDsgbGV0dGVyLXNwYWNpbmc6LjAxZW07IHRleHQtdHJhbnNmb3JtOnVwcGVyY2FzZX0KICAubmFtZXBsYXRlIC50YWd7Y29sb3I6dmFyKC0taW5rLTIpOyBmb250LXNpemU6MTRweH0KICAubmFtZXBsYXRlIC5naG9zdHtwb3NpdGlvbjphYnNvbHV0ZTsgcmlnaHQ6MTRweDsgdG9wOi0xNHB4OyBmb250LWZhbWlseToiT3N3YWxkIjsgZm9udC13ZWlnaHQ6NzAwOyBmb250LXNpemU6MTUwcHg7IGxpbmUtaGVpZ2h0OjE7IGNvbG9yOnZhcigtLWFjY2VudCk7IG9wYWNpdHk6LjA2OyBwb2ludGVyLWV2ZW50czpub25lfQogIC5rcGlze2Rpc3BsYXk6Z3JpZDsgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdCg0LDFmcik7IGdhcDoxMnB4OyBtYXJnaW4tYm90dG9tOjhweH0KICBAbWVkaWEgKG1heC13aWR0aDo2MjBweCl7IC5rcGlze2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnIgMWZyfSB9CiAgLmtwaXtiYWNrZ3JvdW5kOnZhcigtLXN1cmZhY2UpOyBib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUtc29mdCk7IGJvcmRlci1yYWRpdXM6MTFweDsgcGFkZGluZzoxM3B4IDE1cHg7IGJveC1zaGFkb3c6dmFyKC0tc2hhZG93KX0KICAua3BpIC5se2ZvbnQtc2l6ZToxMC41cHg7IGxldHRlci1zcGFjaW5nOi4xM2VtOyB0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7IGNvbG9yOnZhcigtLWluay0zKTsgZm9udC13ZWlnaHQ6NzAwfQogIC5rcGkgLnZ7Zm9udC1mYW1pbHk6Ik9zd2FsZCI7IGZvbnQtd2VpZ2h0OjcwMDsgZm9udC1zaXplOjI3cHg7IG1hcmdpbi10b3A6M3B4fQogIC5rcGkgLnYgc21hbGx7Zm9udC1zaXplOjE0cHg7IGNvbG9yOnZhcigtLWluay0zKTsgZm9udC1mYW1pbHk6IkFyY2hpdm8iOyBmb250LXdlaWdodDo2MDB9CiAgLmtwaS5oaSAudntjb2xvcjp2YXIoLS1hY2NlbnQpfQogIC5jYWxsb3V0e2Rpc3BsYXk6ZmxleDsgYWxpZ24taXRlbXM6Y2VudGVyOyBnYXA6MTJweDsgYmFja2dyb3VuZDpsaW5lYXItZ3JhZGllbnQoMTAwZGVnLGNvbG9yLW1peChpbiBva2xhYix2YXIoLS1hY2NlbnQpIDE2JSx2YXIoLS1zdXJmYWNlKSksdmFyKC0tc3VyZmFjZSkpOyBib3JkZXI6MXB4IHNvbGlkIGNvbG9yLW1peChpbiBva2xhYix2YXIoLS1hY2NlbnQpIDM1JSx2YXIoLS1saW5lKSk7IGJvcmRlci1yYWRpdXM6MTFweDsgcGFkZGluZzoxMnB4IDE2cHg7IG1hcmdpbjoxNHB4IDAgNHB4OyBmb250LXNpemU6MTRweH0KICAuY2FsbG91dCBie2ZvbnQtZmFtaWx5OiJPc3dhbGQiOyBmb250LXdlaWdodDo3MDA7IGZvbnQtc2l6ZToxOHB4fQogIC5jYWxsb3V0IC5lbXtjb2xvcjp2YXIoLS1hY2NlbnQpfQogIC5zZWNoZWFke2Rpc3BsYXk6ZmxleDsgYWxpZ24taXRlbXM6YmFzZWxpbmU7IGp1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuOyBnYXA6MTJweDsgbWFyZ2luOjIycHggMnB4IDhweH0KICAuc2VjaGVhZCBoMntmb250LWZhbWlseToiT3N3YWxkIjsgZm9udC13ZWlnaHQ6NjAwOyBmb250LXNpemU6MThweDsgdGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlOyBsZXR0ZXItc3BhY2luZzouMDRlbTsgbWFyZ2luOjB9CiAgLnNlY2hlYWQgLmNhcHtmb250LXNpemU6MTJweDsgY29sb3I6dmFyKC0taW5rLTMpfQogIC50YXB7Zm9udC1zaXplOjEycHg7IGNvbG9yOnZhcigtLWluay0zKTsgbWFyZ2luOjAgMnB4IDEycHh9CiAgLmJvYXJke2Rpc3BsYXk6ZmxleDsgZmxleC1kaXJlY3Rpb246Y29sdW1uOyBnYXA6N3B4fQogIC5pdGVte2JhY2tncm91bmQ6dmFyKC0tc3VyZmFjZSk7IGJvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZS1zb2Z0KTsgYm9yZGVyLXJhZGl1czoxMXB4OyBib3gtc2hhZG93OnZhcigtLXNoYWRvdyk7IG92ZXJmbG93OmhpZGRlbn0KICAuaXRlbS5sZWFke2JvcmRlci1jb2xvcjpjb2xvci1taXgoaW4gb2tsYWIsdmFyKC0tYWNjZW50KSA1NSUsdmFyKC0tbGluZSkpfQogIC5yb3d7bGlzdC1zdHlsZTpub25lOyBjdXJzb3I6cG9pbnRlcjsgZGlzcGxheTpncmlkOyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6MzRweCAxZnIgYXV0byBhdXRvIDE2cHg7IGFsaWduLWl0ZW1zOmNlbnRlcjsgZ2FwOjEzcHg7IHBhZGRpbmc6MTFweCAxNXB4fQogIC5yb3c6Oi13ZWJraXQtZGV0YWlscy1tYXJrZXJ7ZGlzcGxheTpub25lfQogIEBtZWRpYSAobWF4LXdpZHRoOjYyMHB4KXsgLnJvd3tncmlkLXRlbXBsYXRlLWNvbHVtbnM6MjhweCAxZnIgYXV0byAxNnB4OyBnYXA6MTBweH0gLnJvdyAuY2FyZWVye2Rpc3BsYXk6bm9uZX0gfQogIC5ya3tmb250LWZhbWlseToiT3N3YWxkIjsgZm9udC13ZWlnaHQ6NzAwOyBmb250LXNpemU6MThweDsgY29sb3I6dmFyKC0taW5rLTMpOyB0ZXh0LWFsaWduOmNlbnRlcn0KICAuaXRlbS5sZWFkIC5ya3tjb2xvcjp2YXIoLS1hY2NlbnQpfQogIC5ubXtmb250LXdlaWdodDo3MDA7IGZvbnQtc2l6ZToxNS41cHg7IGRpc3BsYXk6ZmxleDsgYWxpZ24taXRlbXM6Y2VudGVyOyBnYXA6OXB4OyBmbGV4LXdyYXA6d3JhcH0KICAucGlsbHtmb250LXNpemU6MTBweDsgbGV0dGVyLXNwYWNpbmc6LjA2ZW07IHRleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTsgZm9udC13ZWlnaHQ6ODAwOyBwYWRkaW5nOjJweCA4cHg7IGJvcmRlci1yYWRpdXM6NXB4fQogIC5waWxsLnN0cmt7YmFja2dyb3VuZDojMmExNjA3OyBjb2xvcjojZmY5ZDNjOyBsZXR0ZXItc3BhY2luZzouMDJlbX0KICAuc3BsaXRyb3cgLmR0e29wYWNpdHk6LjU1OyBmb250LXdlaWdodDo2MDB9CiAgLnAtc3Ryb25ne2NvbG9yOnZhcigtLWdvb2QpOyBib3JkZXI6MXB4IHNvbGlkIGNvbG9yLW1peChpbiBva2xhYix2YXIoLS1nb29kKSA0NSUsdHJhbnNwYXJlbnQpfQogIC5wLXNvbGlke2NvbG9yOnZhcigtLWJsdWUpOyBib3JkZXI6MXB4IHNvbGlkIGNvbG9yLW1peChpbiBva2xhYix2YXIoLS1ibHVlKSA0NSUsdHJhbnNwYXJlbnQpfQogIC5wLXNsaXB7Y29sb3I6dmFyKC0td2Fybik7IGJvcmRlcjoxcHggc29saWQgY29sb3ItbWl4KGluIG9rbGFiLHZhcigtLXdhcm4pIDQ1JSx0cmFuc3BhcmVudCl9CiAgLnAtZ2hvc3R7Y29sb3I6dmFyKC0tYmFkKTsgYm9yZGVyOjFweCBzb2xpZCBjb2xvci1taXgoaW4gb2tsYWIsdmFyKC0tYmFkKSA0NSUsdHJhbnNwYXJlbnQpfQogIC53a3tmb250LWZhbWlseToiT3N3YWxkIjsgZm9udC13ZWlnaHQ6NzAwOyBmb250LXNpemU6MjBweDsgdGV4dC1hbGlnbjpyaWdodH0KICAud2sgc21hbGx7Zm9udC1zaXplOjEwLjVweDsgY29sb3I6dmFyKC0taW5rLTMpOyBmb250LWZhbWlseToiQXJjaGl2byI7IGZvbnQtd2VpZ2h0OjYwMH0KICAuY2FyZWVye2ZvbnQtc2l6ZToxMS41cHg7IGNvbG9yOnZhcigtLWluay0zKTsgdGV4dC1hbGlnbjpyaWdodDsgbWluLXdpZHRoOjc0cHh9CiAgLmNhcmVlciBie2NvbG9yOnZhcigtLWluay0yKTsgZm9udC13ZWlnaHQ6NzAwfQogIC5jaGV2e2NvbG9yOnZhcigtLWluay0zKTsgZm9udC1zaXplOjExcHg7IGp1c3RpZnktc2VsZjplbmQ7IHRyYW5zaXRpb246dHJhbnNmb3JtIC4yc30KICBkZXRhaWxzW29wZW5dIC5jaGV2e3RyYW5zZm9ybTpyb3RhdGUoMTgwZGVnKX0KICBAbWVkaWEgKHByZWZlcnMtcmVkdWNlZC1tb3Rpb246cmVkdWNlKXsuY2hldnt0cmFuc2l0aW9uOm5vbmV9fQogIC5pdGVtLnplcm8gLndre2NvbG9yOnZhcigtLWJhZCl9CiAgLmRldGFpbHtwYWRkaW5nOjJweCAxNnB4IDE2cHggNTZweH0KICBAbWVkaWEgKG1heC13aWR0aDo2MjBweCl7IC5kZXRhaWx7cGFkZGluZy1sZWZ0OjE2cHh9IH0KICAuZGh7Zm9udC1zaXplOjEwLjVweDsgbGV0dGVyLXNwYWNpbmc6LjEzZW07IHRleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTsgY29sb3I6dmFyKC0tYWNjZW50KTsgZm9udC13ZWlnaHQ6ODAwOyBtYXJnaW46MTJweCAwIDRweH0KICAuZGgye2ZvbnQtc2l6ZToxMnB4OyBmb250LXdlaWdodDo4MDA7IGNvbG9yOnZhcigtLWluay0yKTsgbWFyZ2luOjJweCAwIDRweH0KICAuc3BsaXRyb3d7ZGlzcGxheTpncmlkOyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6MWZyIGF1dG87IGdhcDoxMnB4OyBmb250LXNpemU6MTMuNXB4OyBwYWRkaW5nOjdweCAwOyBib3JkZXItdG9wOjFweCBzb2xpZCB2YXIoLS1saW5lLXNvZnQpfQogIC5zcGxpdHJvdyAudnZ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zOyBmb250LXdlaWdodDo3MDB9CiAgLnBlbmR7Zm9udC1zaXplOjEzcHg7IGNvbG9yOnZhcigtLWluay0zKTsgcGFkZGluZzo5cHggMCAycHg7IGJvcmRlci10b3A6MXB4IHNvbGlkIHZhcigtLWxpbmUtc29mdCk7IGxpbmUtaGVpZ2h0OjEuNX0KICAucGVuZCBlbXtjb2xvcjp2YXIoLS1pbmstMik7IGZvbnQtc3R5bGU6bm9ybWFsfQogIC8qIHByb2ZpbGUgKi8KICAucHN0cmlwe2Rpc3BsYXk6Z3JpZDsgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdCg0LDFmcik7IGdhcDo4cHg7IG1hcmdpbjo2cHggMCAycHh9CiAgQG1lZGlhIChtYXgtd2lkdGg6NjIwcHgpeyAucHN0cmlwe2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnIgMWZyfSB9CiAgLnBzdGF0e2JhY2tncm91bmQ6dmFyKC0tc3VyZmFjZS0yKTsgYm9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lLXNvZnQpOyBib3JkZXItcmFkaXVzOjlweDsgcGFkZGluZzo5cHggMTFweH0KICAucHN0YXQgLnBse2ZvbnQtc2l6ZTo5LjVweDsgbGV0dGVyLXNwYWNpbmc6LjEyZW07IHRleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTsgY29sb3I6dmFyKC0taW5rLTMpOyBmb250LXdlaWdodDo3MDB9CiAgLnBzdGF0IC5wdntmb250LWZhbWlseToiT3N3YWxkIjsgZm9udC13ZWlnaHQ6NzAwOyBmb250LXNpemU6MjJweDsgbWFyZ2luLXRvcDoycHh9CiAgLnBjb2xze2Rpc3BsYXk6Z3JpZDsgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOjFmciAxZnI7IGdhcDoxOHB4fQogIEBtZWRpYSAobWF4LXdpZHRoOjYyMHB4KXsgLnBjb2xze2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnI7IGdhcDoycHh9IH0KICAucHNlbHt3aWR0aDoxMDAlOyBiYWNrZ3JvdW5kOnZhcigtLXN1cmZhY2UtMik7IGNvbG9yOnZhcigtLWluayk7IGJvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSk7IGJvcmRlci1yYWRpdXM6OHB4OyBwYWRkaW5nOjhweCAxMHB4OyBmb250OmluaGVyaXQ7IGZvbnQtc2l6ZToxM3B4OyBtYXJnaW46MnB4IDAgOHB4fQogIC5wY2hhcnQgLnNwYXJre3dpZHRoOjEwMCU7IGhlaWdodDphdXRvOyBkaXNwbGF5OmJsb2NrOyBiYWNrZ3JvdW5kOnZhcigtLXN1cmZhY2UtMik7IGJvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZS1zb2Z0KTsgYm9yZGVyLXJhZGl1czo5cHg7IHBhZGRpbmc6NHB4fQogIC5zcGFyayBwYXRoe3N0cm9rZS1saW5lam9pbjpyb3VuZDsgc3Ryb2tlLWxpbmVjYXA6cm91bmR9CiAgLnNwYXJrIGNpcmNsZXtmaWxsOnZhcigtLWMpfQogIC5zcGFyayAuYXhse2ZpbGw6dmFyKC0taW5rLTMpOyBmb250LXNpemU6OHB4OyBmb250LWZhbWlseToiQXJjaGl2byJ9CiAgLnByYW5nZXtkaXNwbGF5OmZsZXg7IGp1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuOyBmb250LXNpemU6MTFweDsgY29sb3I6dmFyKC0taW5rLTMpOyBtYXJnaW4tdG9wOjVweH0KICAucHJhbmdlIHNwYW46Zmlyc3QtY2hpbGR7Y29sb3I6dmFyKC0taW5rLTIpOyBmb250LXdlaWdodDo3MDA7IGZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtc30KICAucGRheXtiYWNrZ3JvdW5kOnZhcigtLXN1cmZhY2UtMik7IGJvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZS1zb2Z0KTsgYm9yZGVyLXJhZGl1czo5cHg7IHBhZGRpbmc6NHB4IDEycHggMTBweH0KICAuY2hhc2V7YmFja2dyb3VuZDpjb2xvci1taXgoaW4gb2tsYWIsdmFyKC0tYmFkKSA5JSx2YXIoLS1zdXJmYWNlKSk7IGJvcmRlcjoxcHggc29saWQgY29sb3ItbWl4KGluIG9rbGFiLHZhcigtLWJhZCkgMzIlLHZhcigtLWxpbmUpKTsgYm9yZGVyLXJhZGl1czoxMnB4OyBwYWRkaW5nOjE1cHggMTZweDsgbWFyZ2luLXRvcDoxNnB4fQogIC5jaGFzZSBoM3tmb250LWZhbWlseToiT3N3YWxkIjsgZm9udC13ZWlnaHQ6NjAwOyB0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7IGxldHRlci1zcGFjaW5nOi4wM2VtOyBmb250LXNpemU6MTZweDsgbWFyZ2luOjAgMCA0cHg7IGNvbG9yOnZhcigtLWJhZCl9CiAgLmNoYXNlIHB7bWFyZ2luOjAgMCA5cHg7IGZvbnQtc2l6ZToxM3B4OyBjb2xvcjp2YXIoLS1pbmstMik7IGxpbmUtaGVpZ2h0OjEuNX0KICAuY2hpcHN7ZGlzcGxheTpmbGV4OyBnYXA6N3B4OyBmbGV4LXdyYXA6d3JhcDsgYWxpZ24taXRlbXM6Y2VudGVyfQogIC5jaGlwe2ZvbnQtc2l6ZToxMi41cHg7IGZvbnQtd2VpZ2h0OjYwMDsgYmFja2dyb3VuZDp2YXIoLS1zdXJmYWNlKTsgYm9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTsgYm9yZGVyLXJhZGl1czo5OTlweDsgcGFkZGluZzo1cHggMTFweH0KICAuY2hpcCAuentjb2xvcjp2YXIoLS1iYWQpOyBmb250LXdlaWdodDo4MDB9IC5jaGlwIC5ze2NvbG9yOnZhcigtLXdhcm4pOyBmb250LXdlaWdodDo4MDB9CiAgLm1vcmV7Zm9udC1zaXplOjEycHg7IGNvbG9yOnZhcigtLWluay0zKX0KICBmb290ZXJ7bWFyZ2luLXRvcDozNHB4OyBib3JkZXItdG9wOjFweCBzb2xpZCB2YXIoLS1saW5lKTsgcGFkZGluZy10b3A6MTZweDsgY29sb3I6dmFyKC0taW5rLTMpOyBmb250LXNpemU6MTIuNXB4OyBsaW5lLWhlaWdodDoxLjZ9CiAgZm9vdGVyIGJ7Y29sb3I6dmFyKC0taW5rLTIpfQogIC5oYXJke2ZvbnQtZmFtaWx5OiJPc3dhbGQiOyBmb250LXdlaWdodDo3MDA7IGxldHRlci1zcGFjaW5nOi4wNmVtOyB0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7IGNvbG9yOnZhcigtLWluay0yKTsgZm9udC1zaXplOjE0cHg7IG1hcmdpbi10b3A6MTBweH0KPC9zdHlsZT48L2hlYWQ+PGJvZHk+CjxkaXYgY2xhc3M9IndyYXAiPgogIDxkaXYgY2xhc3M9InRvcCI+CiAgICA8ZGl2IGNsYXNzPSJsb2dvIj48Yj5GVFg8L2I+IEhZQlJJRCBBVEhMRVRJQ1M8L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImNyZWVkIj4xJSBCZXR0ZXIgRXZlcnkgRGF5PC9kaXY+CiAgPC9kaXY+CiAgPGRpdiBjbGFzcz0ic3dpdGNoIiByb2xlPSJ0YWJsaXN0IiBpZD0ic3dpdGNoIj48L2Rpdj4KICA8ZGl2IGlkPSJwYW5lbCI+PC9kaXY+CiAgPGZvb3Rlcj4KICAgIDxiPlJlYWwgZGF0YTwvYj4g4oCUIHB1bGxlZCBmcm9tIHRoZSBGVFggYWNjb3VudCBuaWdodGx5LCBldmVyeSBsb2dnZWQgd29ya291dCBzaW5jZSBKYW4gMSwgMjAyNi4gQSAid29ya291dCIgaXMgb25lIGZ1bGwgdHJhaW5pbmcgZGF5LiBUYXAgYW55IG5hbWUgZm9yIGxpZnRzLCBydW5zLCBzdHJlYWtzIGFuZCB0cmVuZHMuCiAgICA8ZGl2IGNsYXNzPSJoYXJkIj5Ob2JvZHkgY2FyZXMuIFdvcmsgaGFyZGVyLjwvZGl2PgogIDwvZm9vdGVyPgo8L2Rpdj4KPHNjcmlwdD4KY29uc3QgTUVUQSA9IHsKICBBVEhFTkE6ICAgICAgeyBhY2NlbnQ6J3ZhcigtLWFtYmVyKScsIHRhZzoiV29tZW4ncyBIWVJPWCDigJQgV2lzZG9tIMK3IFN0cmF0ZWd5IMK3IERpc2NpcGxpbmUgwrcgTWFzdGVyeSIgfSwKICBNQVZFUklDSzogICAgeyBhY2NlbnQ6J3ZhcigtLXJlZCknLCAgIHRhZzoiTWVuJ3MgaW52aXRhdGlvbi1vbmx5IiB9LAogIEhZUk9YOiAgICAgICB7IGFjY2VudDondmFyKC0tYmx1ZSknLCAgdGFnOiJIWVJPWCByYWNlIHByb2dyYW0iIH0sCiAgSFlST1hPTkxJTkU6IHsgYWNjZW50OicjMkNBNkI4JywgbGFiZWw6J0h5cm94IE9ubGluZScsIHRhZzoiT25saW5lIEhZUk9YIGNvYWNoaW5nIiB9LAogIEhZQlJJRDogICAgICB7IGFjY2VudDonbGluZWFyLWdyYWRpZW50KDkwZGVnLHZhcigtLXJlZCksdmFyKC0tYmx1ZSkpJywgYWNjZW50U29saWQ6J3ZhcigtLWJsdWUpJywgdGFnOiJIeWJyaWQgc3RyZW5ndGggKyBlbmdpbmUgdHJhY2siIH0KfTsKY29uc3QgT1JERVIgPSBbJ0FUSEVOQScsJ01BVkVSSUNLJywnSFlST1gnLCdIWVJPWE9OTElORScsJ0hZQlJJRCddOwpjb25zdCBsYWJlbCA9IGcgPT4gKE1FVEFbZ10gJiYgTUVUQVtnXS5sYWJlbCkgPyBNRVRBW2ddLmxhYmVsIDogZzsKY29uc3QgY2FjaGUgPSB7fTsKY29uc3QgZXNjID0gcyA9PiBTdHJpbmcocykucmVwbGFjZSgvWyY8Pl0vZyxjPT4oeycmJzonJmFtcDsnLCc8JzonJmx0OycsJz4nOicmZ3Q7J31bY10pKTsKZnVuY3Rpb24gc3RhdHVzT2Yodyl7IGlmKHc9PT0wKSByZXR1cm4gWydOb3QgbG9nZ2luZycsJ3AtZ2hvc3QnXTsgaWYodzwyMCkgcmV0dXJuIFsnU2xpcHBpbmcnLCdwLXNsaXAnXTsgaWYodzw2MCkgcmV0dXJuIFsnU29saWQnLCdwLXNvbGlkJ107IHJldHVybiBbJ1N0cm9uZycsJ3Atc3Ryb25nJ107IH0KY29uc3QgUlVOX1JFID0gL1xicnVuXGJ8cnVubmluZ3xcZCtccz9rP21ccypydW58XGQrXHM/bVxzKnJ1bnxcYnNraVxifFxicm93XGJ8XGJlcmdcYi9pOwpmdW5jdGlvbiBmbXRUaW1lKHMpeyBzPU1hdGgucm91bmQocyk7IGNvbnN0IG09TWF0aC5mbG9vcihzLzYwKSwgcj1zJTYwOyByZXR1cm4gbSA/IG0rJzonK1N0cmluZyhyKS5wYWRTdGFydCgyLCcwJykgOiBzKydzJzsgfQoKY29uc3Qgc3dFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzd2l0Y2gnKSwgcGFuZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncGFuZWwnKTsKT1JERVIuZm9yRWFjaCgoZyxpKT0+eyBjb25zdCBiPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpOyBiLmNsYXNzTmFtZT0nc3cnOyBiLnR5cGU9J2J1dHRvbic7IGIuc2V0QXR0cmlidXRlKCdyb2xlJywndGFiJyk7IGIudGV4dENvbnRlbnQ9bGFiZWwoZyk7IGIuc2V0QXR0cmlidXRlKCdhcmlhLXNlbGVjdGVkJyxpPT09MD8ndHJ1ZSc6J2ZhbHNlJyk7IGIub25jbGljaz0oKT0+c2hvdyhnKTsgc3dFbC5hcHBlbmRDaGlsZChiKTsgfSk7Cgphc3luYyBmdW5jdGlvbiBsb2FkKGcpeyBpZihjYWNoZVtnXSkgcmV0dXJuIGNhY2hlW2ddOyBpZih3aW5kb3cuX19EQVRBX18mJndpbmRvdy5fX0RBVEFfX1tnXSl7IGNhY2hlW2ddPXdpbmRvdy5fX0RBVEFfX1tnXTsgcmV0dXJuIGNhY2hlW2ddOyB9IGNvbnN0IHI9YXdhaXQgZmV0Y2goJ2RhdGEvJytnKycuanNvbicse2NhY2hlOiduby1zdG9yZSd9KTsgY2FjaGVbZ109YXdhaXQgci5qc29uKCk7IHJldHVybiBjYWNoZVtnXTsgfQovLyBTaW5nbGUtZ3JvdXAgbW9kZTogP2c9YXRoZW5hIHNob3dzIG9ubHkgdGhhdCBncm91cCAobm8gc3dpdGNoZXIpIOKAlCB0aGUgcGVyLWdyb3VwIGxpbmsuCmNvbnN0IG9ubHkgPSAod2luZG93Ll9fT05MWV9fIHx8IG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ2cnKSB8fCAnJykudG9VcHBlckNhc2UoKS5yZXBsYWNlKC9bXkEtWl0vZywnJyk7CmFzeW5jIGZ1bmN0aW9uIHNob3coZyl7CiAgY29uc3QgbWV0YT1NRVRBW2ddOyBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc3R5bGUuc2V0UHJvcGVydHkoJy0tYWNjZW50JywgbWV0YS5hY2NlbnQpOwogIFsuLi5zd0VsLmNoaWxkcmVuXS5mb3JFYWNoKChiLGkpPT57IGNvbnN0IG9uPU9SREVSW2ldPT09ZzsgYi5zZXRBdHRyaWJ1dGUoJ2FyaWEtc2VsZWN0ZWQnLG9uPyd0cnVlJzonZmFsc2UnKTsgYi5zdHlsZS5iYWNrZ3JvdW5kPW9uPyhtZXRhLmFjY2VudFNvbGlkfHxtZXRhLmFjY2VudCk6Jyc7IH0pOwogIHBhbmVsLmlubmVySFRNTD0nPGRpdiBjbGFzcz0icGVuZCIgc3R5bGU9ImJvcmRlcjowIj5Mb2FkaW5nICcrZysn4oCmPC9kaXY+JzsKICBsZXQgZDsgdHJ5eyBkPWF3YWl0IGxvYWQoZyk7IH1jYXRjaChlKXsgcGFuZWwuaW5uZXJIVE1MPSc8ZGl2IGNsYXNzPSJjaGFzZSI+PGgzPkRhdGEgbm90IGZvdW5kPC9oMz48cD5Db3VsZCBub3QgbG9hZCBkYXRhLycrZysnLmpzb24uPC9wPjwvZGl2Pic7IHJldHVybjsgfQogIHJlbmRlcihnLCBtZXRhLCBkKTsKfQoKbGV0IFZJRVcgPSBbXTsgICAvLyBtZW1iZXJzIGN1cnJlbnRseSByZW5kZXJlZCAoYWxpZ25lZCB0byBkYXRhLWlkeCkKCmZ1bmN0aW9uIHJlbmRlcihnLCBtZXRhLCBkKXsKICBjb25zdCBhY3RpdmU9ZC5tZW1iZXJzLmZpbHRlcihtPT5tLnc+MCksIHNsaXA9ZC5tZW1iZXJzLmZpbHRlcihtPT5tLnc+MCYmbS53PDIwKTsKICBjb25zdCB6ZXJvcz1kLnRvdGFsLWFjdGl2ZS5sZW5ndGgsIHJhdGU9ZC50b3RhbD9NYXRoLnJvdW5kKGFjdGl2ZS5sZW5ndGgvZC50b3RhbCoxMDApOjAsIHRvdGFsVz1kLm1lbWJlcnMucmVkdWNlKChzLG0pPT5zK20udywwKSwgdG9wPWFjdGl2ZVswXTsKICBjb25zdCBOTT1sYWJlbChnKTsgVklFVz1hY3RpdmU7CiAgbGV0IGg9YDxkaXYgY2xhc3M9Im5hbWVwbGF0ZSI+PGRpdiBjbGFzcz0iZ2hvc3QiPiR7Tk1bMF19PC9kaXY+PGRpdiBjbGFzcz0iZXllYnJvdyI+RlRYIMK3ICR7ZC50b3RhbH0gbWVtYmVycyDCtyAke2VzYyhkLndpbmRvd3x8JycpfTwvZGl2PjxoMT4ke2VzYyhOTSl9PC9oMT48ZGl2IGNsYXNzPSJ0YWciPiR7ZXNjKG1ldGEudGFnKX08L2Rpdj48L2Rpdj5gOwogIGgrPSc8ZGl2IGNsYXNzPSJrcGlzIj4nCiAgICArYDxkaXYgY2xhc3M9ImtwaSBoaSI+PGRpdiBjbGFzcz0ibCI+TG9nZ2luZzwvZGl2PjxkaXYgY2xhc3M9InYgdG51bSI+JHthY3RpdmUubGVuZ3RofTxzbWFsbD4gLyAke2QudG90YWx9PC9zbWFsbD48L2Rpdj48L2Rpdj5gCiAgICArYDxkaXYgY2xhc3M9ImtwaSBoaSI+PGRpdiBjbGFzcz0ibCI+RW5nYWdlbWVudDwvZGl2PjxkaXYgY2xhc3M9InYgdG51bSI+JHtyYXRlfTxzbWFsbD4lPC9zbWFsbD48L2Rpdj48L2Rpdj5gCiAgICArYDxkaXYgY2xhc3M9ImtwaSI+PGRpdiBjbGFzcz0ibCI+RGF5cyB0cmFpbmVkPC9kaXY+PGRpdiBjbGFzcz0idiB0bnVtIj4ke3RvdGFsV308L2Rpdj48L2Rpdj5gCiAgICArYDxkaXYgY2xhc3M9ImtwaSI+PGRpdiBjbGFzcz0ibCI+TGVhZGVyPC9kaXY+PGRpdiBjbGFzcz0idiB0bnVtIj4ke3RvcD90b3AudzowfTxzbWFsbD4gJHt0b3A/ZXNjKHRvcC5uLnNwbGl0KCcgJylbMF0pOicnfTwvc21hbGw+PC9kaXY+PC9kaXY+YAogICAgKyc8L2Rpdj4nOwogIGlmKHRvcCkgaCs9YDxkaXYgY2xhc3M9ImNhbGxvdXQiPjxiIGNsYXNzPSJlbSI+JHtlc2ModG9wLm4pfTwvYj48c3Bhbj50b3BzICR7ZXNjKE5NKX0g4oCUIDxiPiR7dG9wLnd9PC9iPiB0cmFpbmluZyBkYXlzJHt0b3AuYz9gIMK3IDxiPiR7dG9wLmN9PC9iPiBjYXJlZXJgOicnfS48L3NwYW4+PC9kaXY+YDsKICBoKz1gPGRpdiBjbGFzcz0ic2VjaGVhZCI+PGgyPiR7ZXNjKE5NKX0gQm9hcmQ8L2gyPjxkaXYgY2xhc3M9ImNhcCI+cmFua2VkIMK3ICR7ZXNjKGQud2luZG93fHwnJyl9PC9kaXY+PC9kaXY+PHAgY2xhc3M9InRhcCI+VGFwIGFuIGF0aGxldGUgZm9yIHRoZWlyIHByb2ZpbGUg4pa+PC9wPjxkaXYgY2xhc3M9ImJvYXJkIj5gOwogIGFjdGl2ZS5mb3JFYWNoKChtLGkpPT57IGNvbnN0IFtsYmwsY2xzXT1zdGF0dXNPZihtLncpOyBjb25zdCBsZWFkPWk9PT0wPycgbGVhZCc6Jyc7CiAgICBjb25zdCBzdHJrID0gKG0uc3RyZWFrJiZtLnN0cmVhaz4xKT9gIDxzcGFuIGNsYXNzPSJwaWxsIHN0cmsiPvCflKUgJHttLnN0cmVha308L3NwYW4+YDonJzsKICAgIGgrPWA8ZGV0YWlscyBjbGFzcz0iaXRlbSR7bGVhZH0iIGRhdGEtaWR4PSIke2l9Ij48c3VtbWFyeSBjbGFzcz0icm93Ij48ZGl2IGNsYXNzPSJyayI+JHtpKzF9PC9kaXY+PGRpdiBjbGFzcz0ibm0iPiR7ZXNjKG0ubil9IDxzcGFuIGNsYXNzPSJwaWxsICR7Y2xzfSI+JHtsYmx9PC9zcGFuPiR7c3Rya308L2Rpdj48ZGl2IGNsYXNzPSJ3ayB0bnVtIj4ke20ud30gPHNtYWxsPkRBWVM8L3NtYWxsPjwvZGl2PjxkaXYgY2xhc3M9ImNhcmVlciB0bnVtIj4ke20uYz9gPGI+JHttLmN9PC9iPiBjYXJlZXJgOicnfTwvZGl2PjxzcGFuIGNsYXNzPSJjaGV2Ij7ilr48L3NwYW4+PC9zdW1tYXJ5PjxkaXYgY2xhc3M9ImRldGFpbCI+PGRpdiBjbGFzcz0icGVuZCIgc3R5bGU9ImJvcmRlcjowIj5PcGVuaW5nIHByb2ZpbGXigKY8L2Rpdj48L2Rpdj48L2RldGFpbHM+YDsKICB9KTsKICBoKz0nPC9kaXY+JzsKICBjb25zdCBuYW1lZFplcm9zID0gKGQuemVyb3NOYW1lZCYmZC56ZXJvc05hbWVkLmxlbmd0aCk/ZC56ZXJvc05hbWVkOmQubWVtYmVycy5maWx0ZXIobT0+bS53PT09MCkubWFwKG09Pm0ubik7CiAgaCs9YDxkaXYgY2xhc3M9ImNoYXNlIj48aDM+Q2hhc2UgbGlzdCDigJQgJHtzbGlwLmxlbmd0aCt6ZXJvc30gbmVlZCBhIG51ZGdlPC9oMz48cD4ke3plcm9zfSBoYXZlbid0IGxvZ2dlZCBhIHdvcmtvdXQke3NsaXAubGVuZ3RoP2AsICR7c2xpcC5sZW5ndGh9IHNsaXBwaW5nICh1bmRlciAyMCBkYXlzKWA6Jyd9LiBTdGFydCBoZXJlLjwvcD48ZGl2IGNsYXNzPSJjaGlwcyI+YDsKICBzbGlwLmZvckVhY2gobT0+eyBoKz1gPHNwYW4gY2xhc3M9ImNoaXAiPjxzcGFuIGNsYXNzPSJzIj4ke20ud308L3NwYW4+IMK3ICR7ZXNjKG0ubil9PC9zcGFuPmA7IH0pOwogIG5hbWVkWmVyb3Muc2xpY2UoMCw4KS5mb3JFYWNoKG49PnsgaCs9YDxzcGFuIGNsYXNzPSJjaGlwIj48c3BhbiBjbGFzcz0ieiI+MDwvc3Bhbj4gwrcgJHtlc2Mobil9PC9zcGFuPmA7IH0pOwogIGNvbnN0IHNob3duPU1hdGgubWluKG5hbWVkWmVyb3MubGVuZ3RoLDgpOyBpZih6ZXJvcz5zaG93bikgaCs9YDxzcGFuIGNsYXNzPSJtb3JlIj4rJHt6ZXJvcy1zaG93bn0gbW9yZSBub3QgbG9nZ2luZzwvc3Bhbj5gOwogIGgrPSc8L2Rpdj4nOyBwYW5lbC5pbm5lckhUTUw9aDsKICAvLyBsYXp5LWJ1aWxkIGVhY2ggcHJvZmlsZSB0aGUgZmlyc3QgdGltZSBpdHMgcm93IGlzIG9wZW5lZAogIHBhbmVsLnF1ZXJ5U2VsZWN0b3JBbGwoJ2RldGFpbHMuaXRlbScpLmZvckVhY2goZGV0PT57CiAgICBkZXQuYWRkRXZlbnRMaXN0ZW5lcigndG9nZ2xlJywgKCk9PnsgaWYoZGV0Lm9wZW4gJiYgIWRldC5kYXRhc2V0LmJ1aWx0KXsgZGV0LmRhdGFzZXQuYnVpbHQ9JzEnOyBidWlsZFByb2ZpbGUoZGV0LnF1ZXJ5U2VsZWN0b3IoJy5kZXRhaWwnKSwgVklFV1srZGV0LmRhdGFzZXQuaWR4XSk7IH0gfSk7CiAgfSk7Cn0KCi8vIC0tLS0gcHJvZmlsZSAtLS0tCmZ1bmN0aW9uIHRvcExpZnRzKGhpc3QpewogIGNvbnN0IGJlc3Q9e307CiAgaGlzdC5mb3JFYWNoKHM9PnMubW92ZXMuZm9yRWFjaChtdj0+eyBpZihtdi53ZWlnaHQ+MCAmJiAhUlVOX1JFLnRlc3QobXYubmFtZSkpeyBjb25zdCBrPW12Lm5hbWU7IGlmKCFiZXN0W2tdfHxtdi53ZWlnaHQ+YmVzdFtrXS53ZWlnaHQpIGJlc3Rba109e25hbWU6bXYubmFtZSx3ZWlnaHQ6bXYud2VpZ2h0LGRhdGU6cy5kYXRlfTsgfSB9KSk7CiAgcmV0dXJuIE9iamVjdC52YWx1ZXMoYmVzdCkuc29ydCgoYSxiKT0+Yi53ZWlnaHQtYS53ZWlnaHQpLnNsaWNlKDAsNik7Cn0KZnVuY3Rpb24gZmFzdFJ1bnMoaGlzdCl7CiAgY29uc3QgYmVzdD17fTsKICBoaXN0LmZvckVhY2gocz0+cy5tb3Zlcy5mb3JFYWNoKG12PT57IGlmKG12LnRpbWU+MCAmJiBSVU5fUkUudGVzdChtdi5uYW1lKSl7IGNvbnN0IGs9bXYubmFtZTsgaWYoIWJlc3Rba118fG12LnRpbWU8YmVzdFtrXS50aW1lKSBiZXN0W2tdPXtuYW1lOm12Lm5hbWUsdGltZTptdi50aW1lLGRhdGU6cy5kYXRlfTsgfSB9KSk7CiAgcmV0dXJuIE9iamVjdC52YWx1ZXMoYmVzdCkuc29ydCgoYSxiKT0+YS50aW1lLWIudGltZSkuc2xpY2UoMCw2KTsKfQpmdW5jdGlvbiBtb3ZlbWVudExpc3QoaGlzdCl7CiAgY29uc3QgY250PXt9OwogIGhpc3QuZm9yRWFjaChzPT57IGNvbnN0IHNlZW49bmV3IFNldCgpOyBzLm1vdmVzLmZvckVhY2gobXY9PnsgaWYoc2Vlbi5oYXMobXYubmFtZSkpcmV0dXJuOyBzZWVuLmFkZChtdi5uYW1lKTsgaWYobXYud2VpZ2h0PjAgfHwgKG12LnRpbWU+MCYmUlVOX1JFLnRlc3QobXYubmFtZSkpKSBjbnRbbXYubmFtZV09KGNudFttdi5uYW1lXXx8MCkrMTsgfSk7IH0pOwogIHJldHVybiBPYmplY3QuZW50cmllcyhjbnQpLmZpbHRlcigoWyxuXSk9Pm4+PTIpLm1hcCgoW25hbWUsbl0pPT4oe25hbWUsbn0pKS5zb3J0KChhLGIpPT5iLm4tYS5uKS5zbGljZSgwLDI0KTsKfQpmdW5jdGlvbiBtb3ZlbWVudFNlcmllcyhoaXN0LCBuYW1lKXsKICBjb25zdCBydW49UlVOX1JFLnRlc3QobmFtZSk7IGNvbnN0IHB0cz1bXTsKICBbLi4uaGlzdF0ucmV2ZXJzZSgpLmZvckVhY2gocz0+eyBsZXQgdj0wOyBzLm1vdmVzLmZvckVhY2gobXY9PnsgaWYobXYubmFtZT09PW5hbWUpeyB2ID0gcnVuID8gKG12LnRpbWV8fHZ8fDApIDogTWF0aC5tYXgodiwgbXYud2VpZ2h0fHwwKTsgfSB9KTsgaWYodj4wKSBwdHMucHVzaCh7ZGF0ZTpzLmRhdGUsIHZhbHVlOnZ9KTsgfSk7CiAgcmV0dXJuIHsgcHRzLCBydW4gfTsKfQpmdW5jdGlvbiBzdmdTZXJpZXMoc2VyaWVzKXsKICBjb25zdCB7cHRzLCBydW59PXNlcmllczsKICBpZihwdHMubGVuZ3RoPDIpIHJldHVybiBgPGRpdiBjbGFzcz0icGVuZCIgc3R5bGU9ImJvcmRlcjowIj48ZW0+Tm90IGVub3VnaCBkYXRhIHRvIHRyZW5kIHlldDwvZW0+IOKAlCAke3B0cy5sZW5ndGh9IGxvZ2dlZCBwb2ludCR7cHRzLmxlbmd0aD09PTE/Jyc6J3MnfS48L2Rpdj5gOwogIGNvbnN0IFc9MzIwLEg9MTIwLFBMPTgsUFI9OCxQVD0xMCxQQj0xNjsKICBjb25zdCB5cz1wdHMubWFwKHA9PnAudmFsdWUpLCB5bWluPU1hdGgubWluKC4uLnlzKSwgeW1heD1NYXRoLm1heCguLi55cyksIHlyPSh5bWF4LXltaW4pfHwxOwogIGNvbnN0IFg9aT0+IFBMICsgKGkvKHB0cy5sZW5ndGgtMSkpKihXLVBMLVBSKTsKICBjb25zdCBZPXY9PiBQVCArICgxLSh2LXltaW4pL3lyKSooSC1QVC1QQik7CiAgY29uc3QgZD1wdHMubWFwKChwLGkpPT4oaT8nTCc6J00nKStYKGkpLnRvRml4ZWQoMSkrJyAnK1kocC52YWx1ZSkudG9GaXhlZCgxKSkuam9pbignICcpOwogIGNvbnN0IGRvdHM9cHRzLm1hcCgocCxpKT0+YDxjaXJjbGUgY3g9IiR7WChpKS50b0ZpeGVkKDEpfSIgY3k9IiR7WShwLnZhbHVlKS50b0ZpeGVkKDEpfSIgcj0iMi4xIi8+YCkuam9pbignJyk7CiAgY29uc3QgZmlyc3Q9cHRzWzBdLCBsYXN0PXB0c1twdHMubGVuZ3RoLTFdOwogIGNvbnN0IGZtdD12PT4gcnVuPyBmbXRUaW1lKHYpIDogdi50b0xvY2FsZVN0cmluZygpOwogIGNvbnN0IGltcHJvdmVkID0gcnVuID8gbGFzdC52YWx1ZTw9Zmlyc3QudmFsdWUgOiBsYXN0LnZhbHVlPj1maXJzdC52YWx1ZTsKICBjb25zdCBjb2wgPSBpbXByb3ZlZCA/ICd2YXIoLS1nb29kKScgOiAndmFyKC0td2FybiknOwogIHJldHVybiBgPHN2ZyB2aWV3Qm94PSIwIDAgJHtXfSAke0h9IiBjbGFzcz0ic3BhcmsiIHN0eWxlPSItLWM6JHtjb2x9IiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIj48cGF0aCBkPSIke2R9IiBmaWxsPSJub25lIiBzdHJva2U9InZhcigtLWMpIiBzdHJva2Utd2lkdGg9IjIiLz4ke2RvdHN9PHRleHQgeD0iJHtQTH0iIHk9IiR7SC0zfSIgY2xhc3M9ImF4bCI+JHtlc2MoZmlyc3QuZGF0ZS5zbGljZSg1KSl9PC90ZXh0Pjx0ZXh0IHg9IiR7Vy1QUn0iIHk9IiR7SC0zfSIgdGV4dC1hbmNob3I9ImVuZCIgY2xhc3M9ImF4bCI+JHtlc2MobGFzdC5kYXRlLnNsaWNlKDUpKX08L3RleHQ+PC9zdmc+PGRpdiBjbGFzcz0icHJhbmdlIj48c3Bhbj4ke2ZtdCh5bWluKX0g4oCTICR7Zm10KHltYXgpfTwvc3Bhbj48c3Bhbj4ke3B0cy5sZW5ndGh9IHNlc3Npb25zIMK3ICR7cnVuPydsb3dlciA9IGZhc3Rlcic6J2hpZ2hlciA9IGhlYXZpZXInfTwvc3Bhbj48L2Rpdj5gOwp9CmZ1bmN0aW9uIHJlbmRlclNlc3Npb24ocyl7CiAgaWYoIXMpIHJldHVybiAnJzsKICByZXR1cm4gYDxkaXYgY2xhc3M9ImRoMiI+JHtlc2Mocy5kYXRlKX0ke3MudGl0bGU/JyDCtyAnK2VzYyhzLnRpdGxlKTonJ308L2Rpdj5gICsgcy5tb3Zlcy5tYXAobXY9PnsgY29uc3Qgcj1bXTsgaWYobXYucmVwcylyLnB1c2gobXYucmVwcysnIHJlcHMnKTsgaWYobXYud2VpZ2h0KXIucHVzaChtdi53ZWlnaHQudG9Mb2NhbGVTdHJpbmcoKSsnIGxiJyk7IGlmKG12LnRpbWUpci5wdXNoKGZtdFRpbWUobXYudGltZSkpOyByZXR1cm4gYDxkaXYgY2xhc3M9InNwbGl0cm93Ij48c3Bhbj4ke2VzYyhtdi5uYW1lKX08L3NwYW4+PHNwYW4gY2xhc3M9InZ2Ij4ke2VzYyhyLmpvaW4oJyDCtyAnKXx8J2xvZ2dlZCcpfTwvc3Bhbj48L2Rpdj5gOyB9KS5qb2luKCcnKTsKfQpmdW5jdGlvbiBidWlsZFByb2ZpbGUoYm94LCBtKXsKICBib3guaW5uZXJIVE1MPScnOyBpZighbSkgcmV0dXJuOwogIGNvbnN0IGhpc3Q9KG0uaGlzdHx8W10pLmZpbHRlcihzPT5zJiZzLm1vdmVzKTsKICBjb25zdCBzdGF0PShsLHYpPT5gPGRpdiBjbGFzcz0icHN0YXQiPjxkaXYgY2xhc3M9InBsIj4ke2x9PC9kaXY+PGRpdiBjbGFzcz0icHYgdG51bSI+JHt2fTwvZGl2PjwvZGl2PmA7CiAgY29uc3Qgc3RyaXA9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7IHN0cmlwLmNsYXNzTmFtZT0ncHN0cmlwJzsKICBzdHJpcC5pbm5lckhUTUwgPSBzdGF0KCdTdHJlYWsnLChtLnN0cmVha3x8MCkrJ2QnKSArIHN0YXQoJ0RheXMgdHJhaW5lZCcsbS53KSArIHN0YXQoJ1Nlc3Npb25zJyxoaXN0Lmxlbmd0aCkgKyAobS5jP3N0YXQoJ0NhcmVlcicsbS5jKTpzdGF0KCdCZXN0IHN0cmVhaycsJ+KAlCcpKTsKICBib3guYXBwZW5kQ2hpbGQoc3RyaXApOwogIGlmKCFoaXN0Lmxlbmd0aCl7IGNvbnN0IHA9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7IHAuY2xhc3NOYW1lPSdwZW5kJzsgcC5pbm5lckhUTUw9JzxlbT5ObyBkZXRhaWxlZCBoaXN0b3J5IGluIHRoaXMgd2luZG93IHlldC48L2VtPiBJdCBmaWxscyBpbiBhcyB3b3Jrb3V0cyBhcmUgbG9nZ2VkLic7IGJveC5hcHBlbmRDaGlsZChwKTsgcmV0dXJuOyB9CgogIGNvbnN0IGNvbHM9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7IGNvbHMuY2xhc3NOYW1lPSdwY29scyc7CiAgY29uc3QgbGlmdHM9dG9wTGlmdHMoaGlzdCksIHJ1bnM9ZmFzdFJ1bnMoaGlzdCk7CiAgY29scy5pbm5lckhUTUwgPQogICAgYDxkaXY+PGRpdiBjbGFzcz0iZGgiPlRvcCBsaWZ0czwvZGl2PiR7bGlmdHMubGVuZ3RoP2xpZnRzLm1hcChwPT5gPGRpdiBjbGFzcz0ic3BsaXRyb3ciPjxzcGFuPiR7ZXNjKHAubmFtZSl9PC9zcGFuPjxzcGFuIGNsYXNzPSJ2diI+JHtwLndlaWdodC50b0xvY2FsZVN0cmluZygpfSBsYjxzbWFsbCBzdHlsZT0ib3BhY2l0eTouNTUiPiDCtyAke2VzYyhwLmRhdGUpfTwvc21hbGw+PC9zcGFuPjwvZGl2PmApLmpvaW4oJycpOic8ZGl2IGNsYXNzPSJwZW5kIiBzdHlsZT0iYm9yZGVyOjAiPjxlbT5ObyB3ZWlnaHRlZCBsaWZ0cyBsb2dnZWQuPC9lbT48L2Rpdj4nfTwvZGl2PmAKICArIGA8ZGl2PjxkaXYgY2xhc3M9ImRoIj5GYXN0ZXN0IHJ1bnM8L2Rpdj4ke3J1bnMubGVuZ3RoP3J1bnMubWFwKHA9PmA8ZGl2IGNsYXNzPSJzcGxpdHJvdyI+PHNwYW4+JHtlc2MocC5uYW1lKX08L3NwYW4+PHNwYW4gY2xhc3M9InZ2Ij4ke2ZtdFRpbWUocC50aW1lKX08c21hbGwgc3R5bGU9Im9wYWNpdHk6LjU1Ij4gwrcgJHtlc2MocC5kYXRlKX08L3NtYWxsPjwvc3Bhbj48L2Rpdj5gKS5qb2luKCcnKTonPGRpdiBjbGFzcz0icGVuZCIgc3R5bGU9ImJvcmRlcjowIj48ZW0+Tm8gdGltZWQgcnVucyBsb2dnZWQuPC9lbT48L2Rpdj4nfTwvZGl2PmA7CiAgYm94LmFwcGVuZENoaWxkKGNvbHMpOwoKICBjb25zdCBtb3Zlcz1tb3ZlbWVudExpc3QoaGlzdCk7CiAgaWYobW92ZXMubGVuZ3RoKXsKICAgIGNvbnN0IHdyYXA9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7CiAgICBjb25zdCBzZWw9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2VsZWN0Jyk7IHNlbC5jbGFzc05hbWU9J3BzZWwnOwogICAgbW92ZXMuZm9yRWFjaChtbz0+eyBjb25zdCBvPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ29wdGlvbicpOyBvLnZhbHVlPW1vLm5hbWU7IG8udGV4dENvbnRlbnQ9YCR7bW8ubmFtZX0gICgke21vLm59KWA7IHNlbC5hcHBlbmRDaGlsZChvKTsgfSk7CiAgICBjb25zdCBjaGFydD1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgY2hhcnQuY2xhc3NOYW1lPSdwY2hhcnQnOwogICAgY29uc3QgZHJhdz0oKT0+eyBjaGFydC5pbm5lckhUTUw9c3ZnU2VyaWVzKG1vdmVtZW50U2VyaWVzKGhpc3QsIHNlbC52YWx1ZSkpOyB9OwogICAgc2VsLmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIGRyYXcpOwogICAgd3JhcC5pbm5lckhUTUw9JzxkaXYgY2xhc3M9ImRoIj5UcmVuZCDigJQgcGljayBhIG1vdmVtZW50PC9kaXY+Jzsgd3JhcC5hcHBlbmRDaGlsZChzZWwpOyB3cmFwLmFwcGVuZENoaWxkKGNoYXJ0KTsKICAgIGJveC5hcHBlbmRDaGlsZCh3cmFwKTsgZHJhdygpOwogIH0KCiAgY29uc3Qgd3JhcFc9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7CiAgY29uc3Qgc2VsVz1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzZWxlY3QnKTsgc2VsVy5jbGFzc05hbWU9J3BzZWwnOwogIGhpc3QuZm9yRWFjaCgocyxpZHgpPT57IGNvbnN0IG89ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnb3B0aW9uJyk7IG8udmFsdWU9aWR4OyBvLnRleHRDb250ZW50PWAke3MuZGF0ZX0ke3MudGl0bGU/JyDCtyAnK3MudGl0bGU6Jyd9YDsgc2VsVy5hcHBlbmRDaGlsZChvKTsgfSk7CiAgY29uc3QgZGF5PWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpOyBkYXkuY2xhc3NOYW1lPSdwZGF5JzsKICBjb25zdCBzaG93RGF5PSgpPT57IGRheS5pbm5lckhUTUw9cmVuZGVyU2Vzc2lvbihoaXN0WytzZWxXLnZhbHVlXSk7IH07CiAgc2VsVy5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCBzaG93RGF5KTsKICB3cmFwVy5pbm5lckhUTUw9JzxkaXYgY2xhc3M9ImRoIj5QcmV2aW91cyB3b3Jrb3V0czwvZGl2Pic7IHdyYXBXLmFwcGVuZENoaWxkKHNlbFcpOyB3cmFwVy5hcHBlbmRDaGlsZChkYXkpOwogIGJveC5hcHBlbmRDaGlsZCh3cmFwVyk7IHNob3dEYXkoKTsKCiAgaWYobS5wcnMmJm0ucHJzLmxlbmd0aCl7IGNvbnN0IHByPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpOyBwci5pbm5lckhUTUw9JzxkaXYgY2xhc3M9ImRoIj5QZXJzb25hbCBiZXN0czwvZGl2PicrbS5wcnMuc2xpY2UoMCw2KS5tYXAocD0+eyBjb25zdCB2PXAud2VpZ2h0P3Aud2VpZ2h0LnRvTG9jYWxlU3RyaW5nKCkrJyBsYic6cC5yZXBzKycgcmVwcyc7IHJldHVybiBgPGRpdiBjbGFzcz0ic3BsaXRyb3ciPjxzcGFuPvCfj4YgJHtlc2MocC5uYW1lKX08L3NwYW4+PHNwYW4gY2xhc3M9InZ2Ij4ke2VzYyh2KX08c21hbGwgc3R5bGU9Im9wYWNpdHk6LjYiPiDCtyAke2VzYyhwLmRhdGUpfTwvc21hbGw+PC9zcGFuPjwvZGl2PmA7IH0pLmpvaW4oJycpOyBib3guYXBwZW5kQ2hpbGQocHIpOyB9Cn0KCmlmIChvbmx5ICYmIE9SREVSLmluY2x1ZGVzKG9ubHkpKSB7IHN3RWwuaGlkZGVuID0gdHJ1ZTsgc2hvdyhvbmx5KTsgfSBlbHNlIHsgc2hvdygnQVRIRU5BJyk7IH0KPC9zY3JpcHQ+PC9ib2R5PjwvaHRtbD4K';

// Bake the static pages from the payloads we just built: one isolated page per group
// (only its own data), one combined coaches page (all groups), and a neutral landing.
async function bakePages(built) {
  let tpl;
  try { tpl = Buffer.from(BOARD_TPL_B64, 'base64').toString('utf8'); }
  catch (e) { console.log(`  ! bake skipped — bad template: ${e.message}`); return; }
  const inject = (scriptObj) => {
    const s = `<script>${Object.entries(scriptObj).map(([k, v]) => `window.${k}=${JSON.stringify(v)};`).join('')}</script>`;
    return tpl.replace('</head>', s + '\n</head>');
  };
  const site = new URL('../site/', import.meta.url);
  const have = GROUP_ORDER.filter(g => built[g]);
  if (!have.length) { console.log('  ! bake skipped — no group data built this run'); return; }
  for (const g of have) {
    await writeFile(new URL(`${g.toLowerCase()}.html`, site), inject({ __ONLY__: g, __DATA__: { [g]: built[g] } }));
  }
  await writeFile(new URL(COACH_FILE, site), inject({ __DATA__: Object.fromEntries(have.map(g => [g, built[g]])) }));
  await writeFile(new URL('index.html', site), `<!doctype html><meta charset="utf-8"><title>FTX Athlete Boards</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#0b0b0c;color:#eee;font:16px/1.6 system-ui;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}h1{letter-spacing:.02em}p{color:#888;max-width:32ch}</style>
<div><h1>FTX HYBRID ATHLETICS</h1><p>Athlete boards are private. Open your group's link to view it.</p></div>`);
  console.log(`  baked ${have.length} group pages + coaches page (${COACH_FILE}) + landing`);
}

function currentStreak(datesISO) {
  const set = new Set(datesISO);
  let streak = 0;
  const d = new Date();
  const iso = x => x.toISOString().slice(0, 10);
  if (!set.has(iso(d))) d.setDate(d.getDate() - 1);
  while (set.has(iso(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

// Resolve THIS group's member user-ids. Tries several sources, logs each, uses
// the first that yields a sane (non-account-wide) id list.
// Returns the raw active-member records for a group (from /api/v3/group_members).
async function resolveMembers(page, gid) {
  return page.evaluate(async (gid) => {
    const log = [];
    const tryGet = async (u) => { try { const r = await fetch(u, { headers: { Accept: 'application/json' } }); const j = r.ok ? await r.json().catch(() => null) : null; return { s: r.status, j }; } catch (e) { return { s: 'ERR', j: null }; } };
    const getArr = (j) => {
      if (!j) return null;
      const arrays = [j.group_members, j.members, j.data, j.clients, j.client, Array.isArray(j) ? j : null];
      for (const a of arrays) if (Array.isArray(a) && a.length) return a;
      return null;
    };
    const sources = [
      `/api/v3/group_members?group_id=${gid}&fetch_all=true`,
      `/api/v3/group_members?f_groupId=${gid}&fetch_all=true`,
      `/api/v3/group_members?group_id=${gid}&per_page=1000`,
    ];
    for (const u of sources) {
      const { s, j } = await tryGet(u);
      const arr = getArr(j);
      log.push(`${u.split('?')[0].slice(-30)} -> ${s}${arr ? ` recs=${arr.length}` : ''}`);
      if (arr && arr.length && arr.length < 1000) return { recs: arr, log };
    }
    return { recs: null, log };
  }, gid);
}

// Keep a membership record only if it looks active. Any explicit end/removal/
// inactive marker drops it; absence of markers = keep.
function isActiveMember(m) {
  if (!m || typeof m !== 'object') return false;
  if (m.active === false || m.is_active === false || m.enabled === false) return false;
  if (m.ended_at || m.deactivated_at || m.removed_at || m.deleted_at || m.left_at || m.cancelled_at || m.canceled_at || m.expired_at || m.archived_at) return false;
  const st = String(m.status || m.membership_status || m.member_status || m.state || '').toLowerCase();
  if (st && ['inactive', 'ended', 'cancelled', 'canceled', 'removed', 'declined', 'expired', 'deleted', 'archived', 'pending', 'invited'].includes(st)) return false;
  return true;
}
function memberUserId(m) {
  return String((m && (m.user_id || (m.user && m.user.id) || m.client_id || m.member_id || m.id)) || '');
}

async function pullAthlete(page, uid, since, tz) {
  return page.evaluate(async ({ uid, since, tz }) => {
    const now = Math.floor(Date.now() / 1000);
    const start = since;
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
    return { loggedDates: [...dates].sort(), recent: sessions[0] || null, history: sessions.slice(0, 200), prs: Object.values(prs).filter(p => p.weight > 0 || p.reps > 0).slice(0, 8), workouts: dates.size, rows };
  }, { uid, since, tz });
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

  // Account roster: everyone + their ids/names, one call.
  const users = await page.evaluate(async () => {
    try { const r = await fetch('/api/v4/users?fetch_all=true', { headers: { Accept: 'application/json' } }); const j = await r.json(); const arr = Array.isArray(j) ? j : (j.users || j.data || []); return arr.map(u => ({ id: String(u.id), first: u.first_name || '', last: u.last_name || '' })); } catch { return []; }
  });
  const byId = new Map(users.map(u => [u.id, u]));
  console.log(`Account roster: ${users.length} users.`);

  // Diagnostic: show one client record so we can see how clients tie to groups.
  const cd = await page.evaluate(async () => {
    try { const r = await fetch('/api/v4/clients?per_page=2000', { headers: { Accept: 'application/json' } }); const j = await r.json(); const arr = j.client || j.clients || j.data || (Array.isArray(j) ? j : []); return { count: arr.length, sample: JSON.stringify(arr[0] || {}).slice(0, 700) }; } catch (e) { return { err: String(e) }; }
  });
  console.log(`Clients endpoint: count=${cd.count}. Sample: ${cd.sample || cd.err}`);

  const perfCache = new Map(); // uid -> perf, so people in multiple groups pull once
  const built = {};            // group -> payload, for baking pages at the end
  await mkdir(new URL('../site/data/', import.meta.url), { recursive: true });

  for (const [name, id] of Object.entries(GROUPS)) {
    console.log(`\n=== ${name} (group ${id}) ===`);
    const { recs, log } = await resolveMembers(page, id);
    for (const l of log) console.log(`   ${l}`);
    if (!recs) { console.log(`  ! ${name}: could not resolve members — skipping (preserving last-good data)`); continue; }
    console.log(`   member fields: [${Object.keys(recs[0]).join(', ')}]`);
    const active = recs.filter(isActiveMember);
    const ids = [...new Set(active.map(memberUserId).filter(Boolean))];
    const roster = ids.map(uid => byId.get(uid)).filter(Boolean)
      .filter(u => (u.first || u.last) && !/ftx hybrid|hybrid athletics/i.test(`${u.first} ${u.last}`.trim()));
    console.log(`  ${name}: ${recs.length} total / ${active.length} active / ${roster.length} on board`);
    if (roster.length === 0 || roster.length >= 1000) { console.log(`  ! ${name}: roster size ${roster.length} looks wrong — skipping`); continue; }

    const members = [], athleteRows = [], resultRows = [];
    for (const u of roster) {
      const uid = +u.id || u.id;
      const m = { n: `${u.first} ${u.last}`.trim(), w: 0, h: '—', uid };
      if (Number.isFinite(uid)) athleteRows.push({ exercise_user_id: uid, first_name: u.first, last_name: u.last, grp: name });
      try {
        let perf = perfCache.get(String(m.uid));
        if (perf === undefined) { perf = await pullAthlete(page, m.uid, SINCE, TZ); perfCache.set(String(m.uid), perf); }
        if (perf) {
          m.w = perf.workouts; m.streak = currentStreak(perf.loggedDates);
          if (perf.recent) m.detail = perf.recent;
          if (perf.history && perf.history.length) m.hist = perf.history;
          if (perf.prs && perf.prs.length) m.prs = perf.prs;
          if (perf.rows && Number.isFinite(uid)) for (const row of perf.rows) resultRows.push({ exercise_user_id: uid, ...row });
        }
      } catch (e) { console.log(`  ! perf failed for ${m.n}: ${e.message}`); }
      try { const c = await page.evaluate(async uid => { const res = await fetch('/api/v4/users/' + uid, { headers: { Accept: 'application/json' } }); if (!res.ok) return null; const j = await res.json(); return j.num_workouts ?? null; }, m.uid); if (c && c > 0) m.c = c; } catch {}
      delete m.uid; members.push(m);
      console.log(`  ${m.n}: ${m.w} logged, streak ${m.streak ?? 0}`);
    }
    members.sort((a, b) => b.w - a.w);
    // de-dupe repeated people (same name, multiple accounts) — keep the most active
    const seen = new Set();
    const deduped = members.filter(m => { const k = m.n.trim().toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
    const payload = { group: name, updated: new Date().toISOString().slice(0, 10), window: 'since Jan 1, 2026', total: deduped.length, members: deduped, zerosNamed: deduped.filter(m => m.w === 0).map(m => m.n).slice(0, 8) };
    await writeFile(new URL(`../site/data/${name}.json`, import.meta.url), JSON.stringify(payload, null, 2));
    built[name] = payload;
    console.log(`  wrote ${deduped.length} members (${deduped.filter(m => m.w > 0).length} logging)`);
    if (SB_ON) { await sbUpsert('athletes', athleteRows, 'exercise_user_id'); await sbUpsert('results', resultRows, 'exercise_user_id,ex_workout_id,exercise_id'); console.log(`  supabase: ${athleteRows.length} athletes, ${resultRows.length} result rows`); }
  }
  await browser.close();
  console.log('\nBaking static pages…');
  await bakePages(built);
  console.log('Done.');
}
main().catch(e => { console.error(e); process.exit(1); });
