/**
 * PRACSYS publication editor — single-page admin app.
 *
 * Routes (hash based so it works on GitHub Pages):
 *   #/login  #/  #/publications  #/publications/new  #/publications/edit/<key>
 *   #/import  #/changes  #/export  #/account  #/help
 */
import { getStore, siteBase } from '../store.js';
import { currentUser, signIn, signOut, lockRemaining, consumeSessionExpired } from './auth.js';
import { html, raw, $, toast, confirmDialog, dialogIsOpen, attempt } from './ui.js';
import { renderDashboard, renderList, renderChanges, renderExport, renderAccount, renderHelp } from './views.js';
import { renderEditor } from './editor.js';
import { renderImport } from './import.js';

const root = document.getElementById('admin-app');
const config = JSON.parse(document.getElementById('admin-config').textContent);
const store = getStore();
const LOGO = `${siteBase()}uploads/2024/11/PRACSYS-Logos-Horizontal.003-e1778875231877.png`;

const ctx = {
  store,
  config,
  user: null,
  /** Set by views that hold unsaved input; consulted before navigating away. */
  guard: null,
  navigate(path) {
    location.hash = `#${path}`;
  },
  refreshNav,
};

const NAV = [
  { path: '/', label: 'Dashboard', icon: 'fa-house' },
  { path: '/publications', label: 'Publications', icon: 'fa-book' },
  { path: '/publications/new', label: 'Add publication', icon: 'fa-plus' },
  { path: '/import', label: 'Import BibTeX', icon: 'fa-file-import' },
  { path: '/changes', label: 'Pending changes', icon: 'fa-code-compare', badge: true },
  { path: '/export', label: 'Export & publish', icon: 'fa-cloud-arrow-up' },
  { path: '/account', label: 'Account', icon: 'fa-user' },
  { path: '/help', label: 'Help', icon: 'fa-circle-question' },
];

