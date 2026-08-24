import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TrainingPanel } from './TrainingPanel';
import type { ResourceSnapshot, Status, Task } from '../types';

const status: Pick<Status, 'cuda'> = { cuda: true };

const task: Task = {
  id: 'task-1',
  kind: 'full-train:cat',
  status: 'success',
  startedAt: 1,
  finishedAt: 2,
  returncode: 0,
  command: ['python', 'train.py'],
};

const resourceSnapshot: ResourceSnapshot = {
  checkedAt: 1,
  ready: true,
  disk: { totalBytes: 100, freeBytes: 80, usedBytes: 20 },
  memory: { totalBytes: 100, availableBytes: 60, percent: 40 },
  cpu: { count: 8, loadPercent: 12 },
  gpu: { available: true, device: 'RTX', freeBytes: 4096, totalBytes: 8192 },
  warnings: [],
  blocking: [],
};

type TrainingPanelProps = React.ComponentProps<typeof TrainingPanel>;

function makeProps(overrides: Partial<TrainingPanelProps> = {}): TrainingPanelProps {
  return {
    task,
    status,
    resourceSnapshot,
    busy: false,
    running: false,
    trainEpochs: '100',
    trainImageSize: '640',
    trainBatch: '8',
    trainDevice: 'auto',
    trainWorkers: '2',
    trainModel: '',
    onTrainEpochsChange: vi.fn(),
    onTrainImageSizeChange: vi.fn(),
    onTrainBatchChange: vi.fn(),
    onTrainDeviceChange: vi.fn(),
    onTrainWorkersChange: vi.fn(),
    onTrainModelChange: vi.fn(),
    onRunTask: vi.fn(),
    onStopTask: vi.fn(),
    ...overrides,
  };
};

function ControlledTrainingPanel(props: TrainingPanelProps) {
  const [values, setValues] = useState({
    trainEpochs: props.trainEpochs,
    trainImageSize: props.trainImageSize,
    trainBatch: props.trainBatch,
    trainDevice: props.trainDevice,
    trainWorkers: props.trainWorkers,
    trainModel: props.trainModel,
  });

  return <TrainingPanel {...props} {...values} onTrainEpochsChange={(trainEpochs) => setValues((current) => ({ ...current, trainEpochs }))} onTrainImageSizeChange={(trainImageSize) => setValues((current) => ({ ...current, trainImageSize }))} onTrainBatchChange={(trainBatch) => setValues((current) => ({ ...current, trainBatch }))} onTrainDeviceChange={(trainDevice) => setValues((current) => ({ ...current, trainDevice }))} onTrainWorkersChange={(trainWorkers) => setValues((current) => ({ ...current, trainWorkers }))} onTrainModelChange={(trainModel) => setValues((current) => ({ ...current, trainModel }))} />;
};

describe('TrainingPanel', () => {
  it('submits the full training form with current controlled values', () => {
    const props = makeProps();
    render(<ControlledTrainingPanel {...props} />);
    fireEvent.change(screen.getByLabelText('训练轮数'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('图片尺寸'), { target: { value: '512' } });
    fireEvent.change(screen.getByLabelText('Batch'), { target: { value: '16' } });
    fireEvent.change(screen.getByLabelText('设备'), { target: { value: 'cuda' } });
    fireEvent.change(screen.getByLabelText('数据加载 workers'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('基础模型（可选）'), { target: { value: 'yolo11n.pt' } });

    fireEvent.click(screen.getByRole('button', { name: '开始正式训练' }));

    expect(props.onRunTask).toHaveBeenCalledWith('/api/tasks/train-full', {
      epochs: 50,
      imgsz: 512,
      batch: 16,
      device: 'cuda',
      workers: 4,
      model: 'yolo11n.pt',
    });
  });

  it('submits fixed smoke values and disables actions while running', () => {
    const props = makeProps({ busy: true, running: true });
    render(<TrainingPanel {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'CPU 快速试训' }));

    expect(props.onRunTask).not.toHaveBeenCalled();
    expect(props.onStopTask).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '停止当前任务' })).toBeEnabled();
  });

  it('shows resource readiness and metric values', () => {
    render(<TrainingPanel {...makeProps({
      task: {
        ...task,
        params: { epochs: 80 },
        metrics: {
          runDir: 'runs/demo',
          epochs: 80,
          current: { epoch: 10, loss: { box: null, cls: null, dfl: null, total: 1.2345 }, precision: 0.9, recall: 0.8, mAP50: 0.7, mAP50_95: 0.6 },
          best: { epoch: 9, loss: { box: null, cls: null, dfl: null, total: 1.2 }, precision: 0.91, recall: 0.82, mAP50: 0.71, mAP50_95: 0.62 },
          recent: [],
        },
      },
    })} />);

    expect(screen.getByText('资源检查通过')).toBeInTheDocument();
    expect(screen.getByText('第 10 / 80 轮')).toBeInTheDocument();
    expect(screen.getByText('0.6000')).toBeInTheDocument();
  });
});