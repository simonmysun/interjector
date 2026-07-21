import type { PublicConfig } from './@types';

/**
 * Fetch the non-secret configuration from the server. All recognition,
 * translation and completion settings (and every API key) live in the server's
 * environment; the browser only learns the bits it needs for display/behaviour.
 */
export async function fetchConfig(): Promise<PublicConfig> {
  const res = await fetch('/api/config');
  if (!res.ok) {
    throw new Error(`Failed to load server config: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as PublicConfig;
}
