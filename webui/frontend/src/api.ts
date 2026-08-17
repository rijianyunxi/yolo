async function readError(response: Response) {
  try {
    const json = (await response.json()) as { detail?: string };
    return json.detail || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function fetchJson<T>(input: RequestInfo, init: RequestInit = {}): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<T>;
}

export const api = {
  get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return fetchJson<T>(path, { signal });
  },
  post<T>(path: string, body?: BodyInit, signal?: AbortSignal): Promise<T> {
    return fetchJson<T>(path, { method: 'POST', body, signal });
  },
  postJson<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    return fetchJson<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  },
  remove<T>(path: string, signal?: AbortSignal): Promise<T> {
    return fetchJson<T>(path, { method: 'DELETE', signal });
  },
};
