import type { MenuKey, PredictionTask, Split } from './types';

export const MENU_PATHS: Record<MenuKey, string> = {
  overview: '/',
  dataset: '/dataset',
  photos: '/photos',
  annotate: '/annotate',
  training: '/training',
  prediction: '/prediction',
  profiles: '/profiles',
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
    cancelled: '已取消',
    success: '已完成',
    failed: '失败',
    interrupted: '服务中断',
  };
  return value ? names[value] || value : '空闲';
}

export function predictionStatusName(status: PredictionTask['status']) {
  const names: Record<PredictionTask['status'], string> = {
    queued: '等待中',
    running: '推理中',
    stopping: '正在停止',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    interrupted: '服务中断',
  };
  return names[status] || status;
}

export function modelSourceName(source: string | null | undefined) {
  if (source === 'trained') return '已训练模型';
  if (source === 'pretrained') return '预训练模型';
  if (source && source.startsWith('imported:')) {
    return '导入模型（' + source.slice('imported:'.length) + '）';
  }
  return '-';
}

export function predictionTaskMessage(task: PredictionTask) {
  const source =
    task.modelSource === 'trained'
      ? '（已训练模型）'
      : task.modelSource === 'pretrained'
        ? '（预训练模型）'
        : task.modelSource && task.modelSource.startsWith('imported:')
          ? '（导入模型）'
          : '';
  if (task.status === 'completed') {
    const labels = task.detections.map((item) => `${item.name} ${Math.round(item.confidence * 100)}%`).join('，');
    return labels ? `${task.message || '检测完成'}${source}：${labels}` : `${task.message || '未检测到目标'}${source}。`;
  }
  if (task.status === 'failed') return task.error || task.message || '推理失败';
  if (task.status === 'cancelled') return task.cancelReason ? `已取消：${task.cancelReason}` : task.message || '预测任务已取消';
  if (task.status === 'interrupted') return task.message || '服务重启导致任务中断，可尝试重试';
  if (task.status === 'stopping') return task.message || '正在停止推理...';
  return task.message || predictionStatusName(task.status);
}

export function splitName(split: Split) {
  return split === 'train' ? '训练集 train' : split === 'val' ? '验证集 val' : '测试集 test';
}
export function formatBytes(value: number | null | undefined) {
  if (!value || value <= 0) return '-';
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / 1024 / 1024).toFixed(1) + ' MB';
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const element = document.createElement('textarea');
      element.value = text;
      element.style.position = 'fixed';
      element.style.opacity = '0';
      document.body.appendChild(element);
      element.select();
      document.execCommand('copy');
      document.body.removeChild(element);
      return true;
    } catch {
      return false;
    }
  }
}

