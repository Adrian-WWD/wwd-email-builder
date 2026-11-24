/* Turns the email copy into EveryAction-ready HTML.
   V (the version being rendered) = { g: campaign, T: templates, page, ref, seg, ask, imgData, repl, st: stats } */
(function (W) {
  const { fill, esc, escText, norm, setParams, isActBlue, fmtAmt, parseAmounts, cap, low } = W.core;

  const BLOCK = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','SECTION','ARTICLE','TABLE','TBODY','THEAD','TR','TD','TH','UL','OL','HR','PRE','HEADER','FOOTER','MAIN','CENTER']);
  const SKIP = new Set(['STYLE','SCRIPT','META','TITLE','LINK','IMG','svg','SVG','COLGROUP','COL']);
  const PH = /^\[\[?\s*([^\[\]]*?)\s*\]?\]$/;           // a line that is only [[ … ]] or [ … ]
  const SEG = /^([A-Z][A-Z-]{2,15}):\s+/;                 // DONOR: / NONDONOR: …
  const LINK_COLOR = /(^|;)\s*color\s*:\s*(#0000ff|#00f\b|#1155cc|rgb\(\s*0\s*,\s*0\s*,\s*255\s*\))/i;

  /* ---------- DOM → blocks ---------- */
  const hasBlock = el => { for (const n of el.querySelectorAll('*')) if (BLOCK.has(n.tagName)) return true; return false; };
  function walk(node, out) {
    let buf = [];
    const flush = () => { if (buf.length) { out.push({ type: 'run', nodes: buf }); buf = []; } };
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) { buf.push(ch); continue; }
      if (ch.nodeType !== 1 || SKIP.has(ch.tagName)) continue;
      const t = ch.tagName;
      if (t === 'UL' || t === 'OL') { flush(); out.push({ type: 'list', ordered: t === 'OL', items: [...ch.children].filter(li => li.tagName === 'LI').map(li => ({ nodes: [...li.childNodes] })) }); }
      else if (/^H[1-6]$/.test(t)) { flush(); if (hasBlock(ch)) walk(ch, out); else out.push({ type: 'h', level: Math.min(3, +t[1]), nodes: [...ch.childNodes] }); }
      else if (t === 'HR') { flush(); out.push({ type: 'hr' }); }
      else if (BLOCK.has(t)) { flush(); if (hasBlock(ch)) walk(ch, out); else out.push({ type: 'p', nodes: [...ch.childNodes] }); }
      else { if (hasBlock(ch)) { flush(); walk(ch, out); } else buf.push(ch); }
    }
    flush();
  }
  function normalize(blocks) {
    const res = [];
    for (const b of blocks) {
      if (b.type !== 'run') { res.push(b); continue; }
      let cur = [], brs = 0;
      const push = () => { if (cur.some(n => (n.textContent || '').trim())) res.push({ type: 'p', nodes: cur }); cur = []; };
      for (const n of b.nodes) {
        if (n.nodeType === 1 && n.tagName === 'BR') { brs++; if (brs >= 2) { push(); brs = 0; } else cur.push(n); continue; }
        if (n.nodeType === 3 && !n.nodeValue.trim() && brs) continue;
        brs = 0; cur.push(n);
      }
      push();
    }
    return res;
  }
  const plain = nodes => nodes.map(n => n.textContent || '').join('').replace(/\u00a0/g, ' ').trim();

  function blocksFrom(sourceEl) {
    const out = []; walk(sourceEl.cloneNode(true), out);
    const blocks = normalize(out);
    // image slots
    let auto = 0; const imageKeys = [];
    for (const b of blocks) {
      if (b.type !== 'p') continue;
      const m = PH.exec(plain(b.nodes)); if (!m) continue;
      const im = /^im(?:g|age)\b\s*(\d*)/i.exec(m[1]); if (!im) continue;
      b.imgKey = im[1] || String(++auto); if (!imageKeys.includes(b.imgKey)) imageKeys.push(b.imgKey);
    }
    // segment versions (need two or more labels)
    const segs = [];
    for (const b of blocks) { if (b.type !== 'p') continue; const m = SEG.exec(plain(b.nodes)); if (m) { b.seg = m[1]; if (!segs.includes(m[1])) segs.push(m[1]); } }
    if (segs.length < 2) { blocks.forEach(b => delete b.seg); segs.length = 0; }
    return { blocks, imageKeys, segs };
  }

  /* ---------- inline ---------- */
  function inl(n, V, ctx) {
    if (n.nodeType === 3) return escText(n.nodeValue.replace(/\u00a0/g, ' '));
    if (n.nodeType !== 1 || SKIP.has(n.tagName)) return '';
    const t = n.tagName;
    if (t === 'BR') return '<br>';
    const inLink = ctx && ctx.inLink;
    const kids = c => [...n.childNodes].map(x => inl(x, V, c || ctx)).join('');
    const style = n.getAttribute('style') || '';
    let bold = t === 'B' || t === 'STRONG', ital = t === 'I' || t === 'EM', und = t === 'U';
    const fw = /font-weight\s*:\s*([a-z0-9]+)/i.exec(style);
    if (fw) { const v = fw[1].toLowerCase(); bold = v === 'bold' || v === 'bolder' || (+v >= 600); }
    if (/font-style\s*:\s*italic/i.test(style)) ital = true;
    if (/text-decoration[^;]*underline/i.test(style) || LINK_COLOR.test(style)) und = true;
    if (t === 'A') {
      let href = (n.getAttribute('href') || '').trim();
      const gq = /^https?:\/\/(www\.)?google\.com\/url\?q=([^&]+)/i.exec(href); if (gq) href = decodeURIComponent(gq[2]);
      if (!/^(https?:|mailto:|tel:|\{\{)/i.test(href)) return kids();
      if (isActBlue(href)) href = setParams(href, [['refcode', V.ref]]);
      V.st.links++;
      let inner = kids({ inLink: true }); if (bold) inner = `<strong>${inner}</strong>`;
      return `<a href="${esc(href)}">${inner}</a>`;
    }
    let h = kids({ inLink });
    if (!h) return '';
    if (ital) h = `<em>${h}</em>`;
    if (bold) h = `<strong>${h}</strong>`;
    if (und && !inLink) {                       // underlined or blue text = ask link to the page
      if (!V.page) V.st.noPage = true;
      V.st.askLinks++;
      h = `<a href="${esc(setParams(V.page, [['refcode', V.ref]]) || '#')}">${h}</a>`;
    }
    return h;
  }
  function tidy(h) {
    let prev;
    do { prev = h; h = h.replace(/(<a href="([^"]+)">)((?:(?!<\/a>)[\s\S])*)<\/a>(\s*)<a href="\2">/g, '$1$3$4'); } while (h !== prev);
    return h.replace(/<\/strong>(\s*)<strong>/g, '$1').replace(/<\/em>(\s*)<em>/g, '$1');
  }
  function applyMerges(html, V) {
    const g = V.g;
    html = html.replace(/\$ASK\b( )?/g, (m, sp) => { V.st.asks++; return '$' + (V.ask ? fmtAmt(V.ask) : g.askMerge) + (sp ? ' ' : ''); });
    return html.replace(/\bNAME(?:\/([A-Za-z][A-Za-z'’-]*))?\b/g, (m, fb, off, str) => {
      V.st.names++;
      const before = str.slice(0, off).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      const start = !before || /[.!?]["'”’)\]]*$/.test(before);
      const w = fb || g.audience || 'friend';
      return g.mergeTag.replace(/%FALLBACK%/g, start ? cap(w) : low(w));
    });
  }
  const inlineHTML = (nodes, V) => tidy(nodes.map(n => inl(n, V)).join('')).replace(/^(\s|<br>)+|(\s|<br>)+$/g, '');

  /* ---------- components (from /templates) ---------- */
  const cell = (V, href, label, color) => fill(V.T['abx-cell'], { HREF: esc(href), LABEL: label, COLOR: color });
  function row(V, cells) {
    const inner = cells[0] + '\n' + (cells[1] ? V.T['abx-ghost-mid'] + '\n\n' + cells[1] + '\n' + V.T['abx-ghost-end'] : '');
    return fill(V.T['abx-row'], { CELLS: inner });
  }
  function abxGrid(amounts, V) {
    const g = V.g, base = V.page;
    const cells = amounts.map(a => cell(V, setParams(base, [['refcode', V.ref], ['express_lane', 'true'], ['amount', fmtAmt(a)]]), escText(g.abx.label.replace(/%AMT%/g, fmtAmt(a))), g.abx.color));
    cells.push(cell(V, setParams(base, [['refcode', V.ref]]), escText(g.abx.otherLabel), g.abx.otherColor));
    const rows = []; for (let i = 0; i < cells.length; i += 2) rows.push(row(V, cells.slice(i, i + 2)));
    const intro = g.abx.intro ? fill(V.T['abx-intro'], { TEXT: escText(g.abx.intro) }) + '\n\n' : '';
    return fill(V.T['abx-grid'], { INTRO: intro, ROWS: rows.join('\n' + V.T['abx-row-separator'] + '\n\n') });
  }
  const oneButton = (V, href, label) => fill(V.T['single-button'], { ROW: row(V, [cell(V, href, label, V.g.abx.color)]) });
  function imageBlock(key, V) {
    const d = V.imgData[key] || {};
    if (!d.url) V.st.imgMissing.push(key);
    let link = (d.link || '').trim() || V.page;
    if (link && isActBlue(link)) link = setParams(link, [['refcode', V.ref]]);
    const width = Math.round(+d.width) || +V.g.image.maxWidth || 360;
    const border = (V.g.image.border || '').trim();
    return fill(V.T.image, { HREF: esc(link), SRC: `%%IMG_${key}%%`, ALT: esc(d.alt || ''), MAXWIDTH: width, BORDER: border ? ' border: ' + esc(border) + ';' : '' });
  }

  /* ---------- body ---------- */
  function body(blocks, V) {
    const g = V.g, repl = V.repl, parts = [], st = V.st;
    for (const b of blocks) {
      if (b.seg && b.seg !== V.seg) continue;
      if (b.type === 'hr') { parts.push('<hr />'); continue; }
      if (b.type === 'list') {
        const tag = b.ordered ? 'ol' : 'ul';
        const items = b.items.map(it => applyMerges(inlineHTML(it.nodes, V), V)).filter(Boolean).map(h => `<li>${h}</li>`).join('\n');
        if (items) parts.push(`<${tag}>\n${items}\n</${tag}>`);
        continue;
      }
      const text = plain(b.nodes); if (!text) continue;
      if (b.type === 'h') { parts.push(`<h${b.level}>${applyMerges(inlineHTML(b.nodes, V), V)}</h${b.level}>`); continue; }
      const custom = repl.find(r => norm(r.token) === norm(text));
      if (custom) { parts.push(applyMerges(custom.html, V)); continue; }
      const ph = PH.exec(text);
      if (ph && /^\[/.test(text)) {
        const inner = ph[1]; let m;
        if (!V.page && /^(abx|donate)\b|\$\s?\d/i.test(inner)) st.noPage = true;
        if ((m = /^abx\b\s*(.*)$/i.exec(inner))) { st.abx++; const amts = parseAmounts(m[1]); parts.push(abxGrid(amts.length ? amts : parseAmounts(g.abx.amounts), V)); continue; }
        if ((m = /^donate\b\s*(?::\s*(.*))?$/i.exec(inner))) { st.buttons++; parts.push(oneButton(V, setParams(V.page, [['refcode', V.ref]]), escText(m[1] || g.donateLabel))); continue; }
        if (/^(hr|divider)$/i.test(inner)) { parts.push('<hr />'); continue; }
        if (/^im(?:g|age)\b/i.test(inner)) { parts.push(imageBlock(b.imgKey, V)); continue; }
        const amt = /\$\s?(\d+(?:\.\d{1,2})?)\b/.exec(inner);
        if (amt) { st.buttons++; parts.push(oneButton(V, setParams(V.page, [['refcode', V.ref], ['express_lane', 'true'], ['amount', amt[1]]]), escText(inner))); continue; }
      }
      let html = inlineHTML(b.nodes, V);
      if (b.seg) html = html.replace(new RegExp('^((?:<[^>]+>)*)' + b.seg + ':\\s*'), '$1');
      for (const r of repl) html = html.split(escText(r.token)).join(r.html);
      html = applyMerges(html, V);
      for (const l of (text.match(/\[\[?[^\[\]]{1,40}\]?\]/g) || [])) if (!repl.some(r => norm(r.token) === norm(l))) st.unknown.add(l);
      parts.push(`<p>${html}</p>`);
    }
    st.blocks = parts.length;
    return parts.join('\n\n');
  }

  const newStats = () => ({ names: 0, asks: 0, links: 0, askLinks: 0, abx: 0, buttons: 0, noPage: false, unknown: new Set(), imgMissing: [], blocks: 0 });

  W.render = { blocksFrom, body, newStats };
})(window.WWD);
