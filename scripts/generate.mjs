#!/usr/bin/env node
// Builds every SVG in assets/ (light + dark) from CONTENT plus two live sources: an HTTP ping of
// each live app (30-day history kept in assets/data.json) and last week's GitHub contributions.
// Run daily by .github/workflows/refresh.yml. Locally: GITHUB_TOKEN=$(gh auth token) node scripts/generate.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const LOGIN = 'MagnusMagi';
const ASSETS = new URL('../assets/', import.meta.url);
const HISTORY_DAYS = 30;
const UA = { 'user-agent': `${LOGIN}-profile-readme` };
export const BLURB_CHARS = 50; // tile blurbs must wrap to 3 lines at this width (asserted in the test)
const isoDay = (d) => d.toISOString().slice(0, 10);

export const CONTENT = {
  name: 'Magnus Mägi',
  prompt: 'magnus@tallinn: ~',
  role: 'founder of MagnusGeo, building web products around maps',
  location: 'Tallinn, Estonia · UTC+2 · open to select projects',
  flagship: {
    name: 'MagnusGeo',
    kicker: 'flagship · ranked atlas',
    blurb: 'An independent atlas of competitive GeoGuessr, including the players the ladder never shows.',
    url: 'https://magnusgeo.magnusmagi.com',
    stats: [[1_180_000, 'players crawled'], [6_100_000, 'profile snapshots'], [11, 'leaderboards'], [12, 'crawl jobs']],
    stack: 'Next.js 16 · Postgres · Supabase · TR / EN',
  },
  projects: [
    { id: 'hidenseek', name: 'Hide & Seek', kicker: 'street view multiplayer', live: true, url: 'https://hidenseek.magnusmagi.com',
      blurb: 'Hide a spot on Google Street View, everyone else hunts it on a map. Up to 50 players a room, three modes, 2v2 and a daily challenge.',
      stack: ['Next.js 16', 'Supabase Realtime', 'Street View'] },
    { id: 'cardinal', name: 'Cardinal', kicker: 'find the hidden place', live: true, url: 'https://cardinal.magnusmagi.com',
      blurb: 'A geography guessing game where every guess gives back a distance and a compass bearing. 37 modes across 9 families.',
      stack: ['Vite', 'React', 'TypeScript', 'Supabase'] },
    { id: 'magigeo', name: 'MagiGeo', kicker: 'geoguessr country guide', live: true, url: 'https://geo.magnusmagi.com',
      blurb: '140 countries, 6,110 reference images and 42 clue categories in Turkish and English, with side-by-side compare. Free, no ads.',
      stack: ['Next.js 16', 'Vercel', 'TR · EN'] },
    { id: 'cityshot', name: 'CityShot', kicker: 'photo routes timed to the light', tag: 'iphone · in the works', url: null,
      blurb: 'Plans a walking route through a city\'s best photo spots and tells you the minute to be at each one for golden or blue hour.',
      stack: ['Expo', 'React Native', 'PostGIS'] },
    { id: 'magiwire', name: 'MagiWire', kicker: 'ai news wire', tag: 'open source · mit', url: 'https://github.com/MagnusMagi/Magnus-wire',
      blurb: 'Reads public RSS feeds every 30 minutes, rewrites each item with gpt-4o-mini and publishes it in Turkish, English and Estonian.',
      stack: ['Next.js 16', 'Supabase', 'OpenAI'] },
    { id: 'magicube', name: 'MagiCube', kicker: 'self-hosted webmail', tag: 'open source · mit', url: 'https://github.com/MagnusMagi/MagiCube',
      blurb: 'A Node.js webmail client for Mailcow or any IMAP/SMTP server. No database, push mail over IMAP IDLE.',
      stack: ['React 19', 'Express', 'Tailwind v4', 'IMAP'] },
    { id: 'airflow', name: 'Airflow', kicker: 'mac fan control', tag: 'macos · coming soon', url: 'https://airflow.magnusmagi.com',
      blurb: 'A menu bar app for Apple silicon Macs. Run each fan on Auto, at a fixed speed or on your own temperature curve.',
      stack: ['Swift', 'SwiftUI', 'SMC', 'XPC'] },
  ],
  site: { name: 'magnusmagi.com', url: 'https://magnusmagi.com' },
  stack: {
    daily: ['Next.js', 'React', 'TypeScript', 'Postgres', 'Supabase', 'Node.js', 'Vercel', 'Caddy + PM2'],
    also: ['Expo / React Native', 'PostGIS', 'Realtime multiplayer', 'Data pipelines', 'Maps & geodata', 'OpenAI API'],
  },
};