/** Split the hash into a decoded path and its (still encoded) query string. */
function parseRoute() {
  const h = location.hash.replace(/^#/, '');
  const q = h.indexOf('?');
  const rawPath = q === -1 ? h : h.slice(0, q);
  let path = rawPath;
  try { path = decodeURIComponent(rawPath); } catch { /* keep it as typed */ }
  return { path: path || '/', params: new URLSearchParams(q === -1 ? '' : h.slice(q + 1)) };
}

/** Only follow `next` to a route inside the editor. */
function safeNext(next) {
  return next && next.startsWith('/') && !next.startsWith('/login') ? next : '/';
}

let currentPath = null;
let currentHash = null;
let routeSeq = 0;
let guardOpen = false;
let restoring = false;
let loginNotice = '';

// Each history entry gets an index so a cancelled "leave this page?" can step
// back (or forward) to the entry the user was on instead of adding a new one.
const histIndex = () => (typeof history.state?.admIdx === 'number' ? history.state.admIdx : null);
let navIndex = histIndex() ?? 0;
function stampHistory() {
  const idx = histIndex();
  if (idx === null) {
    navIndex += 1;
    history.replaceState({ ...(history.state || {}), admIdx: navIndex }, '');
  } else {
    navIndex = idx;
  }
}

async function route() {
  const hash = location.hash || '#/';
  if (restoring) {
    restoring = false;
    if (hash === currentHash) return;
  }
  if (ctx.guard && currentHash && hash !== currentHash) {
    if (guardOpen) return;
    guardOpen = true;
    const idx = histIndex();
    const leave = await confirmDialog({
      title: 'Discard unsaved changes?',
      body: 'You have edits on this page that have not been saved.',
      confirm: 'Discard changes',
      cancel: 'Keep editing',
      danger: true,
    });
    guardOpen = false;
    if (!leave) {
      if (location.hash === hash) {
        restoring = true;
        if (idx !== null && idx < navIndex) history.forward();
        else history.back();
      }
      return;
    }
    ctx.guard = null;
    route();
    return;
  }

  const seq = ++routeSeq;
  const { path, params } = parseRoute();
  const wasSignedIn = !!ctx.user;
  ctx.guard = null;
  ctx.user = currentUser();
  if (!ctx.user && path !== '/login') {
    if (consumeSessionExpired() || wasSignedIn) loginNotice = 'Your session has ended. Sign in again to continue — your saved changes are still here.';
    location.replace(`#/login?next=${encodeURIComponent(location.hash.replace(/^#/, '') || '/')}`);
    return;
  }
  if (path === '/login') {
    if (ctx.user) {
      location.replace(`#${safeNext(params.get('next'))}`);
      return;
    }
    currentPath = path;
    currentHash = hash;
    stampHistory();
    renderLogin(params);
    return;
  }
  if (!path.startsWith('/')) {
    location.replace('#/');
    return;
  }
  currentPath = path;
  currentHash = hash;
  setNav(false);
  renderShell(path);
  stampHistory();
  const main = $('#adm-main');
  // Each route renders into a fresh container so view event listeners never pile up.
  const view = document.createElement('div');
  view.className = 'adm-view';
  try {
    if (!store.published) {
      main.innerHTML = '<div class="adm-loading" role="status">Loading publications…</div>';
      await store.load({ fresh: true });
      if (seq !== routeSeq) return;
      let pruned = 0;
      attempt(() => { pruned = store.prune(); }, 'Could not tidy up published changes');
      if (pruned) toast(`${pruned} pending ${pruned === 1 ? 'change is' : 'changes are'} now live on the site and ${pruned === 1 ? 'was' : 'were'} cleared.`, 'success', 7000);
      refreshNav();
    }
    main.replaceChildren(view);
    if (path === '/') renderDashboard(view, ctx);
    else if (path === '/publications') renderList(view, ctx, params);
    else if (path === '/publications/new') renderEditor(view, ctx, null, params);
    else if (path.startsWith('/publications/edit/')) renderEditor(view, ctx, path.slice('/publications/edit/'.length), params);
    else if (path === '/import') renderImport(view, ctx);
    else if (path === '/changes') renderChanges(view, ctx);
    else if (path === '/export') renderExport(view, ctx);
    else if (path === '/account') await renderAccount(view, ctx);
    else if (path === '/help') renderHelp(view, ctx);
    else view.innerHTML = html`<div class="adm-empty"><h1>Page not found</h1><p><a href="#/">Back to the dashboard</a></p></div>`.toString();
  } catch (err) {
    console.error(err);
    main.innerHTML = html`<div class="adm-alert adm-alert-error" role="alert"><h1 class="adm-alert-title">Something went wrong</h1><p>${err.message}</p>
      <p><button type="button" class="adm-btn" data-reload>Reload the page</button></p></div>`.toString();
    main.querySelector('[data-reload]').addEventListener('click', () => location.reload());
  }
  if (seq !== routeSeq) return;
  const heading = main.querySelector('h1');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
    document.title = `${heading.textContent.trim()} · PRACSYS publication editor`;
  }
  window.scrollTo(0, 0);
}

function setNav(open, { focus = false } = {}) {
  document.body.classList.toggle('adm-nav-open', open);
  const toggle = $('.adm-menu-toggle');
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', String(open));
  $('.screen-reader-text', toggle).textContent = open ? 'Close menu' : 'Menu';
  if (open && focus) $('#adm-nav a')?.focus();
  if (!open && focus) toggle.focus();
}

