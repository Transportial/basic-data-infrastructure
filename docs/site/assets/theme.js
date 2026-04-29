// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Theme toggle for the docs site. The anti-flash inline script in each page's
// <head> applies any saved choice before render; this file only wires the
// button click and live-updates when the OS preference changes for users
// who haven't picked anything.

(function () {
  var KEY = 'bdi-theme';
  var root = document.documentElement;

  function activeTheme() {
    var t = root.dataset.theme;
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function setTheme(t) {
    root.dataset.theme = t;
    try { localStorage.setItem(KEY, t); } catch (_) {}
  }

  function init() {
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        setTheme(activeTheme() === 'dark' ? 'light' : 'dark');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