export const THEMES = {
  light: { bg: '#ffffff', panel: '#f6f8fa', paper: '#fffdf7', border: '#d0d7de', fg: '#1f2328', muted: '#59636e',
    accent: '#0969da', green: '#1a7f37', red: '#cf222e', amber: '#9a6700' },
  dark: { bg: '#0d1117', panel: '#161b22', paper: '#1c2128', border: '#30363d', fg: '#e6edf3', muted: '#9198a1',
    accent: '#4493f8', green: '#3fb950', red: '#f85149', amber: '#d29922' },
};
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif";
// shortcut: mono glyph width is ~0.6em in every font above, so text width = chars * 0.6 * size; breaks for CJK/emoji.
const monoW = (s, size) => Math.ceil(String(s).length * size * 0.6);

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const compact = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${+(n / 1e3).toFixed(1)}k` : String(n));
export function wrap(text, max) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > max) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  return line ? [...lines, line] : lines;
}

function svg(w, h, t, body, label, frame = true) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
<style>text{font-family:${SANS}}.m{font-family:${MONO}}@keyframes blink{50%{opacity:0}}@keyframes pulse{50%{opacity:.3}}.blink{animation:blink 1.1s step-end infinite}.pulse{animation:pulse 2.4s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.blink,.pulse{animation:none}}</style>
${frame ? `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>` : ''}
${body}
</svg>
`;
}

const text = (x, y, s, { size = 14, fill, weight, cls, anchor } = {}) =>
  `<text${cls ? ` class="${cls}"` : ''} x="${x}" y="${y}" font-size="${size}" fill="${fill}"${weight ? ` font-weight="${weight}"` : ''}${anchor ? ` text-anchor="${anchor}"` : ''}>${esc(s)}</text>`;

const chipW = (label) => monoW(label, 12) + 20;
function chip(x, y, label, t) {
  const w = chipW(label);
  return { w, svg: `<rect x="${x}" y="${y}" width="${w}" height="24" rx="6" fill="${t.panel}" stroke="${t.border}"/>${text(x + 10, y + 16, label, { size: 12, fill: t.fg, cls: 'm' })}` };
}

function pill(right, y, label, color, live) {
  const w = monoW(label, 11) + 30, x = right - w;
  return `<rect x="${x}" y="${y - 15}" width="${w}" height="22" rx="11" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-opacity=".45"/>
<circle cx="${x + 12}" cy="${y - 4}" r="3.5" fill="${color}"${live ? ' class="pulse"' : ''}/>${text(x + 21, y, label, { size: 11, fill: color, cls: 'm' })}`;
}

const sitePill = (right, y, site, t) =>
  pill(right, y, site.ok ? `live · ${site.ms} ms` : `down · ${site.code}`, site.ok ? t.green : t.red, site.ok);

function terminal(t, d) {
  const up = d.sites.filter((s) => s.ok).length;
  const cmd = (c) => [['$ ', t.green], [c, t.fg]];
  const rows = [
    cmd('whoami'), [[`${CONTENT.name}, ${CONTENT.role}`, t.fg]], [],
    cmd('cat location'), [[CONTENT.location, t.muted]], [],
    cmd('ls ~/live'), d.sites.map((s) => [`${s.host.split('.')[0]}  `, s.ok ? t.accent : t.red]), [],
    cmd('uptime'), [[`${up}/${d.sites.length} apps up · checked ${d.checkedAt}`, up === d.sites.length ? t.green : t.amber]], [],
    cmd(''),
  ];
  const W = 880, top = 78, lh = 24, H = top + rows.length * lh;
  const body = rows.map((row, i) =>
    `<text class="m" x="28" y="${top + i * lh}" font-size="15" xml:space="preserve">${row.map(([s, c]) => `<tspan fill="${c}">${esc(s)}</tspan>`).join('')}</text>`);
  return svg(W, H, t, `<path d="M1 40V12A11 11 0 0 1 12 1H${W - 12}A11 11 0 0 1 ${W - 1} 12V40Z" fill="${t.panel}"/><path d="M1 40H${W - 1}" stroke="${t.border}"/>
${['#ff5f57', '#febc2e', '#28c840'].map((c, i) => `<circle cx="${24 + i * 20}" cy="20" r="6" fill="${c}"/>`).join('')}
${text(W / 2, 25, CONTENT.prompt, { size: 12, fill: t.muted, cls: 'm', anchor: 'middle' })}
${body.join('\n')}
<rect class="blink" x="${28 + monoW('$ ', 15)}" y="${top + (rows.length - 1) * lh - 14}" width="9" height="18" fill="${t.fg}"/>`,
  `Terminal: ${CONTENT.name}, ${CONTENT.role}. ${CONTENT.location}. ${up} of ${d.sites.length} apps up.`);
}

