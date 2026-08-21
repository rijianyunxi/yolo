import { describe, expect, it, vi } from 'vitest';

import type { PredictionTask } from './types';
import { TtlLruCache } from './utils/ttlCache';
import {
  formatBytes,
  modelSourceName,
  predictionStatusName,
  predictionTaskMessage,
  taskState,
} from './utils';

function predictionTask(overrides: Partial<PredictionTask> = {}): PredictionTask {
  return {
    id: 'test-task',
    profile: 'cat',
    status: 'queued',
    message: '等待中',
    error: null,
    createdAt: 1,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    model: null,
    modelSource: null,
    modelSelector: '',
    cancelRequested: false,
    cancelReason: null,
    originalFilename: 'input.jpg',
    inputSha256: null,
    inputSize: null,
    modelSha256: null,
    parentTaskId: null,
    conf: 0.25,
    detections: [],
    images: [],
    ...overrides,
  };
}

describe('task display helpers', () => {
  it('maps training and prediction lifecycle states to stable labels', () => {
    expect(taskState('running')).toBe('运行中');
    expect(taskState('cancelled')).toBe('已取消');
    expect(predictionStatusName('queued')).toBe('等待中');
    expect(predictionStatusName('interrupted')).toBe('服务中断');
  });

  it('explains prediction failures, cancellations and detections', () => {
    expect(predictionTaskMessage(predictionTask({ status: 'failed', error: '模型加载失败' }))).toBe('模型加载失败');
    expect(
      predictionTaskMessage(
        predictionTask({
          status: 'cancelled',
          cancelReason: '用户取消',
          message: '已取消',
        }),
      ),
    ).toBe('已取消：用户取消');
    expect(
      predictionTaskMessage(
        predictionTask({
          status: 'completed',
          modelSource: 'trained',
          message: '检测完成',
          detections: [{ classId: 0, name: '猫', confidence: 0.876, xyxy: [0, 0, 1, 1] }],
        }),
      ),
    ).toBe('检测完成（已训练模型）：猫 88%');
  });

  it('formats model sources and byte sizes consistently', () => {
    expect(modelSourceName('trained')).toBe('已训练模型');
    expect(modelSourceName('imported:custom.pt')).toBe('导入模型（custom.pt）');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(0)).toBe('-');
  });
});


describe('TtlLruCache', () => {
  it('expires entries and reports hit/miss statistics', () => {
    vi.useFakeTimers();
    const cache = new TtlLruCache<string, string>({ ttlMs: 1000, maxEntries: 2 });
    cache.set('a', 'A');
    expect(cache.get('a')).toBe('A');
    vi.advanceTimersByTime(1001);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, expirations: 1, entries: 0, hitRate: 0.5 });
    vi.useRealTimers();
  });

  it('evicts least recently used entries and keeps newest entries', () => {
    const cache = new TtlLruCache<string, number>({ ttlMs: 60_000, maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.stats().evictions).toBe(1);
  });
});
