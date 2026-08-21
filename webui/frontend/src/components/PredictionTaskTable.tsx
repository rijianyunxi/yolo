import { RefreshCw, Trash2, X } from 'lucide-react';

import type { PredictionTask } from '../types';
import { formatTime, modelSourceName, predictionStatusName, predictionTaskMessage } from '../utils';

type PredictionTaskTableProps = {
  tasks: PredictionTask[];
  profileOptions: Array<{ id: string; title: string }>;
  onRefresh: () => void;
  loading: boolean;
  error: string;
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onCleanup: (taskId: string) => void;
};

export function PredictionTaskTable({
  tasks,
  profileOptions,
  onRefresh,
  loading,
  error,
  onCancel,
  onRetry,
  onCleanup,
}: PredictionTaskTableProps) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>推理队列</h2>
        <span className="pill">{tasks.length} 个任务</span>
        <button type="button" className="btn" disabled={loading} onClick={onRefresh}>
          <RefreshCw size={16} />
          {loading ? '读取中...' : '刷新队列'}
        </button>
      </div>
      {loading ? <p className="request-state" role="status">正在读取预测任务...</p> : null}
      {error ? (
        <div className="request-state request-error" role="alert">
          <span>预测任务读取失败：{error}</span>
          <button type="button" className="btn" onClick={onRefresh}>重试</button>
        </div>
      ) : null}
      {tasks.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>状态</th>
              <th>配置</th>
              <th>模型来源</th>
              <th>说明</th>
              <th>提交时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((item) => (
              <tr key={item.id}>
                <td>
                  <span
                    className={`pill ${
                      item.status === 'running' ? 'live' : item.status === 'failed' || item.status === 'interrupted' ? 'danger' : ''
                    }`}
                  >
                    {predictionStatusName(item.status)}
                  </span>
                </td>
                <td>{profileOptions.find((option) => option.id === item.profile)?.title || item.profile}</td>
                <td>{modelSourceName(item.modelSource)}</td>
                <td className="command-cell">{predictionTaskMessage(item)}</td>
                <td>
                  <div>{formatTime(item.createdAt)}</div>
                  {item.durationMs != null ? <small>{(item.durationMs / 1000).toFixed(1)} 秒</small> : null}
                </td>
                <td>
                  <div className="inline-controls">
                    {item.status === 'queued' || item.status === 'running' || item.status === 'stopping' ? (
                      <button type="button" className="btn danger" disabled={item.status === 'stopping'} onClick={() => onCancel(item.id)}>
                        <X size={14} />
                        {item.status === 'stopping' ? '停止中' : '取消'}
                      </button>
                    ) : null}
                    {item.status === 'failed' || item.status === 'interrupted' ? (
                      <button type="button" className="btn" onClick={() => onRetry(item.id)}>
                        <RefreshCw size={14} />
                        重试
                      </button>
                    ) : null}
                    {item.status === 'completed' && item.images.length ? (
                      <button type="button" className="btn danger" onClick={() => onCleanup(item.id)}>
                        <Trash2 size={14} />
                        清理结果
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty">当前没有推理任务。</div>
      )}
    </section>
  );
}