// Fixed pins so the graticule looks like a map without changing between runs.
const PINS = [[300, 64], [262, 140], [404, 52], [560, 30], [612, 186], [706, 70], [792, 150], [560, 214]];

function flagship(t, d) {
  const F = CONTENT.flagship, W = 880, H = 250, site = d.sites.find((s) => s.url === F.url);
  const grid = [];
  for (let x = 44; x < W; x += 44) grid.push(`M${x} 0V${H}`);
  for (let y = 44; y < H; y += 44) grid.push(`M0 ${y}H${W}`);
  const stats = F.stats.map(([n, label], i) =>
    `${text(32 + i * 210, 176, compact(n), { size: 34, fill: t.fg, weight: 800 })}${text(32 + i * 210, 200, label, { size: 13, fill: t.muted })}`);
  return svg(W, H, t, `<clipPath id="c"><rect width="${W}" height="${H}" rx="12"/></clipPath>
<g clip-path="url(#c)"><path d="${grid.join('')}" stroke="${t.border}" stroke-opacity=".5"/>
${PINS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${t.accent}" fill-opacity=".25"/>`).join('')}</g>
${text(32, 44, F.kicker.toUpperCase(), { size: 12, fill: t.accent, cls: 'm', weight: 700 })}
${text(32, 84, F.name, { size: 32, fill: t.fg, weight: 800 })}
${site ? sitePill(W - 32, 46, site, t) : ''}
${text(32, 114, F.blurb, { size: 15, fill: t.muted })}
${stats.join('\n')}
${text(32, 230, `${F.stack} · ${new URL(F.url).host}`, { size: 12, fill: t.muted, cls: 'm' })}`,
  `${F.name}: ${F.blurb} ${F.stats.map(([n, l]) => `${compact(n)} ${l}`).join(', ')}.`);
}

function liveBoard(t, d) {
  const W = 880, top = 76, rh = 44, H = top + d.sites.length * rh + 14, barW = 7, gap = 3, barX = 420;
  const rows = d.sites.map((s, i) => {
    const y = top + i * rh, color = s.ok ? t.green : t.red;
    const hist = [...Array(Math.max(0, HISTORY_DAYS - s.history.length)).fill(null), ...s.history.map(([, ok]) => ok)];
    const bars = hist.map((ok, j) =>
      `<rect x="${barX + j * (barW + gap)}" y="${y + 8}" width="${barW}" height="24" rx="2" fill="${ok === null ? t.border : ok ? t.green : t.red}"${ok === null ? '' : ' fill-opacity=".85"'}/>`);
    return `<path d="M24 ${y}H${W - 24}" stroke="${t.border}"/>
<circle cx="38" cy="${y + 20}" r="5" fill="${color}"${s.ok ? ' class="pulse"' : ''}/>
${text(56, y + 25, s.name, { size: 15, fill: t.fg, weight: 600 })}${text(200, y + 25, s.host, { size: 12, fill: t.muted, cls: 'm' })}
${bars.join('')}
${text(W - 28, y + 25, s.ok ? `${s.code} · ${s.ms}ms` : `${s.code}`, { size: 12, fill: color, cls: 'm', anchor: 'end' })}`;
  });
  return svg(W, H, t, `${text(28, 44, 'live board', { size: 14, fill: t.fg, cls: 'm', weight: 700 })}
${text(W - 28, 44, `${HISTORY_DAYS}-day history · pinged daily · ${d.checkedAt}`, { size: 12, fill: t.muted, cls: 'm', anchor: 'end' })}
${rows.join('\n')}`,
  `Live board: ${d.sites.map((s) => `${s.name} ${s.ok ? 'up' : 'down'}`).join(', ')}.`);
}

function tile(t, p, d) {
  const W = 430, H = 220, site = p.live && d.sites.find((s) => s.url === p.url);
  let x = 24;
  const chips = p.stack.map((label) => { const c = chip(x, 168, label, t); x += c.w + 8; return c.svg; });
  const tag = site ? sitePill(W - 24, 44, site, t) : pill(W - 24, 44, p.tag ?? 'live', t.accent, false);
  return svg(W, H, t, `${text(24, 48, p.name, { size: 22, fill: t.fg, weight: 800 })}
