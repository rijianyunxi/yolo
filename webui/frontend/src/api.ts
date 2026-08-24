const DEFAULT_TIMEOUT_MS = 60_000;

/** 后端返回的错误字段兼容 detail / code / requestId。 */
async function readError(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as { detail?: string; code?: string; requestId?: string };
    if (json.detail) {
      const extra =
        response.status >= 500 && json.requestId ? `（请求ID: ${json.requestId}）` : '';
      return `${json.detail}${extra}`;
    }
    return response.statusText;
  } catch {
    return response.statusText;
  }
}

/**
 * 在外部 signal（页面切换/竞态保护）基础上叠加超时控制：
 * - 外部 signal 中止时透传原中止原因，调用方仍按 AbortError 处理；
 * - 超时中止抛出 TimeoutError，由 fetchJson 归一化为中文提示。
 */
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const external = init.signal;
  const onExternalAbort = () => controller.abort(external?.reason);
  if (external?.aborted) {
    onExternalAbort();
  } else {
    external?.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(new DOMException('请求超时', 'TimeoutError')),
    timeoutMs,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  }
}

async function fetchJson<T>(
  input: RequestInfo,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithTimeout(input, init, timeoutMs);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('请求超时，请检查后端服务是否正常运行');
    }
    throw err;
  }
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
  putJson<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    return fetchJson<T>(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  },
  remove<T>(path: string, signal?: AbortSignal): Promise<T> {
    return fetchJson<T>(path, { method: 'DELETE', signal });
  },
};
