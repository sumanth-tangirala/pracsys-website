#!/usr/bin/env node
/**
 * Add or update an editor account for the browser-based admin.
 *
 *   node scripts/hash-password.mjs <username> "<Full Name>" [role]
 *
 * Prompts for the password, then writes a PBKDF2-SHA256 hash into
 * src/admin/users.json. Commit the file to make the account live.
 *
 * NOTE: the admin runs entirely in the browser (there is no server), so this
 * hash only gates the editor UI. It is not a security boundary: anyone can
 * read users.json and nothing the editor does reaches the live site until a
 * maintainer commits the exported BibTeX.
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [username, name, role = 'editor'] = process.argv.slice(2);
if (!username || !name) {
  console.error('Usage: node scripts/hash-password.mjs <username> "<Full Name>" [admin|editor]');
  process.exit(1);
}

const password = process.env.ADMIN_PASSWORD ?? await prompt(`Password for ${username}: `);
if (!password || password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const iterations = 210000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const file = new URL('../src/admin/users.json', import.meta.url);
const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { users: [] };
const record = { username, name, role, salt: salt.toString('base64'), hash: hash.toString('base64'), iterations };
const i = data.users.findIndex((u) => u.username === username);
if (i === -1) data.users.push(record);
else data.users[i] = record;
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Saved ${username} (${role}) to src/admin/users.json`);

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}