${tag}
${text(24, 72, p.kicker, { size: 12, fill: t.muted, cls: 'm' })}
${wrap(p.blurb, BLURB_CHARS).map((line, i) => text(24, 106 + i * 20, line, { size: 14, fill: t.fg })).join('\n')}
${chips.join('\n')}`,
  `${p.name}: ${p.blurb}`);
}

function stack(t) {
  const W = 880, left = 120, right = W - 28, rh = 36;
  let y = 24;
  const parts = Object.entries(CONTENT.stack).map(([group, items]) => {
    let x = left;
    const out = [text(28, y + 17, group, { size: 12, fill: t.muted, cls: 'm' })];
    for (const label of items) {
      const w = chipW(label);
      if (x + w > right) { x = left; y += rh; }
      out.push(chip(x, y, label, t).svg);
      x += w + 8;
    }
    y += rh + 8;
    return out.join('');
  });
  return svg(W, y + 8, t, parts.join('\n'),
    `Stack: ${CONTENT.stack.daily.join(', ')}. Also ${CONTENT.stack.also.join(', ')}.`);
}

function receipt(t, d) {
  const w = d.week, W = 460, L = 32, R = W - 32, lh = 22, ops = [];
  const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' }).toUpperCase();
  const busiest = w.days.reduce((a, b) => (b.count > a.count ? b : a), { count: 0 });
  const center = (s, o = {}) => ops.push((y) => text(W / 2, y, s, { size: 13, fill: t.fg, cls: 'm', anchor: 'middle', ...o }));
  const lr = (l, r, o = {}) => ops.push((y) => text(L, y, l, { size: 13, fill: t.fg, cls: 'm', ...o }) + text(R, y, r, { size: 13, fill: t.fg, cls: 'm', anchor: 'end', ...o }));
  const rule = () => ops.push((y) => `<path d="M${L} ${y - 5}H${R}" stroke="${t.muted}" stroke-dasharray="4 4"/>`);

  center('MAGI BUILD CO.', { size: 16, weight: 800 });
  center('Tallinn, Estonia · github.com/' + LOGIN, { size: 11, fill: t.muted });
  rule();
  lr('WEEK', `${w.from} → ${w.to}`);
  rule();
  for (const [label, n] of [['COMMITS', w.commits], ['PULL REQUESTS', w.prs], ['ISSUES', w.issues], ['CODE REVIEWS', w.reviews], ['PRIVATE WORK', w.private]]) lr(label, `x ${n}`);
  rule();
  if (w.repos.length) {
    lr('BY REPO', '', { fill: t.muted });
    for (const r of w.repos) lr(`  ${r.name.slice(0, 30)}`, String(r.count));
    rule();
  }
  lr('TOTAL', String(w.total), { weight: 800, size: 15 });
  lr('BUSIEST DAY', busiest.count ? `${day(busiest.date)} · ${busiest.count}` : '—');
  rule();

  const out = [];
  let y = 44;
  for (const op of ops) { out.push(op(y)); y += lh; }

  const max = Math.max(1, ...w.days.map((x) => x.count)), bw = 36, bg = 16, bx = (W - (7 * bw + 6 * bg)) / 2, bh = 56;
  y += 8;
  w.days.forEach((x, i) => {
    const h = Math.max(2, Math.round((x.count / max) * bh)), X = bx + i * (bw + bg);
    out.push(`<rect x="${X}" y="${y + bh - h}" width="${bw}" height="${h}" rx="3" fill="${t.accent}" fill-opacity="${x.count ? 0.85 : 0.25}"/>`,
      text(X + bw / 2, y + bh + 16, day(x.date)[0], { size: 11, fill: t.muted, cls: 'm', anchor: 'middle' }));
  });
  y += bh + 40;

  // Barcode seeded by the week so it only changes when the week does.
  let seed = [...`${w.from}${w.total}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const bars = [];
  for (let x = L + 30; x < R - 30;) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const bwid = 1 + (seed >>> 16) % 3;
    bars.push(`<rect x="${x}" y="${y}" width="${bwid}" height="34" fill="${t.fg}"/>`);
    x += bwid + 1 + ((seed >>> 8) % 3);
  }
  out.push(bars.join(''));
  y += 58;
  out.push(text(W / 2, y, 'THANK YOU · SHIP AGAIN SOON', { size: 12, fill: t.muted, cls: 'm', anchor: 'middle' }));
  const H = y + 30;
  let teeth = '';
  for (let x = W; x > 0; x -= 12) teeth += `L${x - 6} ${H - 8}L${Math.max(x - 12, 0)} ${H}`;
  return svg(W, H, t, `<path d="M.5 .5H${W - 0.5}V${H}${teeth}Z" fill="${t.paper}" stroke="${t.border}"/>
${out.join('\n')}`,
  `Last week on GitHub as a receipt: ${w.commits} commits, ${w.prs} pull requests, ${w.total} contributions in total.`, false);
}

