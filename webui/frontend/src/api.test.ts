import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from './api';

/**
 * mock fetch：拒绝时始终带出 signal 的中止原因，与真实 fetch 行为一致，
 * 使超时 / 外部中止的传播路径可测。
 */
function stubFetch(): ReturnType<typeof vi.fn> {
  const mock = vi.fn(
    (_input: RequestInfo, init: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

function jsonResponse(
  body: unknown,
  init: { status?: number; statusText?: string } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('api 请求构造', () => {
  it('get 返回解析后的 JSON 并透传 AbortSignal', async () => {
    const mock = stubFetch();
    mock.mockResolvedValue(jsonResponse({ items: [1, 2] }));
    const controller = new AbortController();

    const data = await api.get<{ items: number[] }>('/api/dataset/status', controller.signal);

    expect(data).toEqual({ items: [1, 2] });
    const [input, init] = mock.mock.calls[0];
    expect(input).toBe('/api/dataset/status');
    // fetchWithTimeout 会合成一个新的 AbortController（通过监听器透传外部中止），
    // 因此传给 fetch 的是合成 signal 而非外部 signal；中止传播由下方专项用例验证。
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal).not.toBe(controller.signal);
  });

  it('post 使用 POST 方法并透传原始 body', async () => {
    const mock = stubFetch();
    mock.mockResolvedValue(jsonResponse({ ok: true }));
    const body = new FormData();
    body.append('a', '1');

    await api.post('/api/upload', body);

    const [, init] = mock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(body);
  });

  it('postJson 发送 JSON 序列化 body 与 Content-Type 头', async () => {
    const mock = stubFetch();
    mock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.postJson('/api/predict', { conf: 0.3, source: 'trained' });

    const [, init] = mock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ conf: 0.3, source: 'trained' });
  });

  it('putJson 使用 PUT 方法并发送 JSON body', async () => {
    const mock = stubFetch();
    mock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.putJson('/api/classes/1', { name: 'cat' });

    const [, init] = mock.mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ name: 'cat' });
  });

  it('remove 使用 DELETE 方法', async () => {
    const mock = stubFetch();
    mock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.remove('/api/images/a.jpg');

    expect(mock.mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('api 错误归一化', () => {
  it('5xx 时展示 detail 并附加请求 ID', async () => {
    stubFetch().mockResolvedValue(
      jsonResponse({ detail: '模型加载失败', requestId: 'req-123' }, { status: 500 }),
    );
    await expect(api.get('/api/predict')).rejects.toThrow('模型加载失败（请求ID: req-123）');
  });

  it('非 5xx 时仅展示 detail', async () => {
    stubFetch().mockResolvedValue(jsonResponse({ detail: '参数错误' }, { status: 400 }));
    await expect(api.get('/api/predict')).rejects.toThrow('参数错误');
  });

  it('无 detail 时回退到 statusText', async () => {
    stubFetch().mockResolvedValue(jsonResponse({}, { status: 404, statusText: 'Not Found' }));
    await expect(api.get('/api/missing')).rejects.toThrow('Not Found');
  });

  it('响应体不是 JSON 时回退到 statusText', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>bad gateway</html>', {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );
    await expect(api.get('/api/proxy')).rejects.toThrow('Bad Gateway');
  });

  it('409 时抛出 ApiError 且携带状态码', async () => {
    stubFetch().mockResolvedValue(
      jsonResponse({ detail: '标注已被其他窗口修改，请重新加载后再编辑' }, { status: 409 }),
    );
    const error = await api.get('/api/dataset/labels').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('标注已被其他窗口修改，请重新加载后再编辑');
    expect(error).toMatchObject({ name: 'ApiError', status: 409 });
    expect(error).toBeInstanceOf(ApiError);
  });
  it('new format reads message and extracts code', async () => {
    stubFetch().mockResolvedValue(
      jsonResponse({ message: 'img not found', code: 'not_found', requestId: 'req-1' }, { status: 404 }),
    );
    const err = await api.get('/api/dataset/images').catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'ApiError', status: 404, code: 'not_found' });
    expect((err as Error).message).toBe('img not found');
  });

  it('legacy detail-only format has undefined code', async () => {
    stubFetch().mockResolvedValue(
      jsonResponse({ detail: 'param error' }, { status: 400 }),
    );
    const err2 = await api.get('/api/dataset/upload').catch((e: unknown) => e);
    expect((err2 as Error).message).toBe('param error');
    expect(err2).toMatchObject({ status: 400, code: undefined });
  });

});

describe('api 超时与外部中止', () => {
  it('超时转为中文用户提示', async () => {
    vi.useFakeTimers();
    stubFetch(); // 永不 resolve，仅在 signal 中止时 reject

    const promise = api.get('/api/slow');
    const assertion = expect(promise).rejects.toThrow('请求超时，请检查后端服务是否正常运行');

    await vi.advanceTimersByTimeAsync(60_001);
    await assertion;
  });

  it('外部 signal 中止时透传 AbortError，不转为中文提示', async () => {
    stubFetch();
    const controller = new AbortController();

    const promise = api.get('/api/list', controller.signal);
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('调用前已中止的 signal 立即以 AbortError 拒绝', async () => {
    stubFetch();
    const controller = new AbortController();
    controller.abort();

    await expect(api.get('/api/list', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
