export function registerOfflineShell(scope = globalThis) {
  const pageLocation = scope?.location;
  if (!pageLocation) return false;

  // Sandboxed HTTPS documents retain their URL protocol/host but have an
  // opaque security origin. Reject origin "null" before touching Navigator.
  if (pageLocation.origin === 'null') return false;
  if (pageLocation.protocol !== 'https:' &&
      !['localhost', '127.0.0.1'].includes(pageLocation.hostname)) return false;

  let serviceWorker;
  try {
    serviceWorker = scope.navigator?.serviceWorker;
  } catch (error) {
    if (error?.name === 'SecurityError') return false;
    throw error;
  }

  if (!serviceWorker || typeof serviceWorker.register !== 'function') return false;

  try {
    const registration = serviceWorker.register('./sw.js', { scope: './' });
    Promise.resolve(registration).catch(() => {});
    return true;
  } catch (error) {
    if (error?.name === 'SecurityError') return false;
    throw error;
  }
}
