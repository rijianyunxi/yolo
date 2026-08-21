import { useEffect, useRef } from 'react';

type AsyncCallback = () => Promise<unknown> | unknown;

type TaskPollingOptions = {
  resetKey: string;
  logAuto: boolean;
  refreshAll: AsyncCallback;
  refreshTask: AsyncCallback;
  refreshLog: AsyncCallback;
  refreshTaskHistory: AsyncCallback;
  refreshPredictionTasks: AsyncCallback;
  refreshStatus: AsyncCallback;
  fastIntervalMs?: number;
  slowIntervalMs?: number;
};

/**
 * 统一管理任务、日志和状态轮询，避免页面组件自己维护多个 timer 和竞态标记。
 * callback 使用 ref 保存最新实现，只有 resetKey/logAuto 变化时重建定时器。
 */
export function useTaskPolling({
  resetKey,
  logAuto,
  refreshAll,
  refreshTask,
  refreshLog,
  refreshTaskHistory,
  refreshPredictionTasks,
  refreshStatus,
  fastIntervalMs = 2200,
  slowIntervalMs = 15000,
}: TaskPollingOptions) {
  const callbacks = useRef({
    refreshAll,
    refreshTask,
    refreshLog,
    refreshTaskHistory,
    refreshPredictionTasks,
    refreshStatus,
  });

  useEffect(() => {
    callbacks.current = {
      refreshAll,
      refreshTask,
      refreshLog,
      refreshTaskHistory,
      refreshPredictionTasks,
      refreshStatus,
    };
  });

  useEffect(() => {
    void callbacks.current.refreshAll();
    const refreshingRef = { current: false };
    const fastTimer = window.setInterval(() => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      Promise.allSettled([
        callbacks.current.refreshTask(),
        logAuto ? callbacks.current.refreshLog() : Promise.resolve(),
        callbacks.current.refreshTaskHistory(),
        callbacks.current.refreshPredictionTasks(),
      ]).finally(() => {
        refreshingRef.current = false;
      });
    }, fastIntervalMs);
    const slowTimer = window.setInterval(() => {
      void callbacks.current.refreshStatus();
    }, slowIntervalMs);
    return () => {
      window.clearInterval(fastTimer);
      window.clearInterval(slowTimer);
    };
  }, [resetKey, logAuto, fastIntervalMs, slowIntervalMs]);
}
