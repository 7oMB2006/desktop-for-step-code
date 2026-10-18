export function assertStagingNodeVersion(version, platform) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  if (platform === 'win32' && major === 24 && minor < 16) {
    throw new Error('Windows staging requires Node.js 24.16.0 or newer within 24.x; earlier 24.x versions have a TCP-connect crash (nodejs/node#63620)');
  }
}
