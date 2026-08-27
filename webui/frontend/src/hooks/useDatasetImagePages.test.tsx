import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import type { AnnotationImagePage, DatasetImage, DatasetImagePage, Split } from '../types';
import { TtlLruCache } from '../utils/ttlCache';
import { useDatasetImagePages } from './useDatasetImagePages';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function page(profile: string, split: Split, label: string, page: number, names: string[]): DatasetImagePage {
  return {
    page,
    pageSize: 60,
    pageCount: 3,
    total: names.length,
    images: names.map<DatasetImage>((name) => ({
      name,
      split,
      profile,
      url: `/files/${profile}/${split}/${name}`,
      thumbnailUrl: undefined,
      hasLabel: false,
      labelCount: 0,
      labelMtime: null,
      width: 0,
      height: 0,
      stem: name.replace(/\.[^.]+$/, ''),
      mtime: 0,
      boxes: [],
    })),
  };
}

function annotationPage(profile: string, split: Split, names: string[]): AnnotationImagePage {
  return { ...page(profile, split, 'all', 1, names), classes: [{ id: 0, name: 'cat', displayName: 'cat' }] };
}

function makeOptions(overrides: Partial<Parameters<typeof useDatasetImagePages>[0]> = {}) {
  return {
    datasetProfile: 'cat',
    annotateProfile: 'cat',
    photosActive: false,
    annotationsActive: false,
    photoSplit: 'train' as const,
    annotateSplit: 'train' as const,
    photoLabelFilter: 'all' as const,
    annotationLabelFilter: 'all' as const,
    managedImagesCache: { current: new TtlLruCache<string, DatasetImagePage>({ ttlMs: 30_000, maxEntries: 4 }) },
    annotationCache: { current: new TtlLruCache<string, AnnotationImagePage>({ ttlMs: 30_000, maxEntries: 4 }) },
    refreshCacheStats: () => {},
    setPhotoMessage: () => {},
    onAnnotationPageLoaded: () => {},
    onAnnotationLoadError: () => {},
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  vi.useRealTimers();
});

describe('useDatasetImagePages', () => {
  it('loadManagedImages writes state and cache', async () => {
    const mock = vi.fn(async () => jsonResponse(page('cat', 'train', 'all', 1, ['a.jpg', 'b.jpg'])));
    globalThis.fetch = mock as unknown as typeof fetch;
    const options = makeOptions({ photosActive: false });
    const { result } = renderHook((opts: Parameters<typeof useDatasetImagePages>[0]) => useDatasetImagePages(opts), {
      initialProps: options,
    });
    await act(async () => {
      await result.current.loadManagedImages('train', 1, true);
    });
    expect(mock).toHaveBeenCalledTimes(1);
    expect((mock.mock.calls[0] as readonly unknown[])[0] as string).toContain('/api/dataset/images?');
    expect(result.current.managedImages.map((i) => i.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(result.current.photoTotal).toBe(2);
    expect(result.current.photoPageCount).toBe(3);
    expect(options.managedImagesCache.current.peek('cat|train|all|1')).toBeDefined();
  });

  it('loadManagedImages does not fetch on cache hit', async () => {
    const cache = new TtlLruCache<string, DatasetImagePage>({ ttlMs: 30_000, maxEntries: 4 });
    const mock = vi.fn();
    globalThis.fetch = mock as unknown as typeof fetch;
    const options = makeOptions({
      photosActive: false,
      managedImagesCache: { current: cache },
    });
    const { result } = renderHook((opts: Parameters<typeof useDatasetImagePages>[0]) => useDatasetImagePages(opts), {
      initialProps: options,
    });
    act(() => {
      cache.set('cat|train|all|1', page('cat', 'train', 'all', 1, ['cached.jpg']));
    });
    await act(async () => {
      await result.current.loadManagedImages('train', 1);
    });
    expect(mock).not.toHaveBeenCalled();
    expect(result.current.managedImages.map((i) => i.name)).toEqual(['cached.jpg']);
  });

  it('loadManagedImages surfaces request error via setPhotoMessage', async () => {
    const setMessage = vi.fn();
    const mock = vi.fn(async () => new Response('boom', { status: 500 }));
    globalThis.fetch = mock as unknown as typeof fetch;
    const options = makeOptions({ photosActive: true, setPhotoMessage: setMessage });
    const { result } = renderHook((opts: Parameters<typeof useDatasetImagePages>[0]) => useDatasetImagePages(opts), {
      initialProps: options,
    });
    await act(async () => {
      await result.current.loadManagedImages('train', 1, true);
    });
    expect(setMessage).toHaveBeenCalled();
    expect(result.current.managedImages).toEqual([]);
  });

  it('switching datasetProfile clears cache', async () => {
    const cache = new TtlLruCache<string, DatasetImagePage>({ ttlMs: 30_000, maxEntries: 4 });
    cache.set('old|train|all|1', page('old', 'train', 'all', 1, ['x.jpg']));
    const options = makeOptions({ photosActive: true, managedImagesCache: { current: cache } });
    const { rerender } = renderHook((opts: Parameters<typeof useDatasetImagePages>[0]) => useDatasetImagePages(opts), {
      initialProps: options,
    });
    rerender({ ...options, datasetProfile: 'safety' });
    expect(cache.peek('old|train|all|1')).toBeUndefined();
  });

  it('loadAnnotationImages AbortError is not propagated', async () => {
    let rejectPromise!: (reason: unknown) => void;
    const mock = vi.fn(
      () =>
        new Promise<Response>((_, reject) => {
          rejectPromise = reject;
        }),
    );
    globalThis.fetch = mock as unknown as typeof fetch;
    const options = makeOptions({ annotationsActive: true });
    const { result } = renderHook((opts: Parameters<typeof useDatasetImagePages>[0]) => useDatasetImagePages(opts), {
      initialProps: options,
    });
    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.loadAnnotationImages('train', 1, 'all', true);
    });
    act(() => {
      rejectPromise(new DOMException('aborted', 'AbortError'));
    });
    await act(async () => {
      await pending;
    });
    expect(result.current.annotationImages).toEqual([]);
  });

  it('switching annotateProfile clears annotation cache', async () => {
    const cache = new TtlLruCache<string, AnnotationImagePage>({ ttlMs: 30_000, maxEntries: 4 });
    cache.set('old|train|all|1', annotationPage('old', 'train', ['a.jpg']));
    const options = makeOptions({ annotationCache: { current: cache } });
    const { rerender } = renderHook((opts: Parameters<typeof useDatasetImagePages>[0]) => useDatasetImagePages(opts), {
      initialProps: options,
    });
    rerender({ ...options, annotateProfile: 'safety' });
    expect(cache.peek('old|train|all|1')).toBeUndefined();
  });
});
