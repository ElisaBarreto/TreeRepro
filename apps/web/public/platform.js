// RFC-13 R14: the brand of the host, set before first paint. A file, not an
// inline script, since the CSP is `script-src 'self'`. Same rule as
// src/lib/platform.ts (a test runs both over one table).
(() => {
  const platform =
    location.hostname.split('.')[0].toLowerCase() === 'plantrepro' ? 'plantrepro' : 'treerepro';
  document.documentElement.dataset.platform = platform;
  if (platform === 'plantrepro') {
    document.title = 'PlantRepro';
    const icon = document.querySelector('link[rel="icon"]');
    if (icon) icon.href = '/favicon-plantrepro.svg';
  }
})();
