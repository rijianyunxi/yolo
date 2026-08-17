import type { MenuKey, PredictionTask, Split } from './types';

export const MENU_PATHS: Record<MenuKey, string> = {
  overview: '/',
  dataset: '/dataset',
  photos: '/photos',
  annotate: '/annotate',
  training: '/training',
  prediction: '/prediction',
  logs: '/logs',
};

export const PATH_MENUS = Object.entries(MENU_PATHS).reduce<Record<string, MenuKey>>((acc, [key, path]) => {
  acc[path] = key as MenuKey;
  return acc;
}, {});

export function menuFromLocation(): MenuKey {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  return PATH_MENUS[pathname] || 'overview';
}

export function formatTime(value: number | null | undefined) {
  if (!value) return '-';
  return new Date(value * 1000).toLocaleString('zh-CN');
}

export function shortPath(value: string | null | undefined) {
  if (!value) return '-';
  return value.length > 58 ? `...${value.slice(-55)}` : value;
}

export function taskName(value: string | undefined) {
  const names: Record<string, string> = {
    'dataset-check': '数据集检查',
    'cpu-smoke-train': 'CPU 快速试训',
    'full-train': '正式训练',
  };
  if (!value) return '空闲';
  const [kind, profile] = value.split(':');
  return `${names[kind] || kind}${profile ? `（${profile}）` : ''}`;
}

export function taskState(value: string | undefined) {
  const names: Record<string, string> = {
    running: '运行中',
    stopping: '正在停止',
    success: '已完成',
    failed: '失败',
  };
  return value ? names[value] || value : '空闲';
}

export function predictionStatusName(status: PredictionTask['status']) {
  const names: Record<PredictionTask['status'], string> = {
    queued: '等待中',
    running: '推理中',
    completed: '已完成',
    failed: '失败',
  };
  return names[status] || status;
}

export function predictionTaskMessage(task: PredictionTask) {
  const source =
    task.modelSource === 'trained' ? '（已训练模型）' : task.modelSource === 'pretrained' ? '（预训练模型）' : '';
  if (task.status === 'completed') {
    const labels = task.detections.map((item) => `${item.name} ${Math.round(item.confidence * 100)}%`).join('，');
    return labels ? `${task.message || '检测完成'}${source}：${labels}` : `${task.message || '未检测到目标'}${source}。`;
  }
  if (task.status === 'failed') return task.error || task.message || '推理失败';
  return task.message || predictionStatusName(task.status);
}

export function splitName(split: Split) {
  return split === 'train' ? '训练集 train' : split === 'val' ? '验证集 val' : '测试集 test';
}
