export function getHostname(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname ? u.hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}
