// Copies the web app into an installer project folder: node scripts/copy-web.mjs <dest>
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/copy-web.mjs <dest>');

// sw.js is left out: the installed apps carry their own files.
const ENTRIES = ['index.html', 'manifest.webmanifest', 'css', 'js', 'assets', 'template', 'vendor', 'panels'];
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const e of ENTRIES) cpSync(path.join(root, e), path.join(dest, e), { recursive: true });
console.log(`Copied web app to ${path.relative(process.cwd(), dest) || dest}`);
