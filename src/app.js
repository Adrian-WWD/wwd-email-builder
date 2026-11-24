/* UI wiring. Campaigns come from /campaigns (read-only here); edits in Settings last for the
   session and can be copied/downloaded as JSON to commit back to the repo. */
(function (W) {
  const { HPC, DEFAULTS, withDefaults, loadData, esc, slug, fmtDate, fmtAmt, clone } = W.core;
  const P = W.parse, R = W.render;
  const $ = s => document.querySelector(s);
  const LS_LAST = 'wwd-email-last-campaign';

  let T = {}, campaigns = [], currentId = null, draftTitle = '', imgData = {}, slotKey = null;
  let outputs = [], abIdx = 0, segIdx = 0, refTouched = false, downloads = null;
  const inClaude = !!(window.claude && window.claude.use);

  const camp = () => campaigns.find(c => c.id === currentId);
  const G = () => withDefaults(camp() ? camp().data : {});
  const getLast = () => { try { return localStorage.getItem(LS_LAST); } catch { return null; } };
  const setLast = id => { try { localStorage.setItem(LS_LAST, id); } catch {} };
  const subjects = () => $('#mSubjects').value.split('\n').map(s => s.trim()).filter(Boolean);
  const askVal = () => { const m = $('#mAsk').value.replace(/[$,\s]/g, '').match(/^\d+(?:\.\d{1,2})?$/); return m ? m[0] : ''; };

  /* ---------- campaigns ---------- */
  function renderCampaigns() {
    const sel = $('#guideSel');
    const list = campaigns.slice().sort((a, b) => (a.data.name || '').localeCompare(b.data.name || ''));
    sel.innerHTML = list.length ? list.map(c => `<option value="${esc(c.id)}">${esc(c.data.name || c.id)}${c.edited ? ' (edited)' : ''}</option>`).join('') : '<option value="">No campaigns yet</option>';
    if (!camp()) currentId = (getLast() && campaigns.some(c => c.id === getLast())) ? getLast() : (list[0] && list[0].id) || null;
    sel.value = currentId || '';
    $('#editGuide').disabled = !currentId;
  }
  function onCampaignChange(resetPage) {
    const g = G(), sel = $('#pageSel'), prev = sel.value;
    sel.innerHTML = g.pages.map((p, i) => `<option value="${i}">${esc(p.name || 'Page ' + (i + 1))}</option>`).join('') + '<option value="custom">Other URL…</option>';
    if (!resetPage && prev && sel.querySelector(`option[value="${prev}"]`)) sel.value = prev;
    else sel.value = g.pages.length ? String(Math.min(g.defaultPage || 0, g.pages.length - 1)) : 'custom';
    $('#customUrlWrap').hidden = sel.value !== 'custom';
    if (!refTouched) $('#refcode').value = refBase(g);
    renderPhRows(); renderLegend(); slotKey = null;
  }
  const refBase = g => g.refPattern.replace(/%DATE%/g, fmtDate($('#mDate').value) || 'MM.DD.YY');
  const pageUrl = () => { const v = $('#pageSel').value; return v === 'custom' ? $('#customUrl').value.trim() : ((G().pages[+v] || {}).url || ''); };
  function matchCampaign(text) {
    const t = (text || '').toLowerCase(); if (!t) return;
    const hit = campaigns.filter(c => c.data.name && t.includes(c.data.name.toLowerCase())).sort((a, b) => b.data.name.length - a.data.name.length)[0];
    if (hit && hit.id !== currentId) { currentId = hit.id; setLast(hit.id); $('#guideSel').value = hit.id; onCampaignChange(true); }
  }
  $('#guideSel').onchange = e => { currentId = e.target.value || null; if (currentId) setLast(currentId); onCampaignChange(true); build(); };
  $('#pageSel').onchange = () => { $('#customUrlWrap').hidden = $('#pageSel').value !== 'custom'; build(); };
  $('#refcode').addEventListener('input', () => { refTouched = true; });
  $('#mDate').addEventListener('input', () => { if (!refTouched) $('#refcode').value = refBase(G()); });

  /* ---------- custom placeholders (session) ---------- */
  function renderPhRows() {
    const c = camp(); const rows = c ? (c.data.placeholders || []) : [];
    $('#phRows').innerHTML = rows.map((r, i) => `<div class="prow"><input type="text" data-ph="${i}" data-f="token" placeholder="[[ TOKEN ]]" value="${esc(r.token)}"><input type="text" data-ph="${i}" data-f="html" placeholder="Replacement HTML" value="${esc(r.html)}"><button class="x" data-rm="${i}" aria-label="Remove placeholder">×</button></div>`).join('');
    $('#addPh').disabled = !c;
  }
  function touch() { const c = camp(); if (c && !c.edited) { c.edited = true; renderCampaigns(); } }
  $('#phRows').addEventListener('input', e => { const el = e.target, c = camp(); if (!c || el.dataset.ph == null) return; c.data.placeholders[+el.dataset.ph][el.dataset.f] = el.value; touch(); renderLegend(); rebuild(); });
  $('#phRows').addEventListener('click', e => { const b = e.target.closest('[data-rm]'), c = camp(); if (!b || !c) return; c.data.placeholders.splice(+b.dataset.rm, 1); touch(); renderPhRows(); build(); });
  $('#addPh').onclick = () => { const c = camp(); if (!c) return; (c.data.placeholders ||= []).push({ token: '', html: '' }); touch(); renderPhRows(); const ins = $('#phRows').querySelectorAll('input[data-f="token"]'); ins[ins.length - 1].focus(); };
  const activeRepl = () => (G().placeholders || []).filter(r => r.token && r.token.trim()).map(r => ({ token: r.token.trim(), html: r.html || '' }));

  /* ---------- legend ---------- */
  function renderLegend() {
    const g = G();
    const rows = [
      ['[[ ABX ]]', `ActBlue Express grid, two per row, plus “${esc(g.abx.otherLabel)}”`],
      ['[[ ABX 5, 25, 50 ]]', 'Grid with these amounts'],
      ['[[ RUSH $5 NOW ]]', 'One express button for that amount'],
      ['[[ DONATE ]]', 'Button to the page you’re raising into'],
      ['Blue or underlined text', 'Bold link to the page you’re raising into, with the refcode'],
      ['NAME · NAME/team', 'Name merge tag; fallback capitalized only at the start of a sentence'],
      ['$ASK', 'The Ask amount, or the campaign’s HPC ask'],
      ['DONOR: … / NONDONOR: …', 'A separate version for each segment label'],
      ['[[ IMG ]]', 'Image slot (images in the draft are added automatically)'],
      ['[[ HR ]]', 'Divider line'],
    ];
    for (const r of activeRepl()) rows.push([r.token, 'Custom']);
    $('#legendTable').innerHTML = rows.map(([a, b]) => `<tr><td><code>${esc(a)}</code></td><td>${b}</td></tr>`).join('');
  }

  /* ---------- draft details ---------- */
  function applyMeta(meta) {
    const set = (id, v) => { $(id).value = v || ''; };
    const extra = [], got = {};
    for (const r of meta.rows) { const k = P.labelKey(r.label); const vals = r.values.map(W.core.stripNum).filter(Boolean); if (k) got[k] = vals; else if (vals.length) extra.push(`${r.label}: ${vals.join('; ')}`); }
    set('#mDesc', (got.desc || []).join(' ')); set('#mSender', (got.sender || [])[0]); set('#mSubjects', (got.subjects || []).join('\n'));
    set('#mPreview', (got.preview || []).join(' ')); set('#mSegments', (got.segments || []).join(', ')); set('#mDate', (got.date || []).join(' '));
    set('#mAsk', (got.ask || []).join('').replace(/[^\d.]/g, ''));
    draftTitle = meta.title || '';
    $('#mExtra').hidden = !extra.length; $('#mExtra').textContent = extra.join(' · ');
    matchCampaign(draftTitle + ' ' + ((got.sender || [])[0] || ''));
    refTouched = false;
    if (got.refcode) { $('#refcode').value = got.refcode[0]; refTouched = true; } else $('#refcode').value = refBase(G());
    if (got.page) {
      const want = got.page.join(' ').toLowerCase(), g = G();
      const i = g.pages.findIndex(p => (p.url && want.includes(p.url.toLowerCase())) || (p.name && want.includes(p.name.toLowerCase())));
      if (i >= 0) $('#pageSel').value = String(i);
      else { const u = /https?:\/\/\S+/.exec(got.page.join(' ')); if (u) { $('#pageSel').value = 'custom'; $('#customUrl').value = u[0]; } }
      $('#customUrlWrap').hidden = $('#pageSel').value !== 'custom';
    }
  }
  function clearMeta() { ['#mDesc', '#mSender', '#mSubjects', '#mPreview', '#mAsk', '#mSegments', '#mDate'].forEach(s => $(s).value = ''); $('#mExtra').hidden = true; draftTitle = ''; imgData = {}; refTouched = false; $('#refcode').value = refBase(G()); }
  function loadParsed(res, note) {
    clearMeta(); applyMeta(res);
    imgData = {}; for (const [k, im] of Object.entries(res.images || {})) imgData[k] = typeof im === 'string' ? { preview: im } : { preview: im.src || '', docWidth: im.width || 0 };
    slotKey = null; $('#source').innerHTML = res.bodyHTML;
    build();
    toast(res.noMarker ? 'Loaded, but there’s no “BEGIN EMAIL DRAFT” line, so the whole doc is in the copy.' : note);
  }

  /* ---------- loading drafts ---------- */
  if (!inClaude) { $('#docRow').hidden = true; $('#orWord').textContent = ''; }
  $('#loadDoc').onclick = async () => {
    const link = $('#docUrl').value.trim();
    const m = /\/d\/([a-zA-Z0-9_-]{20,})/.exec(link) || /^([a-zA-Z0-9_-]{25,})$/.exec(link);
    if (!m) { toast('Paste a Google Doc link, like docs.google.com/document/d/…'); return; }
    const btn = $('#loadDoc'); btn.disabled = true; btn.textContent = 'Loading…';
    try {
      const mcp = await window.claude.use('mcp');
      if (!mcp) { toast('Google Drive isn’t available here. Download the doc as .docx and import it.'); return; }
      const res = await mcp.callTool('Google Drive', 'download_file_content', { fileId: m[1], exportMimeType: 'text/html' }, { cache: false });
      const html = P.extractHtml(res);
      if (!html) { toast('Google Drive sent back something unexpected. Try importing the .docx instead.'); return; }
      loadParsed(P.parseHtmlString(html), 'Draft loaded from Google Docs');
    } catch (e) {
      const c = e && e.code;
      toast(c === 'server_not_connected' ? 'Connect Google Drive in claude.ai Settings → Connectors, then try again.'
        : c === 'needs_reauth' ? 'Reconnect Google Drive in claude.ai Settings → Connectors, then try again.'
        : (c === 'not_granted' || c === 'consent_required') ? 'Google Drive access wasn’t allowed for this page.'
        : c === 'tool_error' ? 'That doc couldn’t be opened. Check the link and that your Google account can see it.'
        : 'Loading the doc didn’t work. Try again, or import the .docx.');
    } finally { btn.disabled = false; btn.textContent = 'Load draft'; }
  };
  $('#docUrl').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loadDoc').click(); });

  async function importFile(file) {
    if (!file) return;
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.docx')) loadParsed(await P.parseDocx(await file.arrayBuffer()), 'Draft imported');
      else if (name.endsWith('.pdf')) loadParsed(await P.parsePdf(await file.arrayBuffer()), 'Draft imported from PDF. Italics and existing links don’t carry over from PDFs.');
      else throw new Error('Use a .docx or .pdf file.');
    } catch (e) { toast(e.message || 'That file couldn’t be read.'); }
  }
  $('#file').addEventListener('change', e => { importFile(e.target.files[0]); e.target.value = ''; });
  const src = $('#source');
  src.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); src.classList.add('drag'); } });
  src.addEventListener('dragleave', () => src.classList.remove('drag'));
  src.addEventListener('drop', e => { src.classList.remove('drag'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) { e.preventDefault(); importFile(f); } });
  src.addEventListener('paste', () => setTimeout(() => {
    if (P.BEGIN_RE.test(src.textContent)) { const r = P.splitHtml(src); if (r) { loadParsed(r, 'Details filled from the draft'); return; } }
    build();
  }, 30));

  /* ---------- image slots ---------- */
  function renderSlots(keys) {
    const sig = keys.join(','); if (sig === slotKey) return; slotKey = sig;
    $('#imgs').hidden = !keys.length;
    $('#imgSlots').innerHTML = keys.map(k => `<div class="slot"><span>Image ${esc(k)}</span>
      ${imgData[k]?.preview ? `<img class="thumb" src="${imgData[k].preview}" alt="Image ${esc(k)} from the draft">` : '<span></span>'}
      <input type="url" data-img="${esc(k)}" data-f="url" placeholder="Hosted image URL" value="${esc(imgData[k]?.url || '')}">
      <input type="url" data-img="${esc(k)}" data-f="link" placeholder="Link (default: page you’re raising into)" value="${esc(imgData[k]?.link || '')}">
      <span class="wrow"><input type="number" min="50" max="800" step="10" data-img="${esc(k)}" data-f="width" placeholder="${esc(G().image.maxWidth)}" value="${esc(imgData[k]?.width || '')}" aria-label="Max width for image ${esc(k)} in pixels"><span>px max width${imgData[k]?.width ? '' : ' (campaign default)'}</span>${imgData[k]?.docWidth && +imgData[k].docWidth !== +(imgData[k].width || G().image.maxWidth) ? ` <button class="linkbtn" data-usew="${esc(k)}">Use doc size (${imgData[k].docWidth}px)</button>` : ''}</span></div>`).join('');
  }
  $('#imgSlots').addEventListener('input', e => {
    const el = e.target; if (!el.dataset.img) return;
    (imgData[el.dataset.img] ||= {})[el.dataset.f] = el.value.trim();
    if (el.dataset.f === 'width') { const lab = el.nextElementSibling; if (lab) lab.textContent = 'px max width' + (el.value.trim() ? '' : ' (campaign default)'); }
    rebuild();
  });
  $('#imgSlots').addEventListener('click', e => {
    const b = e.target.closest('[data-usew]'); if (!b) return;
    const k = b.dataset.usew; imgData[k].width = String(imgData[k].docWidth);
    slotKey = null; build();
  });

  /* ---------- build ---------- */
  function build() {
    const g = G();
    const { blocks, imageKeys, segs } = R.blocksFrom($('#source'));
    renderSlots(imageKeys);
    const subs = subjects();
    const abList = (subs.length ? subs : ['']).map((s, i) => ({ letter: String.fromCharCode(97 + i), subject: s }));
    const segList = segs.length ? segs : [null];
    const pattern = $('#refcode').value.trim() || refBase(g);
    outputs = [];
    for (const ab of abList) {
      let ref = pattern.includes('%V%') ? pattern.replace(/%V%/g, ab.letter) : (abList.length > 1 ? pattern + '-' + ab.letter : pattern);
      ref = ref.replace(/%DATE%/g, fmtDate($('#mDate').value));
      for (const seg of segList) {
        const V = { g, T, page: pageUrl(), ref, seg, ask: askVal(), imgData, repl: activeRepl(), st: R.newStats() };
        outputs.push({ ab, seg, ref, html: R.body(blocks, V), st: V.st });
      }
    }
    abIdx = Math.min(abIdx, abList.length - 1); segIdx = Math.min(segIdx, segList.length - 1);
    renderTabs(abList, segList); show();
  }
  let t; const rebuild = () => { clearTimeout(t); t = setTimeout(build, 200); };
  ['#mDesc', '#mSender', '#mSubjects', '#mPreview', '#mAsk', '#mSegments', '#mDate', '#refcode', '#customUrl'].forEach(s => $(s).addEventListener('input', rebuild));
  src.addEventListener('input', rebuild);
  $('#clearSrc').addEventListener('click', () => { src.innerHTML = ''; $('#docUrl').value = ''; clearMeta(); slotKey = null; build(); });

  /* ---------- output ---------- */
  const prettySeg = s => s.charAt(0) + s.slice(1).toLowerCase().replace(/-/g, ' ');
  const abCount = () => new Set(outputs.map(o => o.ab.letter)).size;
  const cur = () => outputs[abIdx * (outputs.length / Math.max(1, abCount())) + segIdx];
  function renderTabs(abList, segList) {
    const a = $('#abTabs'), s = $('#segTabs');
    a.hidden = abList.length < 2; s.hidden = segList.length < 2;
    a.innerHTML = abList.length < 2 ? '' : abList.map((x, i) => `<button data-ab="${i}" aria-pressed="${i === abIdx}">${x.letter.toUpperCase()}</button>`).join('');
    s.innerHTML = segList.length < 2 ? '' : segList.map((x, i) => `<button data-seg="${i}" aria-pressed="${i === segIdx}">${esc(prettySeg(x))}</button>`).join('');
  }
  $('#abTabs').addEventListener('click', e => { const b = e.target.closest('[data-ab]'); if (!b) return; abIdx = +b.dataset.ab; [...$('#abTabs').children].forEach((x, i) => x.setAttribute('aria-pressed', i === abIdx)); show(); });
  $('#segTabs').addEventListener('click', e => { const b = e.target.closest('[data-seg]'); if (!b) return; segIdx = +b.dataset.seg; [...$('#segTabs').children].forEach((x, i) => x.setAttribute('aria-pressed', i === segIdx)); show(); });

  const finalHTML = (o, forPreview) => o.html.replace(/%%IMG_([^%]+)%%/g, (m, k) => { const d = imgData[k] || {}; return d.url ? esc(d.url) : (forPreview ? (d.preview || '') : ''); });
  const previewDoc = frag => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px 16px;background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#222}.wrap{max-width:600px;margin:0 auto}p{margin:0 0 16px}a{color:#1155cc}img[src=""]{min-height:120px;background:#eee;outline:1px dashed #bbb}</style></head><body><div class="wrap">${frag}</div></body></html>`;
  function show() {
    const o = cur(); if (!o) return;
    const st = o.st;
    $('#code').value = finalHTML(o, false);
    $('#preview').srcdoc = previewDoc(finalHTML(o, true));
    $('#verinfo').innerHTML = (o.ab.subject ? `<span><b>Subject ${o.ab.letter.toUpperCase()}:</b> ${esc(o.ab.subject)} <button class="linkbtn" id="copySubj">Copy</button></span>` : '') +
      `<span><b>Refcode:</b> <code>${esc(o.ref)}</code></span>` + (o.seg ? `<span><b>Segment:</b> ${esc(prettySeg(o.seg))}</span>` : '');
    const cs = $('#copySubj'); if (cs) cs.onclick = () => copyText(o.ab.subject, 'Subject line copied');
    const unknown = new Set(), imgMissing = new Set(); let noPage = false;
    for (const x of outputs) { x.st.unknown.forEach(u => unknown.add(u)); x.st.imgMissing.forEach(k => imgMissing.add(k)); noPage ||= x.st.noPage; }
    const notes = [];
    if (!currentId) notes.push(['warn', 'No campaign selected. Add one to campaigns/ in the repo, or use New.']);
    if (noPage) notes.push(['warn', 'No donation page is set. Pick one under Raising into, or add one in Settings.']);
    if (/MM\.DD\.YY/.test(o.ref)) notes.push(['warn', 'The refcode needs the draft date. Fill in Date.']);
    if (imgMissing.size) notes.push(['warn', `Image ${[...imgMissing].join(', ')} needs a hosted URL (see Images). The preview shows the draft’s copy.`]);
    if (unknown.size) notes.push(['warn', `Not converted: ${[...unknown].map(esc).join(', ')}. Check spelling, or add it as a custom placeholder.`]);
    if (st.blocks && !notes.length) {
      const bits = [];
      if (outputs.length > 1) bits.push(`${outputs.length} versions`);
      if (st.names) bits.push(`${st.names} NAME tag${st.names > 1 ? 's' : ''}`);
      if (st.asks) bits.push(askVal() ? `$ASK → $${fmtAmt(askVal())}` : '$ASK → HPC ask');
      if (st.askLinks) bits.push('ask lines linked');
      if (st.abx) bits.push(`${st.abx} ABX grid${st.abx > 1 ? 's' : ''}`);
      if (st.buttons) bits.push(`${st.buttons} button${st.buttons > 1 ? 's' : ''}`);
      notes.push(['ok', 'Ready. ' + bits.join(', ') + (bits.length ? '.' : '')]);
    }
    $('#checks').innerHTML = notes.map(([k, t]) => `<div class="note ${k}">${t}</div>`).join('');
  }
  $('#preview').addEventListener('load', () => { try { const d = $('#preview').contentDocument; $('#preview').style.height = Math.max(420, d.documentElement.scrollHeight + 4) + 'px'; } catch {} });

  /* ---------- view tabs ---------- */
  function setTab(code) {
    $('#tabPreview').setAttribute('aria-pressed', !code); $('#tabCode').setAttribute('aria-pressed', code);
    $('#stage').classList.toggle('off', code); $('#codewrap').classList.toggle('on', code);
    $('#widthTabs').style.visibility = code ? 'hidden' : 'visible';
  }
  $('#tabPreview').onclick = () => setTab(false);
  $('#tabCode').onclick = () => setTab(true);
  $('#wDesk').onclick = () => { $('#frame').classList.remove('mobile'); $('#wDesk').setAttribute('aria-pressed', true); $('#wMob').setAttribute('aria-pressed', false); };
  $('#wMob').onclick = () => { $('#frame').classList.add('mobile'); $('#wMob').setAttribute('aria-pressed', true); $('#wDesk').setAttribute('aria-pressed', false); };

  /* ---------- copy / download ---------- */
  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg); return; } catch {}
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove();
    toast(ok ? msg : 'Copy didn’t work here. Select the text and copy by hand.');
  }
  async function saveFile(filename, text, type) {
    if (downloads) {
      try { await downloads.save({ filename, data: text }); toast(`${filename} downloaded`); }
      catch (e) { if (!(e && e.code === 'declined')) toast('Download didn’t work here. Use Copy instead.'); }
      return;
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = filename;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  $('#copy').onclick = () => {
    const o = cur(); if (!o) return;
    const tag = [abCount() > 1 ? o.ab.letter.toUpperCase() : '', o.seg ? prettySeg(o.seg) : ''].filter(Boolean).join(' · ');
    copyText(finalHTML(o, false), (tag ? tag + ' ' : '') + 'HTML copied');
  };
  $('#dl').onclick = () => {
    const o = cur(); if (!o) return;
    const name = [fmtDate($('#mDate').value).replace(/\./g, '-'), slug($('#mDesc').value || G().name), o.ab.letter, o.seg ? o.seg.toLowerCase() : ''].filter(Boolean).join('-') + '.html';
    saveFile(name, finalHTML(o, false), 'text/html');
  };

  /* ---------- campaign settings (session + JSON export) ---------- */
  const dlg = $('#dlg'); let dlgPages = [], dlgDefault = 0, editing = null;
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const setPath = (o, p, v) => { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach(k => { a[k] = a[k] || {}; a = a[k]; }); a[ks[ks.length - 1]] = v; };
  function renderPageRows() {
    $('#pageRows').innerHTML = dlgPages.map((p, i) => `<div class="prow page"><input type="radio" name="defpage" data-def="${i}" ${i === dlgDefault ? 'checked' : ''} aria-label="Default page"><input type="text" data-pg="${i}" data-f="name" placeholder="Q4, Recount…" value="${esc(p.name)}"><input type="url" data-pg="${i}" data-f="url" placeholder="https://secure.actblue.com/donate/…" value="${esc(p.url)}"><button class="x" data-rmpg="${i}" aria-label="Remove page">×</button></div>`).join('') || '<p class="extra">No pages yet.</p>';
  }
  $('#pageRows').addEventListener('input', e => { const el = e.target; if (el.dataset.pg != null) dlgPages[+el.dataset.pg][el.dataset.f] = el.value.trim(); });
  $('#pageRows').addEventListener('change', e => { if (e.target.dataset.def != null) dlgDefault = +e.target.dataset.def; });
  $('#pageRows').addEventListener('click', e => { const b = e.target.closest('[data-rmpg]'); if (!b) return; dlgPages.splice(+b.dataset.rmpg, 1); if (dlgDefault >= dlgPages.length) dlgDefault = 0; renderPageRows(); });
  $('#addPage').onclick = () => { dlgPages.push({ name: '', url: '' }); renderPageRows(); };
  const syncSwatches = () => { for (const s of dlg.querySelectorAll('[data-v]')) s.textContent = dlg.querySelector(`[data-k="${s.dataset.v}"]`).value.toUpperCase(); };
  dlg.addEventListener('input', syncSwatches);

  function openSettings(c) {
    editing = c;
    const g = withDefaults(c.data);
    for (const el of dlg.querySelectorAll('[data-k]')) { let v = getPath(g, el.dataset.k); if (Array.isArray(v)) v = v.join(', '); el.value = v ?? ''; }
    dlgPages = g.pages.map(p => ({ name: p.name || '', url: p.url || '' })); dlgDefault = g.defaultPage || 0; renderPageRows(); syncSwatches();
    $('#dlgTitle').textContent = c.isNew ? 'New campaign' : (g.name || 'Campaign') + ' settings';
    $('#dlgNote').innerHTML = c.isNew
      ? `To add this campaign for everyone: download the JSON, save it as <code>campaigns/${esc(c.file)}</code> in the repo, and add <code>"${esc(c.file)}"</code> to <code>campaigns/index.json</code>.`
      : `These settings come from <code>campaigns/${esc(c.file)}</code>. Changes here last until you reload. To make them permanent for everyone, copy or download the JSON and replace that file in the repo.`;
    dlg.showModal();
  }
  function readSettings() {
    const d = clone(editing.data);
    for (const el of dlg.querySelectorAll('[data-k]')) {
      const k = el.dataset.k; let v = el.value;
      if (k === 'abx.amounts') v = (v.match(/\d+(?:\.\d{1,2})?/g) || []).map(Number);
      else if (el.type === 'number') v = +v || getPath(DEFAULTS, k);
      setPath(d, k, v);
    }
    d.pages = dlgPages.filter(p => p.url); d.defaultPage = Math.min(dlgDefault, Math.max(0, d.pages.length - 1));
    d.name = (d.name || '').trim() || 'Untitled campaign';
    if (!d.placeholders) d.placeholders = [];
    return d;
  }
  const jsonFor = d => JSON.stringify(withDefaults(d), null, 2) + '\n';
  $('#editGuide').onclick = () => { const c = camp(); if (c) openSettings(c); };
  $('#newGuide').onclick = () => openSettings({ id: null, file: 'new-campaign.json', isNew: true, data: clone(DEFAULTS) });
  $('#dlgClose').onclick = () => dlg.close();
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  $('#applyGuide').onclick = () => {
    const d = readSettings();
    if (editing.isNew) {
      let id = slug(d.name), i = 2; while (campaigns.some(c => c.id === id)) id = slug(d.name) + '-' + i++;
      editing = { id, file: id + '.json', data: d, isNew: true, edited: true }; campaigns.push(editing);
    } else { editing.data = d; editing.edited = true; }
    currentId = editing.id; setLast(currentId);
    renderCampaigns(); onCampaignChange(true); build(); dlg.close();
    toast(editing.isNew ? `Added for this session. Download the JSON to save it as campaigns/${editing.file}.` : 'Applied for this session. Copy the JSON to make it permanent.');
  };
  $('#copyJson').onclick = () => copyText(jsonFor(readSettings()), 'Campaign JSON copied');
  $('#dlJson').onclick = () => { const d = readSettings(); saveFile(editing.isNew ? slug(d.name) + '.json' : editing.file, jsonFor(d), 'application/json'); };

  let tt; function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), 3600); }

  /* ---------- start ---------- */
  (async () => {
    try {
      const data = await loadData();
      T = data.templates;
      campaigns = data.campaigns.map(c => ({ id: c.id, file: c.file, data: c.data }));
      $('#sourceNote').innerHTML = `<b>${campaigns.length}</b> campaign${campaigns.length === 1 ? '' : 's'} from the repo${window.WWD_BUNDLE && window.WWD_BUNDLE.builtAt ? ' · built ' + esc(window.WWD_BUNDLE.builtAt) : ''}`;
    } catch (e) {
      $('#sourceNote').textContent = 'Couldn’t load campaigns';
      toast((e && e.message ? e.message + '. ' : '') + 'Serve the folder over http (see README), not as a file.');
      return;
    }
    renderCampaigns(); onCampaignChange(true); build();
    if (inClaude) { try { downloads = await window.claude.use('downloads'); } catch {} }
  })();
})(window.WWD);
