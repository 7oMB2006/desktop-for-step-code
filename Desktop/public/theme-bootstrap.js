// First-frame theme bootstrap. Runs before the React module script, right after
// the preload exposed the main-process-resolved theme on window.desktopTheme.
(function () {
  var resolved = 'light';
  try {
    var fromMain = window.desktopTheme && window.desktopTheme.resolved;
    if (fromMain === 'dark' || fromMain === 'light') resolved = fromMain;
  } catch (error) { resolved = 'light'; }
  document.documentElement.dataset.theme = resolved;
})();