export function renderAll(t, d) {
  return {
    terminal: terminal(t, d),
    magnusgeo: flagship(t, d),
    live: liveBoard(t, d),
    stack: stack(t),
    receipt: receipt(t, d),
    ...Object.fromEntries(CONTENT.projects.map((p) => [`tile-${p.id}`, tile(t, p, d)])),
  };
}

async function ping(url) {
  const start = performance.now();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: UA });
    await res.body?.cancel();
    // Uptime, not health: a 4xx (e.g. Cloudflare blocking the CI runner) still means the server answered.
    return { ok: res.status < 500, code: res.status, ms: Math.round(performance.now() - start) };
  } catch (err) {
    console.warn(`ping ${url} failed: ${err.message}`);
    return { ok: false, code: 'ERR', ms: null };
  }
}

async function checkSites(prev, today) {
  const list = [
    { name: CONTENT.flagship.name, url: CONTENT.flagship.url },
    ...CONTENT.projects.filter((p) => p.live).map(({ name, url }) => ({ name, url })),
    CONTENT.site,
  ];
  return Promise.all(list.map(async (s) => {
    const r = await ping(s.url);
    const old = prev.find((p) => p.url === s.url)?.history ?? [];
    const history = [...old.filter(([day]) => day !== today), [today, r.ok ? 1 : 0]].slice(-HISTORY_DAYS);
    return { ...s, host: new URL(s.url).host, ...r, history };
  }));
}

const QUERY = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){
totalCommitContributions totalPullRequestContributions totalIssueContributions totalPullRequestReviewContributions restrictedContributionsCount
commitContributionsByRepository(maxRepositories:5){repository{name isPrivate} contributions{totalCount}}
contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}`;

async function fetchWeek(token, today) {
  const to = new Date(`${today}T00:00:00Z`), from = new Date(to - 7 * 864e5);
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', ...UA },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN, from: from.toISOString(), to: new Date(to - 1).toISOString() } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub GraphQL failed (${res.status}): ${JSON.stringify(json.errors ?? json)}`);
  const c = json.data.user.contributionsCollection;
  const fromDay = isoDay(from);
  return {
    from: fromDay,
    to: isoDay(new Date(to - 864e5)),
    commits: c.totalCommitContributions,
    prs: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    reviews: c.totalPullRequestReviewContributions,
    private: c.restrictedContributionsCount,
    total: c.contributionCalendar.totalContributions,
    // Private repo names never go into a public image, even when a personal token can see them.
    repos: c.commitContributionsByRepository.map((r) => ({ name: r.repository.isPrivate ? 'private repo' : r.repository.name, count: r.contributions.totalCount })),
    days: c.contributionCalendar.weeks.flatMap((wk) => wk.contributionDays)
      .filter((x) => x.date >= fromDay && x.date < today).map((x) => ({ date: x.date, count: x.contributionCount })),
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set. Locally: GITHUB_TOKEN=$(gh auth token) node scripts/generate.mjs');
  const now = new Date(), today = isoDay(now);
  const prev = JSON.parse(await readFile(new URL('data.json', ASSETS), 'utf8').catch(() => '{}'));
  const [sites, week] = await Promise.all([checkSites(prev.sites ?? [], today), fetchWeek(token, today)]);
  const data = { checkedAt: `${today} ${now.toISOString().slice(11, 16)} UTC`, sites, week };
  await mkdir(ASSETS, { recursive: true });
  await writeFile(new URL('data.json', ASSETS), `${JSON.stringify(data, null, 2)}\n`);
  for (const [theme, t] of Object.entries(THEMES)) {
    for (const [name, out] of Object.entries(renderAll(t, data))) await writeFile(new URL(`${name}-${theme}.svg`, ASSETS), out);
  }
  console.log(`wrote assets for ${today}: ${sites.filter((s) => s.ok).length}/${sites.length} up, ${week.total} contributions`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err); process.exit(1); });
