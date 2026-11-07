// Public preview uses the actual app; isolated renderer checks retain their fixture.
if (new URLSearchParams(location.search).has('isolated')) {
  await import('./theme-pack-isolated');
} else {
  await import('./theme-pack-workspace');
}
export {};