function renderShell(path) {
  if (!$('#adm-main')) {
    root.innerHTML = html`
      <a class="skip-link screen-reader-text" href="#adm-main">Skip to content</a>
      <header class="adm-top">
        <a class="adm-brand" href="#/">
          <img src="${LOGO}" alt="PRACSYS Lab" width="191" height="38">
          <span class="adm-brand-sub">Publication editor</span>
        </a>
        <button type="button" class="adm-menu-toggle" aria-expanded="false" aria-controls="adm-nav"><i class="fa fa-bars" aria-hidden="true"></i><span class="screen-reader-text">Menu</span></button>
        <div class="adm-top-actions">
          <a class="adm-top-link" href="${siteBase()}papers/" target="_blank" rel="noopener"><i class="fa fa-arrow-up-right-from-square" aria-hidden="true"></i> View site<span class="screen-reader-text"> (opens in a new tab)</span></a>
          <span class="adm-user"><i class="fa fa-circle-user" aria-hidden="true"></i> <span class="adm-user-name"></span></span>
          <button type="button" class="adm-btn adm-btn-ghost adm-signout">Sign out</button>
        </div>
      </header>
      <div class="adm-scrim" aria-hidden="true"></div>
      <div class="adm-body">
        <nav id="adm-nav" class="adm-nav" aria-label="Editor"><ul></ul></nav>
        <main id="adm-main" class="adm-main" tabindex="-1"></main>
      </div>`.toString();
    $('.adm-signout').addEventListener('click', onSignOut);
    $('.adm-menu-toggle').addEventListener('click', () => setNav(!document.body.classList.contains('adm-nav-open'), { focus: true }));
    $('.adm-scrim').addEventListener('click', () => setNav(false));
    $('#adm-nav').addEventListener('click', (e) => {
      if (e.target.closest('a')) setNav(false);
    });
  }
  $('.adm-user-name').textContent = ctx.user.name;
  refreshNav(path);
}

async function onSignOut() {
  const n = store.changeCount;
  if (ctx.guard || n) {
    const parts = [];
    if (ctx.guard) parts.push('Edits on this page that you have not saved will be lost.');
    if (n) parts.push(n === 1 ? 'Your pending change stays saved in this browser and will be here when you sign in again.' : `Your ${n} pending changes stay saved in this browser and will be here when you sign in again.`);
    const ok = await confirmDialog({ title: 'Sign out?', body: parts.join(' '), confirm: 'Sign out', danger: !!ctx.guard });
    if (!ok) return;
  }
  signOut();
  ctx.guard = null;
  ctx.user = null;
  setNav(false);
  location.hash = '#/login';
}

function refreshNav(path = currentPath) {
  const ul = $('#adm-nav ul');
  if (!ul) return;
  const count = store.changeCount;
  ul.innerHTML = NAV.map((n) => {
    const active = n.path === path || (n.path === '/publications' && path?.startsWith('/publications/edit/'));
    return html`<li><a href="#${n.path}"${active ? raw(' aria-current="page"') : ''}><i class="fa ${n.icon}" aria-hidden="true"></i><span>${n.label}</span>${n.badge && count ? html`<span class="adm-count"><span class="screen-reader-text">(</span>${count}<span class="screen-reader-text"> ${count === 1 ? 'change' : 'changes'})</span></span>` : ''}</a></li>`;
  }).join('');
}

