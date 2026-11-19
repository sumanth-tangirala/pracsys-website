/**
 * Site-wide behaviour: mobile menu, e-mail links, gallery lightbox,
 * publication lists, and the "unpublished changes" preview banner.
 */
import { readOverlay, previewDisabled, setPreviewDisabled, siteBase } from './store.js';

function initMenu() {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-navigation');
  if (!toggle || !nav) return;
  const close = () => {
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  };
  toggle.addEventListener('click', () => {
    const open = !nav.classList.contains('is-open');
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      close();
      toggle.focus();
    }
  });
}

/** Addresses are written as user\AT\domain in the HTML to deter scrapers. */
function initEmails() {
  for (const a of document.querySelectorAll('a.js-email')) {
    const addr = `${a.dataset.user}@${a.dataset.domain}`;
    a.href = `mailto:${addr}`;
    a.textContent = addr;
  }
}

function initLightbox() {
  const links = [...document.querySelectorAll('.gallery a[href$=".jpg"], .gallery a[href$=".jpeg"], .gallery a[href$=".png"], a.lightbox-link')];
  if (!links.length) return;
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Image viewer');
  box.innerHTML = '<button type="button" class="lightbox-close" aria-label="Close">&times;</button><img alt=""><div class="lightbox-caption"></div>';
  document.body.append(box);
  const img = box.querySelector('img');
  const cap = box.querySelector('.lightbox-caption');
  const closeBtn = box.querySelector('.lightbox-close');
  let lastFocus = null;
  let index = 0;
  const show = (i) => {
    index = (i + links.length) % links.length;
    const a = links[index];
    img.src = a.href;
    const text = a.closest('figure')?.querySelector('figcaption')?.textContent.trim() || '';
    img.alt = text;
    cap.textContent = text;
  };
  const close = () => {
    box.hidden = true;
    document.body.style.overflow = '';
    lastFocus?.focus();
  };
  links.forEach((a, i) => a.addEventListener('click', (e) => {
    e.preventDefault();
    lastFocus = a;
    show(i);
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }));
  box.addEventListener('click', (e) => { if (e.target === box || e.target === closeBtn) close(); });
  document.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') show(index + 1);
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'Tab') { e.preventDefault(); closeBtn.focus(); }
  });
}

function initPreviewBanner() {
  const count = Object.keys(readOverlay().changes).length;
  if (!count || location.pathname.startsWith(`${siteBase()}admin`)) return;
  const bar = document.createElement('div');
  bar.className = 'preview-banner';
  bar.setAttribute('role', 'status');
  const off = previewDisabled();
  const noun = count === 1 ? 'change' : 'changes';
  bar.innerHTML = off
    ? `<span>Preview of ${count} unpublished publication ${noun} is hidden.</span><button type="button" data-act="on">Show preview</button>`
    : `<span><strong>Preview:</strong> this page includes ${count} unpublished publication ${noun} saved in this browser.</span>`
      + `<a href="${siteBase()}admin/#/changes">Review in editor</a><button type="button" data-act="off">Hide preview</button>`;
  bar.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    setPreviewDisabled(act === 'off');
    location.reload();
  });
  document.body.append(bar);
}

initMenu();
initEmails();
initLightbox();
initPreviewBanner();

if (document.querySelector('.tp-publist')) {
  import('./publist.js').then((m) => m.initPublists());
}
