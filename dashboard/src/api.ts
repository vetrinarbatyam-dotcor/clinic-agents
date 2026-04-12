const API_KEY = import.meta.env.VITE_API_KEY || '548f006df93f429dca17ac97c6010842';

export const authHeaders: Record<string, string> = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

export async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${API_KEY}`);
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, {
    ...opts,
    headers,
  });
}
