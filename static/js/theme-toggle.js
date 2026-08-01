(function () {
  var THEMES = ['light', 'ember', 'ocean', 'forest'];

  function applyTheme(name) {
    THEMES.forEach(function (t) {
      document.body.classList.toggle('theme-' + t, t === name);
    });
    document.querySelectorAll('.theme-option').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.theme === name);
    });
  }

  var saved = localStorage.getItem('theme') || 'dark';
  applyTheme(saved);

  var trigger = document.getElementById('theme-trigger');
  var menu = document.getElementById('theme-menu');

  if (!trigger || !menu) return;

  trigger.addEventListener('click', function (e) {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });

  document.addEventListener('click', function () {
    menu.hidden = true;
  });

  menu.addEventListener('click', function (e) {
    e.stopPropagation();
  });

  document.querySelectorAll('.theme-option').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.dataset.theme;
      localStorage.setItem('theme', name);
      applyTheme(name);
      menu.hidden = true;
    });
  });
})();
