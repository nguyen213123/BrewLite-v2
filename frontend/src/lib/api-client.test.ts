import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ApiError, NetworkError, apiRequest, describeApiError } from './api-client.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as typeof fetch;
  return calls;
}

describe('apiRequest', () => {
  it('gửi Bearer, Idempotency-Key và JSON body; đọc header Idempotency-Replayed', async () => {
    const calls = mockFetch(() => new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Replayed': 'true' },
    }));
    const result = await apiRequest<{ ok: boolean }>('/orders', {
      method: 'POST', token: 'tok', idempotencyKey: 'key-1', body: { items: [] },
    });
    assert.equal(result.replayed, true);
    assert.deepEqual(result.data, { ok: true });
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer tok');
    assert.equal(headers['Idempotency-Key'], 'key-1');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.ok(calls[0].url.endsWith('/orders'));
  });

  it('không gửi Content-Type khi GET và không có body', async () => {
    const calls = mockFetch(() => new Response('{}', { status: 200 }));
    await apiRequest('/products');
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers['Content-Type'], undefined);
    assert.equal(headers.Authorization, undefined);
  });

  it('chuyển error envelope thành ApiError có code, details và Retry-After', async () => {
    mockFetch(() => new Response(
      JSON.stringify({ statusCode: 409, code: 'IDEMPOTENCY_IN_PROGRESS', message: 'x', details: [] }),
      { status: 409, headers: { 'Retry-After': '1' } },
    ));
    await assert.rejects(apiRequest('/payments', { method: 'POST', body: {} }), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'IDEMPOTENCY_IN_PROGRESS');
      assert.equal(error.retryAfterSeconds, 1);
      return true;
    });
  });

  it('body lỗi không phải JSON vẫn thành ApiError với code HTTP_<status>', async () => {
    mockFetch(() => new Response('<html>bad gateway</html>', { status: 502 }));
    await assert.rejects(apiRequest('/products'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'HTTP_502');
      return true;
    });
  });

  it('lỗi mạng thành NetworkError', async () => {
    mockFetch(() => { throw new TypeError('Failed to fetch'); });
    await assert.rejects(apiRequest('/products'), NetworkError);
  });

  it('timeout thành NetworkError', async () => {
    mockFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await assert.rejects(apiRequest('/products', { timeoutMs: 20 }), (error: unknown) => {
      assert.ok(error instanceof NetworkError);
      return true;
    });
  });

  it('người gọi chủ động hủy thì không bị coi là NetworkError', async () => {
    mockFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const controller = new AbortController();
    const pending = apiRequest('/products', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(!(error instanceof NetworkError));
      return true;
    });
  });

  it('lỗi mạng khi đang đọc body thành NetworkError', async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.reject(new TypeError('network stream terminated')),
    } as unknown as Response));
    await assert.rejects(apiRequest('/products'), NetworkError);
  });

  it('timeout khi đang đọc body thành NetworkError', async () => {
    mockFetch((_url, init) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => new Promise<never>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    } as unknown as Response));
    await assert.rejects(apiRequest('/products', { timeoutMs: 20 }), (error: unknown) => {
      assert.ok(error instanceof NetworkError);
      return true;
    });
  });

  it('người gọi chủ động hủy khi đang đọc body thì truyền tiếp lỗi hủy', async () => {
    const controller = new AbortController();
    mockFetch((_url, init) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
        if (init.signal?.aborted) onAbort();
        else init.signal?.addEventListener('abort', onAbort);
        queueMicrotask(() => controller.abort());
      }),
    } as unknown as Response));
    const pending = apiRequest('/products', { signal: controller.signal });
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(!(error instanceof NetworkError));
      return true;
    });
  });

  it('HTTP 200 nhưng JSON không hợp lệ thì báo lỗi phản hồi, không trả data null', async () => {
    mockFetch(() => new Response('<html>not-a-json</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }));
    await assert.rejects(apiRequest('/products'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 200);
      assert.equal(error.code, 'HTTP_200');
      return true;
    });
  });
});

describe('describeApiError', () => {
  it('chọn thông báo theo code, không theo message của server', () => {
    const error = new ApiError(409, 'OUT_OF_STOCK', 'English message', [], null);
    assert.match(describeApiError(error), /số lượng/);
  });
  it('có thông báo cho lỗi mạng và lỗi lạ', () => {
    assert.match(describeApiError(new NetworkError()), /kết nối/i);
    assert.match(describeApiError(new Error('x')), /không mong muốn/);
  });
});
