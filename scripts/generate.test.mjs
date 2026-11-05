import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, wrap, compact, renderAll, THEMES, CONTENT, BLURB_CHARS } from './generate.mjs';

const site = (name, url, ok) => ({ name, url, host: new URL(url).host, ok, code: ok ? 200 : 'ERR', ms: ok ? 120 : null, history: [['2026-11-04', 1], ['2026-11-05', ok ? 1 : 0]] });
const data = {
  checkedAt: '2026-11-05 05:00 UTC',
  sites: [site('MagnusGeo', 'https://magnusgeo.magnusmagi.com', true), site('Cardinal', 'https://cardinal.magnusmagi.com', false)],
  week: { from: '2026-10-29', to: '2026-11-04', commits: 12, prs: 1, issues: 0, reviews: 0, private: 30, total: 43,
    repos: [{ name: 'private repo', count: 9 }], days: Array.from({ length: 7 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 29 + i)).toISOString().slice(0, 10), count: i })) },
};

test('helpers', () => {
  assert.equal(esc(`<a & "b">`), '&lt;a &amp; &quot;b&quot;&gt;');
  assert.equal(compact(1_180_000), '1.18M');
  assert.equal(compact(6_100_000), '6.1M');
  assert.equal(compact(11), '11');
  assert.deepEqual(wrap('aa bb cc dd', 5), ['aa bb', 'cc dd']);
  for (const p of CONTENT.projects) assert.ok(wrap(p.blurb, BLURB_CHARS).length <= 3, `${p.id} blurb is longer than 3 lines`);
});

test('every card renders a complete svg in both themes', () => {
  for (const t of Object.values(THEMES)) {
    for (const [name, out] of Object.entries(renderAll(t, data))) {
      assert.match(out, /^<svg [^>]*aria-label="[^"]+"/, name);
      assert.ok(out.trimEnd().endsWith('</svg>'), name);
      assert.doesNotMatch(out, /undefined|NaN|null/, name);
    }
  }
});
