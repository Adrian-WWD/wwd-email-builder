// Bundles the repo into one self-contained file: dist/email-builder.html
// (campaigns + templates inlined as window.WWD_BUNDLE; CSS and JS inlined).
// Usage: node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

const TEMPLATE_NAMES = ['abx-cell', 'abx-row', 'abx-ghost-mid', 'abx-ghost-end', 'abx-row-separator', 'abx-intro', 'abx-grid', 'single-button', 'image'];
const templates = Object.fromEntries(TEMPLATE_NAMES.map(n => [n, read(`templates/${n}.html`).replace(/\n$/, '')]));
const files = JSON.parse(read('campaigns/index.json'));
const campaigns = files.map(f => ({ id: f.replace(/\.json$/, ''), file: f, data: JSON.parse(read(`campaigns/${f}`)) }));
const builtAt = new Date().toISOString().slice(0, 10);

const bundle = JSON.stringify({ templates, campaigns, builtAt }).replace(/</g, '\\u003c');
let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="(src\/[^"]+)">/g, (m, p) => `<style>\n${read(p)}</style>`);
let first = true;
html = html.replace(/<script src="(src\/[^"]+)"><\/script>/g, (m, p) => {
  const js = read(p).replace(/<\/script/gi, '<\\/script');
  const pre = first ? `<script>window.WWD_BUNDLE = ${bundle};</script>\n` : '';
  first = false;
  return `${pre}<script>\n${js}</script>`;
});
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/email-builder.html'), html);
console.log(`Built dist/email-builder.html with ${campaigns.length} campaign(s), ${TEMPLATE_NAMES.length} templates.`);
