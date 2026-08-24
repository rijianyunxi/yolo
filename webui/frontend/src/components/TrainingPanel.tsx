import { Play, X } from 'lucide-react';

import type { ResourceSnapshot, Status, Task } from '../types';
import { formatBytes, formatTime, shortPath, taskName, taskState } from '../utils';

type TrainingDevice = 'auto' | 'cpu' | 'cuda';

type TrainingRequestBody = {
  epochs: number;
  imgsz: number;
  batch: number;
  device: TrainingDevice;
  workers: number;
  model: string | null;
};

type TrainingPanelProps = {
  task: Task | null;
  status: Pick<Status, 'cuda'> | null;
  resourceSnapshot: ResourceSnapshot | null;
  busy: boolean;
  running: boolean;
  trainEpochs: string;
  trainImageSize: string;
  trainBatch: string;
  trainDevice: TrainingDevice;
  trainWorkers: string;
  trainModel: string;
  onTrainEpochsChange: (value: string) => void;
  onTrainImageSizeChange: (value: string) => void;
  onTrainBatchChange: (value: string) => void;
  onTrainDeviceChange: (value: TrainingDevice) => void;
  onTrainWorkersChange: (value: string) => void;
  onTrainModelChange: (value: string) => void;
  onRunTask: (endpoint: string, body: TrainingRequestBody) => void;
  onStopTask: () => void;
};

export function TrainingPanel({
  task,
  status,
  resourceSnapshot,
  busy,
  running,
  trainEpochs,
  trainImageSize,
  trainBatch,
  trainDevice,
  trainWorkers,
  trainModel,
  onTrainEpochsChange,
  onTrainImageSizeChange,
  onTrainBatchChange,
  onTrainDeviceChange,
  onTrainWorkersChange,
  onTrainModelChange,
  onRunTask,
  onStopTask,
}: TrainingPanelProps) {
  const requestBody = (epochs: number, imgsz: number, batch: number): TrainingRequestBody => ({
    epochs,
    imgsz,
    batch,
    device: trainDevice,
    workers: Number(trainWorkers),
    model: trainModel || null,
  });

  return (
    <section className="page-stack">
      <section className="panel">
        <div className="panel-head">
          <h2>训练任务</h2>
          <span className={running ? 'pill live' : 'pill'}>{taskState(task?.status)}</span>
        </div>
        <div className="training-params">
          <label><span>训练轮数</span><input type="number" min="1" max="10000" value={trainEpochs} onChange={(event) => onTrainEpochsChange(event.target.value)} /></label>
          <label><span>图片尺寸</span><input type="number" min="32" step="32" max="4096" value={trainImageSize} onChange={(event) => onTrainImageSizeChange(event.target.value)} /></label>
          <label><span>Batch</span><input type="number" min="1" max="512" value={trainBatch} onChange={(event) => onTrainBatchChange(event.target.value)} /></label>
          <label><span>设备</span><select value={trainDevice} onChange={(event) => onTrainDeviceChange(event.target.value as TrainingDevice)}><option value="auto">自动</option><option value="cpu">CPU</option><option value="cuda" disabled={!status?.cuda}>CUDA{status?.cuda ? '' : '（不可用）'}</option></select></label>
          <label><span>数据加载 workers</span><input type="number" min="0" max="32" value={trainWorkers} onChange={(event) => onTrainWorkersChange(event.target.value)} /></label>
          <label className="training-model-field"><span>基础模型（可选）</span><input value={trainModel} onChange={(event) => onTrainModelChange(event.target.value)} placeholder="例如 yolo11n.pt" /></label>
        </div>
        <div className="action-grid">
          <button type="button" className="primary" disabled={busy || running} onClick={() => onRunTask('/api/tasks/train-smoke', requestBody(5, 416, 4))}>
            <Play size={16} />
            CPU 快速试训
          </button>
          <button type="button" className="btn" disabled={busy || running} onClick={() => onRunTask('/api/tasks/train-full', requestBody(Number(trainEpochs), Number(trainImageSize), Number(trainBatch)))}>
            <Play size={16} />
            开始正式训练
          </button>
          <button type="button" className="btn danger" disabled={!running} onClick={onStopTask}>
            <X size={16} />
            停止当前任务
          </button>
        </div>
        <p className="help">训练启动前会自动执行数据集质量检查和资源检查；存在阻断问题时不会启动训练。快速试训固定为 5 轮、416 尺寸、Batch 4。</p>
        {resourceSnapshot ? (
          <div className={`resource-summary ${resourceSnapshot.ready ? 'success' : 'danger'}`}>
            <strong>{resourceSnapshot.ready ? '资源检查通过' : '资源检查阻断，暂不能启动训练'}</strong>
            <span>磁盘可用 {formatBytes(resourceSnapshot.disk.freeBytes)}，内存可用 {formatBytes(resourceSnapshot.memory.availableBytes)}，CPU {resourceSnapshot.cpu.loadPercent.toFixed(0)}%</span>
            {resourceSnapshot.gpu?.freeBytes ? <span>GPU 可用显存 {formatBytes(resourceSnapshot.gpu.freeBytes)}</span> : null}
            {[...resourceSnapshot.blocking, ...resourceSnapshot.warnings].map((message) => <span key={message}>{message}</span>)}
          </div>
        ) : null}
        {task?.metrics ? (
          <div className="metrics-panel">
            <div className="panel-head"><h3>训练指标</h3><span className="pill">第 {task.metrics.current.epoch} / {typeof task.params?.epochs === 'number' ? task.params.epochs : '?'} 轮</span></div>
            <div className="metrics-grid">
              <div><span>当前 mAP50-95</span><strong>{task.metrics.current.mAP50_95 == null ? '-' : task.metrics.current.mAP50_95.toFixed(4)}</strong></div>
              <div><span>最佳 mAP50-95</span><strong>{task.metrics.best.mAP50_95 == null ? '-' : task.metrics.best.mAP50_95.toFixed(4)}（第 {task.metrics.best.epoch} 轮）</strong></div>
              <div><span>Precision</span><strong>{task.metrics.current.precision == null ? '-' : task.metrics.current.precision.toFixed(4)}</strong></div>
              <div><span>Recall</span><strong>{task.metrics.current.recall == null ? '-' : task.metrics.current.recall.toFixed(4)}</strong></div>
              <div><span>Loss</span><strong>{task.metrics.current.loss.total == null ? '-' : task.metrics.current.loss.total.toFixed(4)}</strong></div>
            </div>
          </div>
        ) : null}
        <div className="job-info">
          <div>
            <span>任务名称</span>
            <strong>{taskName(task?.kind)}</strong>
          </div>
          <div>
            <span>开始时间</span>
            <strong>{formatTime(task?.startedAt)}</strong>
          </div>
          <div>
            <span>执行命令</span>
            <strong>{task?.command.join(' ') || '-'}</strong>
          </div>
          <div>
            <span>训练参数</span>
            <strong>{task?.params ? JSON.stringify(task.params) : '-'}</strong>
          </div>
          <div>
            <span>结果目录</span>
            <strong>{shortPath(task?.resultDir)}</strong>
          </div>
        </div>
      </section>
    </section>
  );
}