import { is_url_safe } from 'dssrf';

const MAX_REDIRECTS = 5;

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

function validateUrlShape(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError('URL must use http or https');
  }

  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError('URL credentials are not allowed');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new SsrfBlockedError('Localhost URLs are not allowed');
  }

  return parsed;
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  const parsed = validateUrlShape(rawUrl);
  const safe = await is_url_safe(parsed.toString());
  if (!safe) {
    throw new SsrfBlockedError('URL is blocked by SSRF policy');
  }

  return parsed;
}

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

export async function fetchWithSsrfProtection(
  inputUrl: string,
  init: Omit<RequestInit, 'redirect'> & { maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = init.maxRedirects ?? MAX_REDIRECTS;

  let currentUrl = inputUrl;
  for (let i = 0; i <= maxRedirects; i += 1) {
    const safeUrl = await assertSafePublicUrl(currentUrl);
    const res = await fetch(safeUrl, { ...init, redirect: 'manual' });

    if (!isRedirectStatus(res.status)) return res;

    const location = res.headers.get('location');
    if (!location) return res;
    currentUrl = new URL(location, safeUrl).toString();
  }

  throw new SsrfBlockedError(`Too many redirects (>${maxRedirects})`);
}
