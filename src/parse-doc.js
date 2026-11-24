/* Reads a draft (Google Doc HTML, .docx, .pdf, or pasted doc) into
   { title, rows: [{label, values}], bodyHTML, images: {n: dataURI} }.
   Everything above "BEGIN EMAIL DRAFT" is the details table; everything below is the copy. */
(function (W) {
  const { escText } = W.core;
  const BEGIN_RE = /BEGIN\s+EMAIL\s+DRAFT/i, END_RE = /END\s+EMAIL\s+DRAFT/i;
  const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  function labelKey(l) {
    l = l.toLowerCase();
    if (/desc/.test(l)) return 'desc'; if (/sender|^from/.test(l)) return 'sender'; if (/subject/.test(l)) return 'subjects';
    if (/preview|pre-?header/.test(l)) return 'preview'; if (/^ask/.test(l)) return 'ask'; if (/segment|audience/.test(l)) return 'segments';
    if (/date/.test(l)) return 'date'; if (/refcode|ref code/.test(l)) return 'refcode'; if (/page|link|form|url/.test(l)) return 'page';
    return null;
  }

  function splitHtml(root) {
    const doc = root.ownerDocument;
    let marker = null, endMarker = null;
    for (const b of root.querySelectorAll('p,h1,h2,h3,h4,h5,h6,div,li,td')) {
      if ([...b.children].some(c => /^(P|DIV|TABLE|UL|OL|H\d)$/.test(c.tagName))) continue;
      const t = b.textContent;
      if (!marker && BEGIN_RE.test(t)) marker = b; else if (marker && END_RE.test(t)) { endMarker = b; break; }
    }
    if (!marker) return null;
    const metaR = doc.createRange(); metaR.setStart(root, 0); metaR.setEndBefore(marker);
    const bodyR = doc.createRange(); bodyR.setStartAfter(marker);
    if (endMarker) bodyR.setEndBefore(endMarker); else bodyR.setEnd(root, root.childNodes.length);
    const metaDiv = doc.createElement('div'); metaDiv.append(metaR.cloneContents());
    const bodyDiv = doc.createElement('div'); bodyDiv.append(bodyR.cloneContents());
    const rows = []; let title = '';
    for (const tr of metaDiv.querySelectorAll('tr')) {
      const cells = [...tr.children].filter(c => /^T[DH]$/.test(c.tagName));
      if (cells.length === 1) { if (!title) title = cells[0].textContent.trim(); continue; }
      if (cells.length < 2) continue;
      const label = cells[0].textContent.trim(); if (!label) continue;
      const cell = cells[1]; let values;
      const lis = cell.querySelectorAll('li');
      if (lis.length) values = [...lis].map(li => li.textContent.trim());
      else {
        const tmp = cell.cloneNode(true);
        tmp.querySelectorAll('br').forEach(b => b.replaceWith('\n')); tmp.querySelectorAll('p,div').forEach(p => p.append('\n'));
        values = tmp.textContent.split('\n').map(s => s.trim()).filter(Boolean);
      }
      rows.push({ label, values });
    }
    metaDiv.querySelectorAll('table').forEach(t => t.remove());
    for (const p of metaDiv.querySelectorAll('p,h1,h2,h3,div')) {
      if ([...p.children].some(c => /^(P|DIV)$/.test(c.tagName))) continue;
      const t = p.textContent.trim(); if (!t) continue;
      const m = /^([A-Za-z][A-Za-z ]{1,24}):\s*(.+)$/.exec(t);
      if (m && labelKey(m[1])) rows.push({ label: m[1], values: [m[2]] }); else if (!title) title = t;
    }
    let i = 0; const images = {};
    bodyDiv.querySelectorAll('img').forEach(img => {
      const k = String(++i); const src = img.getAttribute('src') || '';
      if (/^data:image\//.test(src)) images[k] = src;
      const p = doc.createElement('p'); p.textContent = `[[ IMG ${k} ]]`; img.replaceWith(p);
    });
    return { title, rows, bodyHTML: bodyDiv.innerHTML, images };
  }

  /* The Google Drive connector's reply shape varies; find the HTML (plain or base64) wherever it is. */
  function extractHtml(res) {
    const cands = [];
    const visit = (v, d = 0) => { if (d > 6 || v == null) return; if (typeof v === 'string') { cands.push(v); return; } if (Array.isArray(v)) { v.forEach(x => visit(x, d + 1)); return; } if (typeof v === 'object') for (const k of Object.keys(v)) visit(v[k], d + 1); };
    visit(res && res.payload); visit(res && res.structuredContent); visit(res && res.content);
    const looks = s => /<html|<body|<p[\s>]/i.test(s);
    for (const s of cands) if (looks(s)) return s;
    for (const s of cands) {
      const t = s.replace(/\s/g, '');
      if (t.length > 100 && /^[A-Za-z0-9+/=_-]+$/.test(t)) {
        try {
          const bin = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
          let txt; try { txt = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); } catch { txt = decodeURIComponent(escape(bin)); }
          if (looks(txt)) return txt;
        } catch {}
      }
    }
    return null;
  }

  function parseHtmlString(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    return splitHtml(parsed.body) || { title: '', rows: [], bodyHTML: parsed.body.innerHTML, images: {}, noMarker: true };
  }

  async function parseDocx(buf) {
    if (!window.mammoth) throw new Error('The .docx reader didn’t load. Reload the page and try again.');
    const conv = await mammoth.convertToHtml({ arrayBuffer: buf }, { styleMap: ['u => u'] });
    const div = document.createElement('div'); div.innerHTML = conv.value;
    return splitHtml(div) || { title: '', rows: [], bodyHTML: conv.value, images: {}, noMarker: true };
  }

  /* PDF: rebuild lines with bold, blue (link) text and image positions. */
  async function parsePdf(buf) {
    if (!window.pdfjsLib) throw new Error('The PDF reader didn’t load. Reload the page and try again.');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const O = pdfjsLib.OPS;
    const mul = (m, n) => [m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1], m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3], m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5]];
    const seq = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const ops = await page.getOperatorList();
      let ctm = [1,0,0,1,0,0], fill = [0,0,0], lm = [1,0,0,1,0,0]; const stack = [], imgs = [], textRecs = [];
      ops.fnArray.forEach((f, i) => {
        const a = ops.argsArray[i];
        if (f === O.save) stack.push({ ctm: ctm.slice(), fill });
        else if (f === O.restore) { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; } }
        else if (f === O.transform) ctm = mul(ctm, a);
        else if (f === O.setFillRGBColor) fill = [a[0], a[1], a[2]];
        else if (f === O.setTextMatrix) lm = Array.from(a);
        else if (f === O.moveText) lm = [lm[0], lm[1], lm[2], lm[3], lm[0]*a[0] + lm[2]*a[1] + lm[4], lm[1]*a[0] + lm[3]*a[1] + lm[5]];
        else if (f === O.showText) textRecs.push({ x: ctm[0]*lm[4] + ctm[2]*lm[5] + ctm[4], y: ctm[1]*lm[4] + ctm[3]*lm[5] + ctm[5], blue: fill[2] > 150 && fill[0] < 100 && fill[1] < 150 });
        else if (f === O.paintFormXObjectBegin) { stack.push({ ctm: ctm.slice(), fill }); if (a && a[0]) ctm = mul(ctm, a[0]); }
        else if (f === O.paintFormXObjectEnd) { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; } }
        else if (f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintJpegXObject) {
          const w = Math.abs(ctm[0]), h = Math.abs(ctm[3]);
          if (w > 120 && h > 50) imgs.push({ top: ctm[5] + Math.max(ctm[3], 0) });
        }
      });
      const fontName = id => { try { return page.commonObjs.get(id)?.name || ''; } catch { return ''; } };
      const tc = await page.getTextContent();
      const lines = []; let cur = null;
      for (const it of tc.items) {
        const y = it.transform[5], h = Math.abs(it.transform[3]) || 11;
        if (!cur || Math.abs(y - cur.y) > 1.5) { if (it.str === '') { cur = null; continue; } cur = { kind: 'line', page: p, y, h, segs: [] }; lines.push(cur); }
        if (it.str !== '') {
          const fn = fontName(it.fontName), ix = it.transform[4];
          const link = textRecs.some(r => r.blue && Math.abs(r.y - y) < 1.5 && r.x >= ix - 1 && r.x <= ix + it.width);
          cur.segs.push({ str: it.str, x: ix, w: it.width, bold: /bold|black|heavy|semibold|demi/i.test(fn), ital: /italic|oblique/i.test(fn), link });
        }
        if (it.hasEOL) cur = null;
      }
      const pageSeq = lines.filter(l => l.segs.some(s => s.str.trim()));
      for (const im of imgs.sort((a, b) => b.top - a.top)) { const idx = pageSeq.findIndex(l => l.kind === 'line' && l.y < im.top); pageSeq.splice(idx < 0 ? pageSeq.length : idx, 0, { kind: 'img', page: p }); }
      seq.push(...pageSeq);
    }
    const lineText = l => l.segs.map(s => s.str).join('');
    const bi = seq.findIndex(l => l.kind === 'line' && BEGIN_RE.test(lineText(l)));
    let metaLines = [], bodyLines = seq;
    if (bi >= 0) {
      metaLines = seq.slice(0, bi).filter(l => l.kind === 'line'); bodyLines = seq.slice(bi + 1);
      const ei = bodyLines.findIndex(l => l.kind === 'line' && END_RE.test(lineText(l))); if (ei >= 0) bodyLines = bodyLines.slice(0, ei);
    }
    const rows = []; let title = '';
    const labelX = Math.min(...metaLines.map(l => l.segs.find(s => s.str.trim())?.x ?? 999));
    for (const l of metaLines) {
      const cells = []; let c = null, end = -1;
      for (const s of l.segs) { if (!s.str.trim()) continue; if (!c || s.x - end > 20) { c = { x: s.x, t: s.str }; cells.push(c); } else c.t += (s.x - end > 1 ? ' ' : '') + s.str; end = s.x + s.w; }
      if (!cells.length) continue;
      if (cells.length >= 2 && cells[0].x < labelX + 15) rows.push({ label: cells[0].t.trim(), values: [cells.slice(1).map(c => c.t).join(' ').trim()] });
      else if (rows.length && cells[0].x > labelX + 40) rows[rows.length - 1].values.push(cells.map(c => c.t).join(' ').trim());
      else { const t = cells.map(c => c.t).join(' ').trim(); const m = /^([A-Za-z][A-Za-z ]{1,24}):\s*(.+)$/.exec(t); if (m && labelKey(m[1])) rows.push({ label: m[1], values: [m[2]] }); else if (!title) title = t; }
    }
    const paras = []; let para = null, prev = null, imgN = 0;
    const lineHTML = l => {
      let out = '', run = null;
      const flush = () => { if (!run) return; let t = escText(run.t); if (run.ital) t = `<em>${t}</em>`; if (run.bold) t = `<strong>${t}</strong>`; if (run.link) t = `<u>${t}</u>`; out += t; run = null; };
      for (const s of l.segs) {
        const solid = !!s.str.trim();
        const b = solid ? s.bold : (run ? run.bold : s.bold), it = solid ? s.ital : (run ? run.ital : false), lk = solid ? !!s.link : (run ? run.link : false);
        if (run && run.bold === b && run.ital === it && run.link === lk) run.t += s.str; else { flush(); run = { t: s.str, bold: b, ital: it, link: lk }; }
      }
      flush(); return out;
    };
    for (const l of bodyLines) {
      if (l.kind === 'img') { if (para) paras.push(para); para = null; paras.push(`[[ IMG ${++imgN} ]]`); prev = null; continue; }
      const np = !para || !prev || (prev.page === l.page && (prev.y - l.y) > Math.max(l.h, prev.h) * 1.75);
      if (np) { if (para) paras.push(para); para = lineHTML(l); } else para = para.replace(/\s+$/, '') + ' ' + lineHTML(l);
      prev = l;
    }
    if (para) paras.push(para);
    return { title, rows, bodyHTML: paras.map(p => `<p>${p.replace(/<\/strong>(\s*)<strong>/g, '$1')}</p>`).join(''), images: {}, noMarker: bi < 0 };
  }

  W.parse = { BEGIN_RE, labelKey, splitHtml, extractHtml, parseHtmlString, parseDocx, parsePdf };
})(window.WWD);
