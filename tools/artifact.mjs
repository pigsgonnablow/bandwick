// Turns the single-file build into an Artifact page body (the host adds doctype/head/body).
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8');
const out = html
  .replace(/<!doctype html>/i, '')
  .replace(/<html[^>]*>/i, '')
  .replace(/<\/html>/i, '')
  .replace(/<head>/i, '')
  .replace(/<\/head>/i, '')
  .replace(/<body>/i, '')
  .replace(/<\/body>/i, '')
  .replace(/<meta charset="utf-8" \/>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .trim();
writeFileSync('dist/bandwick.html', out + '\n');
console.log('artifact page', (out.length / 1024).toFixed(0), 'KB; starts with', JSON.stringify(out.slice(0, 40)));
