import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PredictionPanel } from './components/PredictionPanel';
import type { ImportedModelInfo, PredictionItem, PredictionTask } from './types';

const prediction: PredictionItem = {
  name: 'result.jpg',
  path: 'runs/result.jpg',
  url: '/files/result.jpg',
  mtime: 1,
  taskId: 'task-1',
  detectionCount: 2,
};

const importedModel: ImportedModelInfo = {
  filename: 'custom.pt',
  name: 'custom.pt',
  path: 'models/custom.pt',
  size: 2 * 1024 * 1024,
  mtime: 1,
  url: '/files/models/custom.pt',
  classCount: 2,
};

const task: PredictionTask = {
  id: 'task-1',
  profile: 'cat',
  status: 'queued',
  message: '等待中',
  error: null,
  createdAt: 1,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  model: null,
  modelSource: 'trained',
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
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof PredictionPanel>> = {}) {
  const props: React.ComponentProps<typeof PredictionPanel> = {
    predictions: [prediction],
    predictionStats: { count: 1, totalBytes: 1024, oldestAt: 1, newestAt: 1, taskCount: 1 },
    predictionTasks: [task],
    predictionMessage: '准备就绪',
    predictionResultsLoading: false,
    predictionResultsError: '',
    predictionTasksLoading: false,
    predictionTasksError: '',
    predictionActionError: '',
    profileOptions: [{ id: 'cat', title: '猫数据集' }],
    datasetProfile: 'cat',
    importedModels: [importedModel],
    selectedModel: '',
    confidence: '0.25',
    predictionLimit: '48',
    predictionFilterProfile: '',
    predictionFilterModel: '',
    predictionMinConf: '',
    selectedPredictionPaths: [],
    localFileUrl: null,
    predicting: false,
    importingModel: false,
    onPredict: vi.fn(),
    onPredictionFileChange: vi.fn(),
    onClearLocalFile: vi.fn(),
    onSelectedModelChange: vi.fn(),
    onConfidenceChange: vi.fn(),
    onImportModelChange: vi.fn(),
    onRemoveImportedModel: vi.fn(),
    onPredictionFilterProfileChange: vi.fn(),
    onPredictionFilterModelChange: vi.fn(),
    onPredictionMinConfChange: vi.fn(),
    onPredictionLimitChange: vi.fn(),
    onRefreshPredictions: vi.fn(),
    onDeleteSelectedPredictions: vi.fn(),
    onToggleSelectAllPredictions: vi.fn(),
    onTogglePredictionSelection: vi.fn(),
    onPreviewPrediction: vi.fn(),
    onRefreshPredictionTasks: vi.fn(),
    onCancelPredictionTask: vi.fn(),
    onRetryPredictionTask: vi.fn(),
    onCleanupPredictionTask: vi.fn(),
    ...overrides,
  };
  return { ...render(<PredictionPanel {...props} />), props };
}

describe('PredictionPanel', () => {
  it('submits the selected image with the current prediction options and clears the preview', () => {
    const onPredict = vi.fn();
    const onClearLocalFile = vi.fn();
    renderPanel({ onPredict, onClearLocalFile, selectedModel: 'pretrained', confidence: '0.6' });

    const file = new File(['image'], 'input.png', { type: 'image/png' });
    const input = screen.getByLabelText('选择测试图片') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(onPredict).toHaveBeenCalledOnce();
    const form = onPredict.mock.calls[0][0] as FormData;
    expect(form.get('file')).toBe(file);
    expect(form.get('profile')).toBe('cat');
    expect(form.get('model')).toBe('pretrained');
    expect(form.get('conf')).toBe('0.6');
    expect(onClearLocalFile).toHaveBeenCalledOnce();
  });

  it('emits filter, selection, preview, deletion and queue actions', () => {
    const onPredictionFilterProfileChange = vi.fn();
    const onPredictionFilterModelChange = vi.fn();
    const onPredictionMinConfChange = vi.fn();
    const onPredictionLimitChange = vi.fn();
    const onTogglePredictionSelection = vi.fn();
    const onPreviewPrediction = vi.fn();
    const onDeleteSelectedPredictions = vi.fn();
    const onRefreshPredictions = vi.fn();
    const onRefreshPredictionTasks = vi.fn();
    renderPanel({
      selectedPredictionPaths: [prediction.path],
      onPredictionFilterProfileChange,
      onPredictionFilterModelChange,
      onPredictionMinConfChange,
      onPredictionLimitChange,
      onTogglePredictionSelection,
      onPreviewPrediction,
      onDeleteSelectedPredictions,
      onRefreshPredictions,
      onRefreshPredictionTasks,
    });

    fireEvent.change(screen.getByLabelText('数据集筛选'), { target: { value: 'cat' } });
    fireEvent.change(screen.getByLabelText('模型来源筛选'), { target: { value: 'trained' } });
    fireEvent.change(screen.getByLabelText('最小置信度筛选'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText('数量上限'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '选择' }));
    fireEvent.click(screen.getByRole('img', { name: 'result.jpg' }));
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    fireEvent.click(screen.getByRole('button', { name: '删除选中预测结果' }));
    fireEvent.click(screen.getByRole('button', { name: '刷新结果' }));
    fireEvent.click(screen.getByRole('button', { name: '刷新队列' }));

    expect(onPredictionFilterProfileChange).toHaveBeenCalledWith('cat');
    expect(onPredictionFilterModelChange).toHaveBeenCalledWith('trained');
    expect(onPredictionMinConfChange).toHaveBeenCalledWith('0.5');
    expect(onPredictionLimitChange).toHaveBeenCalledWith('12');
    expect(onTogglePredictionSelection).toHaveBeenCalledWith(prediction.path);
    expect(onPreviewPrediction).toHaveBeenCalledTimes(2);
    expect(onDeleteSelectedPredictions).toHaveBeenCalledOnce();
    expect(onRefreshPredictions).toHaveBeenCalledOnce();
    expect(onRefreshPredictionTasks).toHaveBeenCalledOnce();
    expect(screen.getByText('当前筛选 1 张图片，1.0 KB，涉及 1 个任务。')).toBeInTheDocument();
    expect(screen.getAllByText('猫数据集').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the empty result state and model import controls', () => {
    const onImportModelChange = vi.fn();
    const onRemoveImportedModel = vi.fn();
    renderPanel({ predictions: [], predictionStats: null, predictionTasks: [], onImportModelChange, onRemoveImportedModel });

    expect(screen.getByText('暂时没有预测结果。')).toBeInTheDocument();
    expect(screen.getByText('当前没有推理任务。')).toBeInTheDocument();
    expect(document.querySelector('.imported-model-chip')?.textContent).toContain('custom.pt（2.0 MB，2 类）');
    fireEvent.click(screen.getByTitle('删除导入的模型'));
    expect(onRemoveImportedModel).toHaveBeenCalledWith(importedModel);
  });
});