function renderLogin(params) {
  document.title = 'Sign in · PRACSYS publication editor';
  const notice = loginNotice;
  loginNotice = '';
  root.innerHTML = html`
    <main class="adm-login">
      <form class="adm-login-card" novalidate>
        <img class="adm-login-logo" src="${LOGO}" alt="PRACSYS Lab, Rutgers" width="300" height="59">
        <h1>Publication editor</h1>
        <p class="adm-login-lead">Sign in to add and update the lab's publications.</p>
        ${notice ? html`<p class="adm-alert adm-alert-info" role="status"><i class="fa fa-clock" aria-hidden="true"></i> ${notice}</p>` : ''}
        <div class="adm-alert adm-alert-error" role="alert" hidden></div>
        <label class="adm-field">
          <span class="adm-label">Username</span>
          <input name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required>
        </label>
        <label class="adm-field">
          <span class="adm-label">Password</span>
          <span class="adm-password">
            <input name="password" type="password" autocomplete="current-password" required>
            <button type="button" class="adm-reveal" aria-label="Show password" aria-pressed="false"><i class="fa fa-eye" aria-hidden="true"></i></button>
          </span>
        </label>
        <label class="adm-check"><input type="checkbox" name="remember"> Keep me signed in on this device for 14 days</label>
        <button class="adm-btn adm-btn-primary adm-btn-block" type="submit">Sign in</button>
        <p class="adm-login-note"><i class="fa fa-circle-info" aria-hidden="true"></i> Edits are saved in this browser until you export them and commit the file to GitHub. Nothing changes on the public site until then.</p>
        <p class="adm-login-back"><a href="${siteBase()}">&larr; Back to the PRACSYS Lab site</a></p>
      </form>
    </main>`.toString();
  const form = $('.adm-login-card');
  const alert = $('.adm-alert-error', form);
  const btn = form.querySelector('button[type="submit"]');
  const reveal = $('.adm-reveal', form);
  reveal.addEventListener('click', () => {
    const input = form.elements.password;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    reveal.setAttribute('aria-pressed', String(show));
    reveal.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    reveal.innerHTML = `<i class="fa ${show ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i>`;
  });

  // After too many failures the button counts down until another try is allowed.
  let lockTimer = null;
  const showLock = () => {
    clearInterval(lockTimer);
    alert.textContent = 'Too many failed attempts. For security, please wait a minute before trying again.';
    alert.hidden = false;
    const tick = () => {
      if (!btn.isConnected) { clearInterval(lockTimer); return; }
      const wait = lockRemaining();
      if (wait > 0) {
        btn.disabled = true;
        btn.textContent = `Try again in ${wait} s`;
        return;
      }
      clearInterval(lockTimer);
      btn.disabled = false;
      btn.textContent = 'Sign in';
      alert.textContent = 'You can try again now.';
    };
    tick();
    lockTimer = setInterval(tick, 1000);
  };
  if (lockRemaining()) showLock();
  form.elements.username.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    alert.hidden = true;
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    if (!username || !password) {
      alert.textContent = 'Enter your username and password.';
      alert.hidden = false;
      (!username ? form.elements.username : form.elements.password).focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await signIn(username, password, { remember: form.elements.remember.checked });
      // Replace the login entry so Back does not return to the sign-in form.
      location.replace(`#${safeNext(params.get('next'))}`);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Sign in';
      form.elements.password.select();
      if (lockRemaining()) {
        showLock();
      } else {
        alert.textContent = err.message;
        alert.hidden = false;
      }
    }
  });
}

/** In-page links (skip link, "#issues") scroll instead of being read as routes. */
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#"]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const href = a.getAttribute('href');
  if (href.startsWith('#/')) return;
  e.preventDefault();
  let id = href.slice(1);
  try { id = decodeURIComponent(id); } catch { /* use as is */ }
  const target = id && document.getElementById(id);
  if (!target) return;
  if (!target.hasAttribute('tabindex') && !target.matches('a[href], button, input, select, textarea')) target.setAttribute('tabindex', '-1');
  target.scrollIntoView({ block: 'start' });
  target.focus({ preventScroll: true });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('adm-nav-open') && !dialogIsOpen()) {
    setNav(false, { focus: true });
  }
});

// A file dropped outside a drop zone would make the browser open it and leave the editor.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (e) => {
    if (e.defaultPrevented || !e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    if (type === 'dragover') e.dataTransfer.dropEffect = 'none';
  });
}

/** Send the user to sign in when the session ends, unless that would lose typing. */
function checkSession() {
  if (ctx.user && !currentUser() && !ctx.guard && !dialogIsOpen()) route();
}
setInterval(checkSession, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkSession();
});

store.onChange(() => refreshNav());
window.addEventListener('hashchange', () => route());
window.addEventListener('beforeunload', (e) => {
  if (ctx.guard) {
    e.preventDefault();
    e.returnValue = '';
  }
});
route();
