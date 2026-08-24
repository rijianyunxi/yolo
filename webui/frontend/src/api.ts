const DEFAULT_TIMEOUT_MS = 60_000;

/** API 非 2xx 响应抛出的错误，附带 HTTP 状态码供上层区分处理（如标注保存 409 冲突）。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** 后端返回的错误字段优先读新格式 message，兼容旧格式 detail；同时提取 code。 */
async function readError(response: Response): Promise<{ text: string; code?: string }> {
  try {
    const json = (await response.json()) as {
      detail?: string;
      message?: string;
      code?: string;
      requestId?: string;
    };
    const text = json.message ?? json.detail;
    if (text) {
      const extra =
        response.status >= 500 && json.requestId ? `（请求ID: ${json.requestId}）` : '';
      return { text: `${text}${extra}`, code: json.code };
    }
    return { text: response.statusText };
  } catch {
    return { text: response.statusText };
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
  if (!response.ok) {
    const errInfo = await readError(response);
    throw new ApiError(errInfo.text, response.status, errInfo.code);
  }
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
