// First-frame theme bootstrap. Runs before the React module script, right after
// the preload exposed the main-process-resolved theme on window.desktopTheme.
(function () {
  var resolved = 'light';
  try {
    var snapshot = window.desktopTheme;
    var fromMain = snapshot && snapshot.resolved;
    if (fromMain === 'dark' || fromMain === 'light') resolved = fromMain;
    if (snapshot && snapshot.tokens) {
      Object.entries(snapshot.tokens).forEach(function (entry) {
        document.documentElement.style.setProperty('--theme-' + resolved + '-' + entry[0].slice(2), entry[1]);
      });
      document.documentElement.dataset.palette = snapshot.palette;
    }
  } catch (error) { resolved = 'light'; }
  document.documentElement.dataset.theme = resolved;
})();
