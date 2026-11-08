/* AMAN shared client helpers: API calls, links that follow the bracelet token, formatting. */
(function () {
  'use strict';
  const seg = location.pathname.split('/').filter(Boolean);
  // /medical/<token>/..., /claim/<token>
  const token = (seg[0] === 'medical' || seg[0] === 'claim' || seg[0] === 'm') ? decodeURIComponent(seg[1] || '') : '';

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: { ...(opts.headers || {}) }, credentials: 'same-origin' };
    if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    let res;
    try { res = await fetch(path, init); } catch (e) {
      const err = new Error('تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.'); err.status = 0; throw err;
    }
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) { const err = new Error(data.error || 'حدث خطأ.'); err.status = res.status; err.data = data; throw err; }
    return data;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
  const fmtT = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const date = (iso) => { try { return iso ? fmt.format(new Date(iso)) : '—'; } catch { return '—'; } };
  const dateTime = (iso) => { try { return iso ? fmtT.format(new Date(iso)) : '—'; } catch { return '—'; } };
  function ago(iso) {
    const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return 'الآن';
    if (s < 3600) return `قبل ${Math.round(s / 60)} د`;
    if (s < 86400) return `قبل ${Math.round(s / 3600)} س`;
    return dateTime(iso);
  }

  const pages = {
    'aman_emergency_card.html': '',
    'aman_drug_checker.html': '/check',
    'aman_access_code.html': '/code',
    'aman_full_medical_record.html': '/record',
  };
  function route(file) {
    if (file === 'aman_doctor_login.html') return '/doctor';
    if (file === 'aman_doctor_dashboard.html') return '/doctor/dashboard';
    if (file in pages) return `/medical/${encodeURIComponent(token)}${pages[file]}`;
    return '/' + file;
  }
  window.amanRoute = route;
  window.amanGo = (file) => { location.href = route(file); };
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[data-aman-file]').forEach((a) => a.setAttribute('href', route(a.getAttribute('data-aman-file'))));
  });

  const LEVEL = {
    avoid: { label: 'تجنّب', cls: 'red' },
    caution: { label: 'يُعطى بحذر', cls: 'amber' },
    info: { label: 'معلومة للطاقم الصحي', cls: 'blue' },
    none: { label: 'لا يوجد تنبيه مسجّل', cls: 'gray' },
  };

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { /* no */ } t.remove(); return ok;
    }
  }

  function qr(el, url, size) {
    try { el.innerHTML = ''; window.AmanQR.draw(el, url, size || 200); } catch (e) { el.textContent = 'تعذّر إنشاء الرمز'; }
  }

  window.AMAN = { api, esc, date, dateTime, ago, token, route, LEVEL, copy, qr };
})();
