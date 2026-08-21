import { FileImage, ImagePlus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import type { ChangeEvent, FormEvent } from 'react';

import type { ImportedModelInfo, PredictionItem, PredictionStats, PredictionTask } from '../types';
import { formatBytes, formatTime } from '../utils';
import { PredictionTaskTable } from './PredictionTaskTable';

type PredictionPanelProps = {
  predictions: PredictionItem[];
  predictionStats: PredictionStats | null;
  predictionTasks: PredictionTask[];
  predictionMessage: string;
  predictionResultsLoading: boolean;
  predictionResultsError: string;
  predictionTasksLoading: boolean;
  predictionTasksError: string;
  predictionActionError: string;
  profileOptions: Array<{ id: string; title: string }>;
  datasetProfile: string;
  importedModels: ImportedModelInfo[];
  selectedModel: string;
  confidence: string;
  predictionLimit: string;
  predictionFilterProfile: string;
  predictionFilterModel: string;
  predictionMinConf: string;
  selectedPredictionPaths: string[];
  localFileUrl: string | null;
  predicting: boolean;
  importingModel: boolean;
  onPredict: (form: FormData) => void;
  onPredictionFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearLocalFile: () => void;
  onSelectedModelChange: (value: string) => void;
  onConfidenceChange: (value: string) => void;
  onImportModelChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveImportedModel: (model: ImportedModelInfo) => void;
  onPredictionFilterProfileChange: (value: string) => void;
  onPredictionFilterModelChange: (value: string) => void;
  onPredictionMinConfChange: (value: string) => void;
  onPredictionLimitChange: (value: string) => void;
  onRefreshPredictions: () => void;
  onDeleteSelectedPredictions: () => void;
  onToggleSelectAllPredictions: () => void;
  onTogglePredictionSelection: (path: string) => void;
  onPreviewPrediction: (url: string) => void;
  onRefreshPredictionTasks: () => void;
  onCancelPredictionTask: (taskId: string) => void;
  onRetryPredictionTask: (taskId: string) => void;
  onCleanupPredictionTask: (taskId: string) => void;
};

export function PredictionPanel({
  predictions,
  predictionStats,
  predictionTasks,
  predictionMessage,
  predictionResultsLoading,
  predictionResultsError,
  predictionTasksLoading,
  predictionTasksError,
  predictionActionError,
  profileOptions,
  datasetProfile,
  importedModels,
  selectedModel,
  confidence,
  predictionLimit,
  predictionFilterProfile,
  predictionFilterModel,
  predictionMinConf,
  selectedPredictionPaths,
  localFileUrl,
  predicting,
  importingModel,
  onPredict,
  onPredictionFileChange,
  onClearLocalFile,
  onSelectedModelChange,
  onConfidenceChange,
  onImportModelChange,
  onRemoveImportedModel,
  onPredictionFilterProfileChange,
  onPredictionFilterModelChange,
  onPredictionMinConfChange,
  onPredictionLimitChange,
  onRefreshPredictions,
  onDeleteSelectedPredictions,
  onToggleSelectAllPredictions,
  onTogglePredictionSelection,
  onPreviewPrediction,
  onRefreshPredictionTasks,
  onCancelPredictionTask,
  onRetryPredictionTask,
  onCleanupPredictionTask,
}: PredictionPanelProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('file') as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    const form = new FormData();
    form.append('file', file);
    form.append('conf', confidence);
    form.append('profile', datasetProfile);
    form.append('model', selectedModel);
    onPredict(form);
    event.currentTarget.reset();
    onClearLocalFile();
  }

  return (
    <section className="page-stack">
      <section className="panel">
        <div className="panel-head">
          <h2>预测调试</h2>
          <span className="pill">{predictions.length} 个输出结果</span>
        </div>
        <form className="prediction-form" onSubmit={handleSubmit}>
          <label>
            选择测试图片
            <input name="file" type="file" accept="image/*" aria-label="选择测试图片" onChange={onPredictionFileChange} />
            {localFileUrl ? (
              <img src={localFileUrl} alt="待预测图片预览" className="prediction-upload-preview" />
            ) : (
              <div className="prediction-upload-placeholder">
                <ImagePlus size={28} />
                <span>点击选择图片</span>
              </div>
            )}
          </label>
          <div className="model-source-block">
            <div className="model-source-row">
              <label className="compact-field">
                <span>测试模型</span>
                <select aria-label="测试模型" value={selectedModel} onChange={(event) => onSelectedModelChange(event.target.value)}>
                  <option value="">自动（当前配置最佳 / 预训练）</option>
                  <option value="pretrained">预训练模型 yolo11n.pt</option>
                  {importedModels.map((model) => (
                    <option key={model.filename} value={'imported:' + model.filename}>
                      {'导入：' + model.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="btn import-model-btn">
                <Upload size={14} />
                {importingModel ? '导入中...' : '导入模型'}
                <input type="file" accept=".pt" style={{ display: 'none' }} onChange={onImportModelChange} />
              </label>
            </div>
            {importedModels.length ? (
              <div className="imported-model-list">
                {importedModels.map((model) => (
                  <span key={model.filename} className={'imported-model-chip' + (selectedModel === 'imported:' + model.filename ? ' active' : '')}>
                    {model.name}（{(model.size / 1024 / 1024).toFixed(1)} MB{model.classCount != null ? `，${model.classCount} 类` : ''}）
                    <button type="button" className="icon-btn" title="删除导入的模型" onClick={() => onRemoveImportedModel(model)}>
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="prediction-controls">
            <label>
              置信度阈值
              <input value={confidence} onChange={(event) => onConfidenceChange(event.target.value)} type="number" min="0.01" max="0.99" step="0.01" />
            </label>
            <button type="submit" className="primary" disabled={predicting}>
              <FileImage size={16} />
              {predicting ? '已提交，排队中...' : '开始预测'}
            </button>
          </div>
        </form>
        <p className="help">{predictionMessage || '优先使用当前数据集配置对应的 best.pt；如果还没有训练模型，则使用 yolo11n.pt 预训练模型并明确提示。'}</p>
        {predictionActionError ? <div className="request-state request-error" role="alert">{predictionActionError}</div> : null}
        <div className="prediction-results">
          <div className="prediction-results-head">
            <div>
              <h3>预测结果</h3>
              <p className="annotation-help">点击图片可预览，可勾选后批量删除。</p>
            </div>
            <div className="inline-controls">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={predictions.length > 0 && predictions.every((item) => selectedPredictionPaths.includes(item.path))}
                  onChange={onToggleSelectAllPredictions}
                />
                全选
              </label>
              <label className="inline-field">
                数据集
                <select aria-label="数据集筛选" value={predictionFilterProfile} onChange={(event) => onPredictionFilterProfileChange(event.target.value)}>
                  <option value="">全部配置</option>
                  {profileOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
                </select>
              </label>
              <label className="inline-field">
                模型来源
                <select aria-label="模型来源筛选" value={predictionFilterModel} onChange={(event) => onPredictionFilterModelChange(event.target.value)}>
                  <option value="">全部模型</option>
                  <option value="trained">已训练模型</option>
                  <option value="pretrained">预训练模型</option>
                </select>
              </label>
              <label className="inline-field">
                最小置信度
                <input aria-label="最小置信度筛选" type="number" min="0" max="1" step="0.05" placeholder="不限制" value={predictionMinConf} onChange={(event) => onPredictionMinConfChange(event.target.value)} />
              </label>
              <label className="inline-field">
                数量上限
                <input aria-label="数量上限" type="number" min="1" max="200" value={predictionLimit} onChange={(event) => onPredictionLimitChange(event.target.value)} />
              </label>
              <button type="button" className="btn" disabled={predictionResultsLoading} onClick={onRefreshPredictions}>
                <RefreshCw size={16} />
                {predictionResultsLoading ? '读取中...' : '刷新结果'}
              </button>
              <button type="button" className="btn danger" aria-label="删除选中预测结果" disabled={!selectedPredictionPaths.length} onClick={onDeleteSelectedPredictions}>
                <Trash2 size={16} />
                删除{selectedPredictionPaths.length ? ` (${selectedPredictionPaths.length})` : ''}
              </button>
            </div>
          </div>
          <div className="help">
            {predictionResultsLoading
              ? '正在读取预测结果...'
              : predictionStats
              ? `当前筛选 ${predictionStats.count} 张图片，${formatBytes(predictionStats.totalBytes)}，涉及 ${predictionStats.taskCount} 个任务。`
              : '正在读取预测结果统计...'}
          </div>
          {predictionResultsError ? (
            <div className="request-state request-error" role="alert">
              <span>预测结果读取失败：{predictionResultsError}</span>
              <button type="button" className="btn" onClick={onRefreshPredictions}>重试</button>
            </div>
          ) : null}
          {predictions.length ? (
            <div className="prediction-grid">
              {predictions.map((item) => (
                <article key={item.path} className={selectedPredictionPaths.includes(item.path) ? 'prediction-card selected' : 'prediction-card'}>
                  <label className="prediction-card-select">
                    <input type="checkbox" checked={selectedPredictionPaths.includes(item.path)} onChange={() => onTogglePredictionSelection(item.path)} />
                    <span>选择</span>
                  </label>
                  <img src={item.url} alt={item.name} onClick={() => onPreviewPrediction(item.url)} />
                  <div className="prediction-card-body">
                    <strong>{item.name}</strong>
                    <span>{formatTime(item.mtime)}</span>
                    <span>{item.taskId ? `任务 ${item.taskId}` : '历史结果'}{item.detectionCount != null ? ` · ${item.detectionCount} 个目标` : ''}</span>
                    <button type="button" className="btn" onClick={() => onPreviewPrediction(item.url)}>
                      预览
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty">暂时没有预测结果。</div>
          )}
        </div>
      </section>
      <PredictionTaskTable
        tasks={predictionTasks}
        profileOptions={profileOptions}
        onRefresh={onRefreshPredictionTasks}
        loading={predictionTasksLoading}
        error={predictionTasksError}
        onCancel={onCancelPredictionTask}
        onRetry={onRetryPredictionTask}
        onCleanup={onCleanupPredictionTask}
      />
    </section>
  );
}

