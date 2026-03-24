import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('dssrf', () => ({
  is_url_safe: vi.fn(),
}));

import { is_url_safe } from 'dssrf';
import {
  assertSafePublicUrl,
  fetchWithSsrfProtection,
  SsrfBlockedError,
} from '../../src/lib/ssrf-guard';

const mockedIsUrlSafe = vi.mocked(is_url_safe);

describe('ssrf-guard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks localhost URLs', async () => {
    await expect(
      assertSafePublicUrl('http://localhost:8080/x'),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it('blocks URLs rejected by dssrf policy', async () => {
    mockedIsUrlSafe.mockResolvedValueOnce(false);

    await expect(
      assertSafePublicUrl('https://example.com/data.json'),
    ).rejects.toThrow(/blocked by SSRF policy/);
  });

  it('allows URLs accepted by dssrf policy', async () => {
    mockedIsUrlSafe.mockResolvedValueOnce(true);

    const parsed = await assertSafePublicUrl('https://example.com/data.json');
    expect(parsed.hostname).toBe('example.com');
  });

  it('validates redirect targets too', async () => {
    mockedIsUrlSafe.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://localhost/secret' },
      }),
    );

    await expect(
      fetchWithSsrfProtection('https://example.com'),
    ).rejects.toThrow(SsrfBlockedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
