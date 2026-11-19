/**
 * PRACSYS publication editor — single-page admin app.
 *
 * Routes (hash based so it works on GitHub Pages):
 *   #/login  #/  #/publications  #/publications/new  #/publications/edit/<key>
 *   #/import  #/changes  #/export  #/account  #/help
 */
import { getStore, siteBase } from '../store.js';
import { currentUser, signIn, signOut, lockRemaining } from './auth.js';
import { html, raw, $, toast, confirmDialog } from './ui.js';
import { renderDashboard, renderList, renderChanges, renderExport, renderAccount, renderHelp } from './views.js';
import { renderEditor } from './editor.js';
import { renderImport } from './import.js';

const root = document.getElementById('admin-app');
const config = JSON.parse(document.getElementById('admin-config').textContent);
const store = getStore();

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
  { path: '/', label: 'Dashboard', icon: 'fa-gauge-high' },
  { path: '/publications', label: 'Publications', icon: 'fa-book' },
  { path: '/publications/new', label: 'Add publication', icon: 'fa-plus' },
  { path: '/import', label: 'Import BibTeX', icon: 'fa-file-import' },
  { path: '/changes', label: 'Pending changes', icon: 'fa-code-compare', badge: true },
  { path: '/export', label: 'Export & publish', icon: 'fa-cloud-arrow-up' },
  { path: '/account', label: 'Account', icon: 'fa-user' },
  { path: '/help', label: 'Help', icon: 'fa-circle-question' },
];

function parseRoute() {
  const h = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  const [path, query = ''] = h.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

let currentPath = null;

async function route() {
  const { path, params } = parseRoute();
  if (ctx.guard && currentPath && path !== currentPath) {
    const target = location.hash;
    history.replaceState(null, '', `#${currentPath}`);
    const leave = await confirmDialog({
      title: 'Discard unsaved changes?',
      body: 'You have edits on this page that have not been saved.',
      confirm: 'Discard changes',
      cancel: 'Keep editing',
      danger: true,
    });
    if (leave) {
      ctx.guard = null;
      location.hash = target;
    }
    return;
  }
  ctx.guard = null;
  ctx.user = currentUser();
  if (!ctx.user && path !== '/login') {
    location.replace(`#/login?next=${encodeURIComponent(path)}`);
    return;
  }
  if (path === '/login') {
    if (ctx.user) {
      location.replace(`#${params.get('next') || '/'}`);
      return;
    }
    currentPath = path;
    return renderLogin(params);
  }
  currentPath = path;
  renderShell(path);
  const main = $('#adm-main');
  // Each route renders into a fresh container so view event listeners never pile up.
  const view = document.createElement('div');
  view.className = 'adm-view';
  try {
    if (!store.published) {
      main.innerHTML = '<div class="adm-loading">Loading publications…</div>';
      await store.load({ fresh: true });
      const pruned = store.prune();
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
    main.innerHTML = html`<div class="adm-alert adm-alert-error"><strong>Something went wrong.</strong> ${err.message}</div>`.toString();
  }
  const heading = main.querySelector('h1');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
    document.title = `${heading.textContent.trim()} · PRACSYS publication editor`;
  }
  window.scrollTo(0, 0);
}

function renderShell(path) {
  if (!$('#adm-main')) {
    root.innerHTML = html`
      <a class="skip-link screen-reader-text" href="#adm-main">Skip to content</a>
      <header class="adm-top">
        <a class="adm-brand" href="#/">
          <img src="${siteBase()}uploads/2024/11/PRACSYS-Logos-Horizontal.003-e1778875231877.png" alt="PRACSYS Lab" width="191" height="38">
          <span class="adm-brand-sub">Publication editor</span>
        </a>
        <button type="button" class="adm-menu-toggle" aria-expanded="false" aria-controls="adm-nav"><i class="fa fa-bars" aria-hidden="true"></i><span class="screen-reader-text">Menu</span></button>
        <div class="adm-top-actions">
          <a class="adm-top-link" href="${siteBase()}papers/" target="_blank" rel="noopener"><i class="fa fa-arrow-up-right-from-square" aria-hidden="true"></i> View site</a>
          <span class="adm-user"><i class="fa fa-circle-user" aria-hidden="true"></i> <span class="adm-user-name"></span></span>
          <button type="button" class="adm-btn adm-btn-ghost adm-signout">Sign out</button>
        </div>
      </header>
      <div class="adm-body">
        <nav id="adm-nav" class="adm-nav" aria-label="Editor"><ul></ul></nav>
        <main id="adm-main" class="adm-main"></main>
      </div>`.toString();
    $('.adm-signout').addEventListener('click', async () => {
      if (store.changeCount && !(await confirmDialog({
        title: 'Sign out?',
        body: `Your ${store.changeCount} pending change(s) stay saved in this browser and will be here when you sign in again.`,
        confirm: 'Sign out',
      }))) return;
      signOut();
      ctx.guard = null;
      location.hash = '#/login';
    });
    const toggle = $('.adm-menu-toggle');
    toggle.addEventListener('click', () => {
      const open = !document.body.classList.contains('adm-nav-open');
      document.body.classList.toggle('adm-nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
    $('#adm-nav').addEventListener('click', (e) => {
      if (e.target.closest('a')) {
        document.body.classList.remove('adm-nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
    store.onChange(() => refreshNav());
  }
  $('.adm-user-name').textContent = ctx.user.name;
  refreshNav(path);
}

function refreshNav(path = currentPath) {
  const ul = $('#adm-nav ul');
  if (!ul) return;
  const count = store.changeCount;
  ul.innerHTML = NAV.map((n) => {
    const active = n.path === path || (n.path === '/publications' && path?.startsWith('/publications/edit/'));
    return html`<li><a href="#${n.path}"${active ? raw(' aria-current="page"') : ''}><i class="fa ${n.icon}" aria-hidden="true"></i><span>${n.label}</span>${n.badge && count ? html`<span class="adm-count" aria-label="${count} pending">${count}</span>` : ''}</a></li>`;
  }).join('');
}

function renderLogin(params) {
  document.title = 'Sign in · PRACSYS publication editor';
  root.innerHTML = html`
    <main class="adm-login">
      <form class="adm-login-card" novalidate>
        <img class="adm-login-logo" src="${siteBase()}uploads/2024/11/PRACSYS-Logos-Horizontal.003-e1778875231877.png" alt="PRACSYS Lab, Rutgers" width="300" height="59">
        <h1>Publication editor</h1>
        <p class="adm-login-lead">Sign in to add and update the lab's publications.</p>
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
  const alert = $('.adm-alert', form);
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
  form.elements.username.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
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
      location.hash = `#${params.get('next') || '/'}`;
    } catch (err) {
      alert.textContent = err.message;
      alert.hidden = false;
      form.elements.password.select();
      btn.disabled = false;
      btn.textContent = 'Sign in';
      const wait = lockRemaining();
      if (wait) {
        btn.disabled = true;
        setTimeout(() => { btn.disabled = false; }, wait * 1000);
      }
    }
  });
}

window.addEventListener('hashchange', () => route());
window.addEventListener('beforeunload', (e) => {
  if (ctx.guard) {
    e.preventDefault();
    e.returnValue = '';
  }
});
route();
