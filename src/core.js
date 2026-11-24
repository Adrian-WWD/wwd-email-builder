/* Shared helpers, campaign defaults, and loading of campaigns + templates.
   In the repo, campaigns and templates are fetched from their folders.
   In the bundled build (dist/email-builder.html), scripts/build.mjs inlines them as window.WWD_BUNDLE. */
window.WWD = window.WWD || {};
(function (W) {
  const HPC = "{{if HighestPreviousContributionAmount and greater_than_or_equal_to(HighestPreviousContributionAmount,250)}}250{{elseif HighestPreviousContributionAmount and less_than_or_equal_to(HighestPreviousContributionAmount,10)}}10{{else}}{{HighestPreviousContributionAmount or '3'}}{{end}}";

  const DEFAULTS = {
    name: 'New campaign', audience: 'friend', mergeTag: "{{FirstName or '%FALLBACK%'}}", askMerge: HPC,
    pages: [], defaultPage: 0, refPattern: 'em-%DATE%-all-%V%',
    abx: { amounts: [10, 35, 50, 100, 250], label: 'Chip in $%AMT% Now', otherLabel: 'Another amount', color: '#21195a', otherColor: '#9accf0',
      intro: "If you've saved your payment information with ActBlue Express, your donation will go through immediately:" },
    donateLabel: 'Donate', image: { maxWidth: 360, border: '2pt solid #21195a' }, placeholders: []
  };

  const TEMPLATE_NAMES = ['abx-cell', 'abx-row', 'abx-ghost-mid', 'abx-ghost-end', 'abx-row-separator', 'abx-intro', 'abx-grid', 'single-button', 'image'];

  const clone = o => JSON.parse(JSON.stringify(o));
  function withDefaults(c) {
    const d = clone(DEFAULTS), g = Object.assign(d, clone(c || {}));
    g.abx = Object.assign(clone(DEFAULTS.abx), (c && c.abx) || {});
    g.image = Object.assign(clone(DEFAULTS.image), (c && c.image) || {});
    if (!Array.isArray(g.pages)) g.pages = [];
    if (!Array.isArray(g.placeholders)) g.placeholders = [];
    return g;
  }

  async function loadData() {
    if (window.WWD_BUNDLE) return window.WWD_BUNDLE;
    const get = async (p, as) => { const r = await fetch(p, { cache: 'no-cache' }); if (!r.ok) throw new Error(`Couldn’t load ${p} (${r.status})`); return as === 'json' ? r.json() : r.text(); };
    const templates = {};
    await Promise.all(TEMPLATE_NAMES.map(async n => { templates[n] = (await get(`templates/${n}.html`)).replace(/\n$/, ''); }));
    const files = await get('campaigns/index.json', 'json');
    const campaigns = await Promise.all(files.map(async f => ({ id: f.replace(/\.json$/, ''), file: f, data: await get(`campaigns/${f}`, 'json') })));
    return { templates, campaigns };
  }

  const fill = (tpl, vars) => tpl.replace(/%%([A-Z0-9_]+)%%/g, (m, k) => (k in vars ? String(vars[k]) : m));

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const escText = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const norm = s => String(s || '').replace(/[\[\]\s]/g, '').toLowerCase();
  function setParams(url, pairs) {
    if (!url) return '';
    const [main, hash] = url.split('#'); const [base, q] = main.split('?');
    const live = pairs.filter(([, v]) => v !== '' && v != null);
    const keys = live.map(([k]) => k);
    const kept = (q ? q.split('&') : []).filter(p => p && !keys.includes(p.split('=')[0]));
    const all = live.map(([k, v]) => k + '=' + encodeURIComponent(v)).concat(kept);
    return base + (all.length ? '?' + all.join('&') : '') + (hash ? '#' + hash : '');
  }
  const isActBlue = u => /actblue\.com/i.test(u || '');
  const fmtAmt = a => { const n = +a; return Number.isInteger(n) ? String(n) : n.toFixed(2); };
  const parseAmounts = s => (String(Array.isArray(s) ? s.join(',') : s || '').match(/\d+(?:\.\d{1,2})?/g) || []).filter(x => +x > 0);
  const stripNum = s => s.replace(/^\s*\d+[.)]\s+/, '').trim();
  const cap = w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  const low = w => (w && w !== w.toUpperCase()) ? w.charAt(0).toLowerCase() + w.slice(1) : (w || '');
  function fmtDate(s) {
    s = (s || '').trim(); if (!s) return '';
    const m = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/.exec(s);
    let mo, d, y;
    if (m) { mo = +m[1]; d = +m[2]; y = +m[3]; }
    else { const t = Date.parse(s); if (isNaN(t)) return ''; const dt = new Date(t); mo = dt.getMonth() + 1; d = dt.getDate(); y = dt.getFullYear(); }
    const p = n => String(n).padStart(2, '0');
    return `${p(mo)}.${p(d)}.${p(y % 100)}`;
  }
  const slug = s => (s || 'email').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'email';

  W.core = { HPC, DEFAULTS, TEMPLATE_NAMES, withDefaults, loadData, fill, esc, escText, norm, setParams, isActBlue, fmtAmt, parseAmounts, stripNum, cap, low, fmtDate, slug, clone };
})(window.WWD);
