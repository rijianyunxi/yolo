import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PredictionTaskTable } from './components/PredictionTaskTable';
import type { PredictionTask } from './types';

function task(status: PredictionTask['status']): PredictionTask {
  return {
    id: `task-${status}`,
    profile: 'cat',
    status,
    message: status === 'failed' ? '模型加载失败' : '等待中',
    error: status === 'failed' ? '模型加载失败' : null,
    createdAt: 1,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    model: null,
    modelSource: 'trained',
    modelSelector: '',
    cancelRequested: status === 'stopping',
    cancelReason: null,
    originalFilename: 'input.jpg',
    inputSha256: null,
    inputSize: null,
    modelSha256: null,
    parentTaskId: null,
    conf: 0.25,
    detections: [],
    images: status === 'completed' ? [{ name: 'result.jpg', url: '/files/result.jpg', path: 'runs/result.jpg' }] : [],
  };
}

describe('PredictionTaskTable', () => {
  it('renders lifecycle actions and emits callbacks', () => {
    const onRefresh = vi.fn();
    const onCancel = vi.fn();
    const onRetry = vi.fn();
    const onCleanup = vi.fn();
    const { rerender } = render(
      <PredictionTaskTable
        tasks={[task('running')]}
        profileOptions={[{ id: 'cat', title: '猫数据集' }]}
        onRefresh={onRefresh}
        loading={false}
        error=""
        onCancel={onCancel}
        onRetry={onRetry}
        onCleanup={onCleanup}
      />,
    );

    expect(screen.getByText('推理中')).toBeInTheDocument();
    expect(screen.getByText('猫数据集')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /取消/ }));
    expect(onCancel).toHaveBeenCalledWith('task-running');
    fireEvent.click(screen.getByRole('button', { name: /刷新队列/ }));
    expect(onRefresh).toHaveBeenCalledOnce();

    rerender(
      <PredictionTaskTable
        tasks={[task('failed')]}
        profileOptions={[]}
        onRefresh={onRefresh}
        loading={false}
        error=""
        onCancel={onCancel}
        onRetry={onRetry}
        onCleanup={onCleanup}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    expect(onRetry).toHaveBeenCalledWith('task-failed');

    rerender(
      <PredictionTaskTable
        tasks={[task('completed')]}
        profileOptions={[]}
        onRefresh={onRefresh}
        loading={false}
        error=""
        onCancel={onCancel}
        onRetry={onRetry}
        onCleanup={onCleanup}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /清理结果/ }));
    expect(onCleanup).toHaveBeenCalledWith('task-completed');
  });

  it('shows an empty state when no tasks are available', () => {
    render(
      <PredictionTaskTable
        tasks={[]}
        profileOptions={[]}
        onRefresh={() => undefined}
        loading={false}
        error=""
        onCancel={() => undefined}
        onRetry={() => undefined}
        onCleanup={() => undefined}
      />,
    );
    expect(screen.getByText('当前没有推理任务。')).toBeInTheDocument();
  });
});
