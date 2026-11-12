export function registerOfflineShell(scope = globalThis) {
  const pageLocation = scope?.location;
  if (!pageLocation) return false;

  // Location.origin serializes the URL, not the sandboxed environment's
  // security origin. Window.origin serializes the actual environment origin.
  // Reject opaque environments before touching Navigator.
  if (scope?.origin === 'null' || pageLocation.origin === 'null') return false;
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
