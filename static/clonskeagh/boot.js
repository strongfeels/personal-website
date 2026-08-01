// Loaded before the module entry point, so both of these are in place
// before anything else runs. Kept out of the HTML so the page needs no
// 'unsafe-inline' in its Content-Security-Policy.

// Hosted at a subpath (cianporteous.com/clonskeagh) every asset is relative,
// which is fine — but only with the trailing slash. Without it the browser
// resolves ./world.json against the site root and nothing loads. Most servers
// redirect for you; this covers the ones that don't.
(function () {
  var p = location.pathname;
  if (p.length > 1 && !p.endsWith('/') && !/\.[a-z0-9]+$/i.test(p)) {
    location.replace(p + '/' + location.search + location.hash);
  }
}());

// surface any failure in the page itself rather than only the console
function showFail(msg) {
  var el = document.getElementById('loading-text');
  if (el) { el.textContent = String(msg).slice(0, 300); el.style.color = '#ff8080'; }
  document.title = 'ERR: ' + String(msg).slice(0, 200);
}
addEventListener('error', function (e) { showFail(e.message || e.error); });
addEventListener('unhandledrejection', function (e) { showFail(e.reason && (e.reason.stack || e.reason.message) || e.reason); });
