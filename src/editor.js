/* Campaign editor: fill in a form, get a campaigns/<name>.json file, and open it on GitHub. */
(function (W) {
  const { HPC, DEFAULTS, withDefaults, loadData, fill, esc, escText, setParams, fmtAmt, slug, clone } = W.core;
  const $ = s => document.querySelector(s);
  const REPO = 'adrian-wwd/wwd-email-builder', BRANCH = 'main';   // change if the repo moves
  const GH = `https://github.com/${REPO}`;

  let T = {}, existing = [], d = clone(DEFAULTS), source = null, fileTouched = false;

  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const setPath = (o, p, v) => { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach(k => { a[k] = a[k] || {}; a = a[k]; }); a[ks[ks.length - 1]] = v; };
  const isHex = v => /^#[0-9a-f]{6}$/i.test(v || '');
  const fileName = () => (slug($('#fileName').value || d.name || 'new-campaign')) + '.json';
  const isExisting = () => source && existing.some(c => c.file === fileName()) && source.file === fileName();

  /* ---------- form <-> data ---------- */
  function fillForm() {
    for (const el of document.querySelectorAll('[data-k]')) { let v = getPath(d, el.dataset.k); if (Array.isArray(v)) v = v.join(', '); el.value = v ?? ''; }
    for (const el of document.querySelectorAll('[data-c]')) { const v = getPath(d, el.dataset.c); if (isHex(v)) el.value = v; }
    renderPages(); renderPh();
  }
  function readField(el) {
    const k = el.dataset.k; let v = el.value;
    if (k === 'abx.amounts') v = (v.match(/\d+(?:\.\d{1,2})?/g) || []).map(Number);
    else if (el.type === 'number') v = +v || getPath(DEFAULTS, k);
    setPath(d, k, v);
  }
  document.querySelector('.panel').addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.k) { readField(el); if (el.dataset.k === 'name' && !fileTouched) $('#fileName').value = slug(el.value || ''); const c = document.querySelector(`[data-c="${el.dataset.k}"]`); if (c && isHex(el.value)) c.value = el.value; }
    if (el.dataset.c) { const t = document.querySelector(`[data-k="${el.dataset.c}"]`); t.value = el.value; readField(t); }
    if (el.id === 'fileName') fileTouched = true;
    update();
  });
  $('#resetAsk').onclick = () => { d.askMerge = HPC; fillForm(); update(); };

  /* pages */
  function renderPages() {
    $('#pageRows').innerHTML = d.pages.map((p, i) => `<div class="prow page"><input type="radio" name="defpage" data-def="${i}" ${i === (d.defaultPage || 0) ? 'checked' : ''} aria-label="Default page"><input type="text" data-pg="${i}" data-f="name" placeholder="Q4, Recount, Petition…" value="${esc(p.name)}"><input type="url" data-pg="${i}" data-f="url" placeholder="https://secure.actblue.com/donate/…" value="${esc(p.url)}"><button class="x" data-rmpg="${i}" aria-label="Remove page">×</button></div>`).join('') || '<p class="extra">No pages yet.</p>';
  }
  $('#pageRows').addEventListener('input', e => { const el = e.target; if (el.dataset.pg != null) { d.pages[+el.dataset.pg][el.dataset.f] = el.value.trim(); update(); } });
  $('#pageRows').addEventListener('change', e => { if (e.target.dataset.def != null) { d.defaultPage = +e.target.dataset.def; update(); } });
  $('#pageRows').addEventListener('click', e => { const b = e.target.closest('[data-rmpg]'); if (!b) return; d.pages.splice(+b.dataset.rmpg, 1); if ((d.defaultPage || 0) >= d.pages.length) d.defaultPage = 0; renderPages(); update(); });
  $('#addPage').onclick = () => { d.pages.push({ name: '', url: '' }); renderPages(); const ins = $('#pageRows').querySelectorAll('input[data-f="name"]'); ins[ins.length - 1].focus(); };

  /* placeholders */
  function renderPh() {
    $('#phRows').innerHTML = d.placeholders.map((r, i) => `<div class="prow"><input type="text" data-ph="${i}" data-f="token" placeholder="[[ SIG ]]" value="${esc(r.token)}"><input type="text" data-ph="${i}" data-f="html" placeholder="<p>With you,</p>" value="${esc(r.html)}"><button class="x" data-rmph="${i}" aria-label="Remove placeholder">×</button></div>`).join('');
  }
  $('#phRows').addEventListener('input', e => { const el = e.target; if (el.dataset.ph != null) { d.placeholders[+el.dataset.ph][el.dataset.f] = el.value; update(); } });
  $('#phRows').addEventListener('click', e => { const b = e.target.closest('[data-rmph]'); if (!b) return; d.placeholders.splice(+b.dataset.rmph, 1); renderPh(); update(); });
  $('#addPh').onclick = () => { d.placeholders.push({ token: '', html: '' }); renderPh(); const ins = $('#phRows').querySelectorAll('input[data-f="token"]'); ins[ins.length - 1].focus(); };

  /* ---------- output ---------- */
  function cleaned() {
    const o = withDefaults(d);
    o.name = (o.name || '').trim();
    o.pages = o.pages.filter(p => p.url).map(p => ({ name: (p.name || '').trim() || 'Page', url: p.url.trim() }));
    o.defaultPage = Math.min(o.defaultPage || 0, Math.max(0, o.pages.length - 1));
    o.placeholders = o.placeholders.filter(p => (p.token || '').trim()).map(p => ({ token: p.token.trim(), html: p.html || '' }));
    return o;
  }
  const jsonText = () => JSON.stringify(cleaned(), null, 2) + '\n';

  function checks(o) {
    const warn = [];
    if (!o.name) warn.push('Add a campaign name.');
    if (!isExisting() && existing.some(c => c.file === fileName())) warn.push(`campaigns/${fileName()} already exists. Pick “${o.name}” under Start from to edit it, or change the file name.`);
    if (!o.pages.length) warn.push('Add at least one donation page URL.');
    for (const p of o.pages) if (!/^https:\/\//.test(p.url)) warn.push(`“${p.name}” URL should start with https://`);
    if (!/%FALLBACK%/.test(o.mergeTag)) warn.push('The name merge tag needs %FALLBACK% so the audience word can go in.');
    if (!/%DATE%/.test(o.refPattern)) warn.push('The refcode pattern has no %DATE%, so every email will share one refcode.');
    if (!/%V%/.test(o.refPattern)) warn.push('The refcode pattern has no %V%. A/B versions will get “-a”, “-b” added at the end.');
    if (!o.abx.amounts.length) warn.push('Add at least one ABX amount.');
    if (!isHex(o.abx.color) || !isHex(o.abx.otherColor)) warn.push('Button colors should be 6-digit hex codes like #21195a.');
    const toks = o.placeholders.map(p => p.token.toLowerCase().replace(/\s/g, ''));
    if (new Set(toks).size !== toks.length) warn.push('Two custom placeholders use the same token.');
    return warn;
  }

  function sample(o) {
    const page = (o.pages[o.defaultPage] || {}).url || 'https://secure.actblue.com/donate/example';
    const ref = o.refPattern.replace(/%DATE%/g, '11.19.26').replace(/%V%/g, 'a');
    const V = { T, g: o };
    const cell = (href, label, color) => fill(T['abx-cell'], { HREF: esc(href), LABEL: label, COLOR: color });
    const row = cells => fill(T['abx-row'], { CELLS: cells[0] + '\n' + (cells[1] ? T['abx-ghost-mid'] + '\n\n' + cells[1] + '\n' + T['abx-ghost-end'] : '') });
    const cells = o.abx.amounts.map(a => cell(setParams(page, [['refcode', ref], ['express_lane', 'true'], ['amount', fmtAmt(a)]]), escText(o.abx.label.replace(/%AMT%/g, fmtAmt(a))), o.abx.color));
    cells.push(cell(setParams(page, [['refcode', ref]]), escText(o.abx.otherLabel), o.abx.otherColor));
    const rows = []; for (let i = 0; i < cells.length; i += 2) rows.push(row(cells.slice(i, i + 2)));
    const grid = fill(T['abx-grid'], { INTRO: o.abx.intro ? fill(T['abx-intro'], { TEXT: escText(o.abx.intro) }) + '\n\n' : '', ROWS: rows.join('\n' + T['abx-row-separator'] + '\n\n') });
    const tag = w => o.mergeTag.replace(/%FALLBACK%/g, w);
    const aud = o.audience || 'friend';
    const greet = tag(aud.charAt(0).toUpperCase() + aud.slice(1));
    const mid = tag(aud === aud.toUpperCase() ? aud : aud.charAt(0).toLowerCase() + aud.slice(1));
    const ph = o.placeholders[0];
    return `<p class="lbl">Sample with these settings · refcode ${esc(ref)}</p>
<p>Hey there, ${escText(mid)},</p>
<p>${escText(greet)}, this is how NAME looks at the start of a sentence.</p>
<p>This is a regular paragraph of email copy.</p>
<p><a href="${esc(setParams(page, [['refcode', ref]]))}"><strong>Blue ask lines link here. Can you chip in $${escText(o.askMerge.length > 40 ? '[HPC ask]' : o.askMerge)} today?</strong></a></p>
${grid}
${fill(T['single-button'], { ROW: row([cell(setParams(page, [['refcode', ref], ['express_lane', 'true'], ['amount', '5']]), 'RUSH $5 NOW', o.abx.color)]) })}
<p style="text-align: center;"><span class="imgph" style="max-width:${+o.image.maxWidth || 360}px;${o.image.border ? 'border:' + esc(o.image.border) + ';' : ''}">Image · ${+o.image.maxWidth || 360}px max</span></p>
${ph ? `<p class="lbl">${esc(ph.token)} becomes:</p>${ph.html}` : ''}`;
  }
  const previewDoc = frag => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px 16px;background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#222}.wrap{max-width:600px;margin:0 auto}p{margin:0 0 16px}a{color:#1155cc}.lbl{font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.06em}.imgph{display:block;margin:0 auto;width:100%;height:120px;background:#eee;color:#777;font-size:13px;line-height:120px;box-sizing:border-box}</style></head><body><div class="wrap">${frag}</div></body></html>`;

  function update() {
    const o = cleaned();
    $('#fileShow').textContent = $('#fileShow2').textContent = fileName();
    $('#json').value = jsonText();
    const ex = isExisting();
    $('#modeLabel').textContent = ex ? `Editing ${fileName()}` : 'New campaign';
    $('#toGithub').textContent = ex ? 'Update on GitHub' : 'Add to GitHub';
    const warn = checks(o);
    $('#checks').innerHTML = warn.length ? warn.map(w => `<div class="note warn">${esc(w)}</div>`).join('') : '<div class="note ok">Looks good.</div>';
    $('#toGithub').disabled = !o.name || !o.pages.length;
    try { $('#preview').srcdoc = previewDoc(sample(o)); } catch {}
  }
  $('#preview').addEventListener('load', () => { try { const doc = $('#preview').contentDocument; $('#preview').style.height = Math.max(420, doc.documentElement.scrollHeight + 4) + 'px'; } catch {} });

  /* ---------- start from ---------- */
  function load(c) {
    source = c; fileTouched = !!c;
    d = withDefaults(c ? c.data : { pages: [{ name: 'Q4', url: '' }] });
    if (!c) d.name = '';
    $('#fileName').value = c ? c.file.replace(/\.json$/, '') : '';
    fillForm(); update(); $('#steps').innerHTML = '';
  }
  $('#startSel').onchange = e => { const v = e.target.value; load(v === '__new' ? null : existing.find(c => c.file === v)); };
  $('#openFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const data = JSON.parse(await f.text()); source = null; d = withDefaults(data); $('#fileName').value = f.name.replace(/\.json$/i, ''); fileTouched = true; $('#startSel').value = '__new'; fillForm(); update(); toast(`Opened ${f.name}`); }
    catch { toast('That file isn’t valid JSON.'); }
  });

  /* ---------- copy / download / GitHub ---------- */
  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg); return true; } catch {}
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove();
    toast(ok ? msg : 'Copy didn’t work here. Select the JSON and copy by hand.'); return ok;
  }
  $('#copyJson').onclick = () => copyText(jsonText(), 'JSON copied');
  $('#dlJson').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([jsonText()], { type: 'application/json' })); a.download = fileName();
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  $('#toGithub').onclick = async () => {
    const f = fileName();
    if (isExisting()) {
      await copyText(jsonText(), 'JSON copied');
      window.open(`${GH}/edit/${BRANCH}/campaigns/${encodeURIComponent(f)}`, '_blank', 'noopener');
      $('#steps').innerHTML = `<div class="step"><span class="num">1</span><span class="grow">On GitHub, select everything in <code>campaigns/${esc(f)}</code>, paste, and choose <b>Commit changes</b> (or propose a pull request).</span></div>`;
      return;
    }
    window.open(`${GH}/new/${BRANCH}/campaigns?filename=${encodeURIComponent(f)}&value=${encodeURIComponent(jsonText())}`, '_blank', 'noopener');
    const list = existing.map(c => c.file); if (!list.includes(f)) list.push(f);
    const idx = JSON.stringify(list, null, 2) + '\n';
    $('#steps').innerHTML = `<div class="step"><span class="num">1</span><span class="grow">GitHub opened with <code>campaigns/${esc(f)}</code> filled in. Choose <b>Commit changes</b>.</span></div>
      <div class="step"><span class="num">2</span><span class="grow">Add it to the list the builder loads: copy the new <code>campaigns/index.json</code>, then replace that file’s contents on GitHub.</span><button class="btn btn-3" id="idxGo">Copy &amp; open index.json</button></div>`;
    $('#idxGo').onclick = async () => { await copyText(idx, 'index.json copied'); window.open(`${GH}/edit/${BRANCH}/campaigns/index.json`, '_blank', 'noopener'); };
  };

  let tt; function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), 3600); }

  /* ---------- start ---------- */
  (async () => {
    try {
      const data = await loadData();
      T = data.templates; existing = data.campaigns;
      $('#sourceNote').innerHTML = `<b>${existing.length}</b> campaign${existing.length === 1 ? '' : 's'} in the repo`;
    } catch (e) {
      $('#sourceNote').textContent = 'Couldn’t load the repo files';
      toast('Serve the folder over http (see README), not as a file.');
    }
    $('#startSel').innerHTML = '<option value="__new">New campaign (blank)</option>' + existing.map(c => `<option value="${esc(c.file)}">${esc(c.data.name || c.file)}</option>`).join('');
    load(null);
  })();
})(window.WWD);
