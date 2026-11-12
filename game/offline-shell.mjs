export function registerOfflineShell(scope = globalThis) {
  const pageLocation = scope?.location;
  if (!pageLocation) return false;

  // The offline shell belongs to the top-level game document, never an embedded
  // artifact or other child frame. Do this before touching restricted Navigator APIs.
  const topWindow = scope?.top;
  if (topWindow && topWindow !== scope) return false;

  // Location.origin serializes the URL, not necessarily the sandboxed environment's
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
