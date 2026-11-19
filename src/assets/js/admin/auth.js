/**
 * Browser-only sign-in for the publication editor.
 *
 * Accounts live in /admin/users.json as PBKDF2-SHA256 hashes (created with
 * scripts/hash-password.mjs). Because the site is static there is no server
 * to enforce anything: this gate keeps casual visitors out of the editor UI,
 * and edits only ever touch the signed-in browser until someone commits the
 * exported BibTeX. Swap this module for a real identity provider when a
 * backend exists; the rest of the admin only uses the exported functions.
 */
import { siteBase } from '../store.js';

const SESSION_KEY = 'pracsys.admin.session';
const OVERRIDES_KEY = 'pracsys.admin.password-overrides';
const THROTTLE_KEY = 'pracsys.admin.throttle';
const SESSION_HOURS = 8;
const REMEMBER_DAYS = 14;
const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 60;

let usersPromise = null;
let sessionExpired = false;

function store(kind) {
  try { return window[kind]; } catch { return null; }
}

function readJson(storage, key, fallback) {
  try { return JSON.parse(storage?.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

export async function loadUsers() {
  usersPromise ??= fetch(`${siteBase()}admin/users.json`, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error('Could not load the account list.');
      return r.json();
    })
    .then((d) => d.users || [])
    .catch((err) => {
      // Do not cache a failed request: the next attempt should try again.
      usersPromise = null;
      throw err;
    });
  return usersPromise;
}

function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToB64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function pbkdf2(password, saltBytes, iterations) {
  if (!crypto?.subtle) throw new Error('Sign-in needs a secure (https) connection.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256);
  return new Uint8Array(bits);
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function throttleState() {
  return readJson(store('localStorage'), THROTTLE_KEY, { failures: 0, lockedUntil: 0 });
}

/** Seconds until another attempt is allowed (0 = allowed now). */
export function lockRemaining() {
  const t = throttleState();
  return Math.max(0, Math.ceil((t.lockedUntil - Date.now()) / 1000));
}

function recordFailure() {
  const t = throttleState();
  t.failures += 1;
  if (t.failures >= MAX_ATTEMPTS) {
    t.lockedUntil = Date.now() + LOCK_SECONDS * 1000;
    t.failures = 0;
  }
  store('localStorage')?.setItem(THROTTLE_KEY, JSON.stringify(t));
}

function clearFailures() {
  store('localStorage')?.removeItem(THROTTLE_KEY);
}

/**
 * Verify credentials and start a session.
 * @returns {Promise<{username: string, name: string, role: string}>}
 */
export async function signIn(username, password, { remember = false } = {}) {
  const wait = lockRemaining();
  if (wait) throw new Error(`Too many attempts. Try again in ${wait} seconds.`);
  const users = await loadUsers();
  const uname = String(username || '').trim().toLowerCase();
  const user = users.find((u) => u.username.toLowerCase() === uname);
  const override = readJson(store('localStorage'), OVERRIDES_KEY, {})[user?.username];
  const cred = override || user;
  // Always run the hash so timing does not reveal whether the user exists.
  const salt = cred ? b64ToBytes(cred.salt) : new Uint8Array(16);
  const derived = await pbkdf2(String(password || ''), salt, cred?.iterations || 210000);
  if (!user || !equalBytes(derived, b64ToBytes(cred.hash))) {
    recordFailure();
    throw new Error('That username and password do not match.');
  }
  clearFailures();
  const now = Date.now();
  const session = {
    username: user.username,
    name: user.name,
    role: user.role || 'editor',
    issuedAt: now,
    expiresAt: now + (remember ? REMEMBER_DAYS * 864e5 : SESSION_HOURS * 36e5),
    remember,
  };
  // A remembered session replaces any tab-only one and vice versa.
  store('sessionStorage')?.removeItem(SESSION_KEY);
  store('localStorage')?.removeItem(SESSION_KEY);
  (remember ? store('localStorage') : store('sessionStorage'))?.setItem(SESSION_KEY, JSON.stringify(session));
  sessionExpired = false;
  return currentUser();
}

export function currentUser() {
  for (const kind of ['sessionStorage', 'localStorage']) {
    const s = readJson(store(kind), SESSION_KEY, null);
    if (s && s.expiresAt > Date.now()) return { username: s.username, name: s.name, role: s.role, expiresAt: s.expiresAt };
    if (s) {
      store(kind)?.removeItem(SESSION_KEY);
      sessionExpired = true;
    }
  }
  return null;
}

/** True once after a stored session was found to have expired. */
export function consumeSessionExpired() {
  const was = sessionExpired;
  sessionExpired = false;
  return was;
}

export function signOut() {
  store('sessionStorage')?.removeItem(SESSION_KEY);
  store('localStorage')?.removeItem(SESSION_KEY);
}

/**
 * Change the signed-in user's password. The new hash is kept in this browser
 * and returned so it can be committed to src/admin/users.json.
 */
export async function changePassword(current, next) {
  const user = currentUser();
  if (!user) throw new Error('You are signed out.');
  if (String(next).length < 8) throw new Error('Use at least 8 characters for the new password.');
  const users = await loadUsers();
  const record = users.find((u) => u.username === user.username);
  if (!record) throw new Error('Your account is no longer in the account list (src/admin/users.json).');
  const overrides = readJson(store('localStorage'), OVERRIDES_KEY, {});
  const cred = overrides[user.username] || record;
  const check = await pbkdf2(String(current), b64ToBytes(cred.salt), cred.iterations);
  if (!equalBytes(check, b64ToBytes(cred.hash))) throw new Error('Your current password is not correct.');
  const iterations = 210000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(String(next), salt, iterations);
  const updated = { salt: bytesToB64(salt), hash: bytesToB64(hash), iterations };
  overrides[user.username] = updated;
  store('localStorage')?.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
  return { ...record, ...updated };
}

export function hasLocalPasswordOverride(username) {
  return !!readJson(store('localStorage'), OVERRIDES_KEY, {})[username];
}
