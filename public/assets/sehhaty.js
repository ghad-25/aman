/* AMAN · Sehhaty-style app chrome: bottom tab bar and smart back button. */
(function () {
  'use strict';
  const I = {
    home: '<path d="M3.5 10.5 12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-3.5V15a1.5 1.5 0 0 0-1.5-1.5h-4A1.5 1.5 0 0 0 8.5 15v5.5H5A1.5 1.5 0 0 1 3.5 19v-8.5Z"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><circle cx="8.5" cy="14" r=".6"/><circle cx="12" cy="14" r=".6"/><circle cx="15.5" cy="14" r=".6"/>',
    life: '<path d="M4 14.5h3.2l3.6 2.1h3.9a1.5 1.5 0 0 0 0-3h-2.4M4 20.5h9.3l6.6-3.9a1.6 1.6 0 0 0-1.6-2.7l-3.6 1.9"/><path d="M14.8 4.6c1-1.2 3-.9 3.4.8.4 1.6-1.6 3.4-3.4 4.6-1.8-1.2-3.8-3-3.4-4.6.4-1.7 2.4-2 3.4-.8Z"/>',
    family: '<circle cx="8" cy="7.5" r="3"/><circle cx="16.5" cy="8.5" r="2.5"/><path d="M2.8 19.5c.4-3.6 2.4-5.5 5.2-5.5s4.8 1.9 5.2 5.5M13.6 14.6c.9-.7 1.8-1 2.9-1 2.4 0 4.2 1.7 4.6 5.4"/>',
    me: '<circle cx="12" cy="7.8" r="3.8"/><path d="M4.5 20.5c.5-4.4 3.3-6.7 7.5-6.7s7 2.3 7.5 6.7"/>'
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;

  function tabs(active) {
    const items = [
      ['home', 'الرئيسية', '/'], ['cal', 'المواعيد'], ['life', 'جودة الحياة'], ['family', 'عائلتي'], ['me', 'صحتي']
    ];
    const nav = document.createElement('nav');
    nav.className = 's-tabs';
    nav.setAttribute('aria-label', 'التنقل الرئيسي');
    nav.innerHTML = items.map(([k, label, href]) => {
      const on = k === active ? ' on' : '';
      const cur = on ? ' aria-current="page"' : '';
      return href && !on
        ? `<a class="s-tab${on}" href="${href}"${cur}>${svg(k)}<span>${label}</span></a>`
        : `<span class="s-tab${on}"${cur}>${svg(k)}<span>${label}</span></span>`;
    }).join('');
    return nav;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const want = document.body.dataset.sTabs;
    if (want) {
      const host = document.querySelector('.shell') || document.body;
      host.appendChild(tabs(want));
      document.body.classList.add('has-s-tabs');
    }
    document.querySelectorAll('.s-back[data-history]').forEach((a) => {
      a.addEventListener('click', (e) => {
        let same = false;
        try { same = document.referrer && new URL(document.referrer).origin === location.origin; } catch { /* ignore */ }
        if (same && history.length > 1) { e.preventDefault(); history.back(); }
      });
    });
  });
})();
