import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileImage,
  FolderOpen,
  ImagePlus,
  LayoutDashboard,
  ListChecks,
  Pencil,
  PencilRuler,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings,
  TerminalSquare,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import './styles.css';

import type {
  AnnotationImagePage,
  Box,
  ClassItem,
  DatasetImage,
  DatasetImagePage,
  DatasetCheckReport,
  ImportedModelInfo,
  HistoryLog,
  LogPayload,
  MenuKey,
  PredictionItem,
  PredictionStats,
  PredictionTask,
  ProfileClassInput,
  ProfileInfo,
  ResourceSnapshot,
  Split,
  Status,
  Task,
  TrainedModel,
} from './types';
import { api, ApiError } from './api';
import {
  MENU_PATHS,
  copyText,
  formatBytes,
  formatTime,
  menuFromLocation,
  predictionTaskMessage,
  shortPath,
  splitName,
  taskName,
  taskState,
} from './utils';
import { AnnotationWorkspace } from './components/AnnotationWorkspace';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { Pagination } from './components/Pagination';
import { StatCard } from './components/StatCard';
import { PredictionPanel } from './components/PredictionPanel';
import { TrainingPanel } from './components/TrainingPanel';
import { useTaskPolling } from './hooks/useTaskPolling';
import { useDatasetImagePages } from './hooks/useDatasetImagePages';
import { TtlLruCache } from './utils/ttlCache';

type PanelHeadProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
};

function PanelHead({ title, description, actions }: PanelHeadProps) {
  return (
    <div className="panel-head">
      <div>
        {typeof title === "string" ? <h2>{title}</h2> : title}
        {description ? <p className="annotation-help">{description}</p> : null}
      </div>
      {actions ? <div className="inline-controls">{actions}</div> : null}
    </div>
  );
}

function App() {
  const [menu, setMenu] = useState<MenuKey>(() => menuFromLocation());
  const [status, setStatus] = useState<Status | null>(null);
  const [datasetReport, setDatasetReport] = useState<DatasetCheckReport | null>(null);
  const [liveTask, setLiveTask] = useState<Task | null>(null);
  const [log, setLog] = useState<LogPayload | null>(null);
  const [taskHistory, setTaskHistory] = useState<Task[]>([]);
  const [predictions, setPredictions] = useState<PredictionItem[]>([]);
  const [predictionStats, setPredictionStats] = useState<PredictionStats | null>(null);
  const [predictionTasks, setPredictionTasks] = useState<PredictionTask[]>([]);
  const [historyLog, setHistoryLog] = useState<HistoryLog | null>(null);
  const [busy, setBusy] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [importSplit, setImportSplit] = useState<Split>('train');
  const [datasetProfile, setDatasetProfile] = useState('');
  const [photoSplit, setPhotoSplit] = useState<Split>('train');
  const [annotateSplit, setAnnotateSplit] = useState<Split>('train');
  const [annotateProfile, setAnnotateProfile] = useState('');
    const [photoLabelFilter, setPhotoLabelFilter] = useState<'all' | 'labeled' | 'unlabeled'>('all');
    const [selectedPhotoNames, setSelectedPhotoNames] = useState<string[]>([]);
  const [annotationLabelFilter, setAnnotationLabelFilter] = useState<'all' | 'labeled' | 'unlabeled'>('all');
  const managedImagesCache = useRef(new TtlLruCache<string, DatasetImagePage>({ ttlMs: 30_000, maxEntries: 24 }));
  const annotationCache = useRef(new TtlLruCache<string, AnnotationImagePage>({ ttlMs: 30_000, maxEntries: 24 }));
  const predictionResultsCache = useRef(new TtlLruCache<string, { predictions: PredictionItem[]; stats: PredictionStats }>({ ttlMs: 10_000, maxEntries: 12 }));
  const [cacheStatsVersion, setCacheStatsVersion] = useState(0);
  const [selectedImage, setSelectedImage] = useState<DatasetImage | null>(null);
  const [annotationBoxes, setAnnotationBoxes] = useState<Box[]>([]);
  const annotationBoxesRef = useRef<Box[]>([]);
  const annotationGestureStart = useRef<Box[] | null>(null);
  const annotationGestureDirty = useRef(false);
  const annotationHistory = useRef<{ past: Box[][]; future: Box[][] }>({ past: [], future: [] });
  const [annotationHistoryVersion, setAnnotationHistoryVersion] = useState(0);
  const [annotationDirty, setAnnotationDirty] = useState(false);
  const [annotationClasses, setAnnotationClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState(0);
  const [selectedBoxIndex, setSelectedBoxIndex] = useState<number | null>(null);
  const [datasetMessage, setDatasetMessage] = useState('');
  const [photoMessage, setPhotoMessage] = useState('');
  const [annotationMessage, setAnnotationMessage] = useState('');
  const [savingAnnotation, setSavingAnnotation] = useState(false);
  const [annotationStatusLoading, setAnnotationStatusLoading] = useState(false);
  const [annotationStatusError, setAnnotationStatusError] = useState('');
  const [saveDialog, setSaveDialog] = useState<{ kind: 'success' | 'error'; message: string; actionLabel?: string; onAction?: () => void; autoClose?: boolean } | null>(null);
  const [predictionMessage, setPredictionMessage] = useState('');
  const [predictionResultsLoading, setPredictionResultsLoading] = useState(false);
  const [predictionResultsError, setPredictionResultsError] = useState('');
  const [predictionTasksLoading, setPredictionTasksLoading] = useState(false);
  const [predictionTasksError, setPredictionTasksError] = useState('');
  const [predictionActionError, setPredictionActionError] = useState('');
  const [storageStats, setStorageStats] = useState<{
    predictions: { entries: number; bytes: number; quotaBytes: number; quotaEntries: number; protectedEntries: number; failed: number; overQuota: boolean };
    uploads: { entries: number; bytes: number; quotaBytes: number; quotaEntries: number; protectedEntries: number; failed: number; overQuota: boolean };
  } | null>(null);
  const [storageStatsLoading, setStorageStatsLoading] = useState(false);
  const [confidence, setConfidence] = useState('0.25');
  const [predictionLimit, setPredictionLimit] = useState('48');
  const [predictionFilterProfile, setPredictionFilterProfile] = useState('');
  const [predictionFilterModel, setPredictionFilterModel] = useState('');
  const [predictionMinConf, setPredictionMinConf] = useState('');
  const [selectedPredictionPaths, setSelectedPredictionPaths] = useState<string[]>([]);
  const [importedModels, setImportedModels] = useState<ImportedModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [importingModel, setImportingModel] = useState(false);
  const [profileList, setProfileList] = useState<ProfileInfo[]>([]);
  const [profileModels, setProfileModels] = useState<Record<string, TrainedModel[]>>({});
  const [profilesMessage, setProfilesMessage] = useState('');
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ProfileInfo | null>(null);
  const [profileFormId, setProfileFormId] = useState('');
  const [profileFormTitle, setProfileFormTitle] = useState('');
  const [profileFormClasses, setProfileFormClasses] = useState<ProfileClassInput[]>([{ name: '', displayName: '' }]);
  const [formError, setFormError] = useState('');
  const [modelViewProfile, setModelViewProfile] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [previewPredictionUrl, setPreviewPredictionUrl] = useState<string | null>(null);
  const [localFileUrl, setLocalFileUrl] = useState<string | null>(null);
  const [logAuto, setLogAuto] = useState(true);
  const [trainEpochs, setTrainEpochs] = useState('100');
  const [trainImageSize, setTrainImageSize] = useState('640');
  const [trainBatch, setTrainBatch] = useState('8');
  const [trainDevice, setTrainDevice] = useState<'auto' | 'cpu' | 'cuda'>('auto');
  const [trainWorkers, setTrainWorkers] = useState('0');
  const [trainModel, setTrainModel] = useState('');
  const [resourceSnapshot, setResourceSnapshot] = useState<ResourceSnapshot | null>(null);
  const predictionResultsAbort = useRef<AbortController | null>(null);
  const predictionTasksAbort = useRef<AbortController | null>(null);
  const statusAbort = useRef<AbortController | null>(null);
  const datasetImagePages = useDatasetImagePages({
    datasetProfile,
    annotateProfile,
    photosActive: menu === 'photos',
    annotationsActive: menu === 'annotate',
    photoSplit,
    annotateSplit,
    photoLabelFilter,
    annotationLabelFilter,
    managedImagesCache,
    annotationCache,
    refreshCacheStats,
    onAnnotationPageLoaded: handleAnnotationPageLoaded,
    onAnnotationLoadError: () => setAnnotationMessage(''),
    setPhotoMessage,
  });
  const {
    managedImages, setManagedImages,
    photoPage, setPhotoPage,
    photoTotal,
    photoPageCount,
    loadManagedImages,
    annotationImages, setAnnotationImages,
    annotationPage, setAnnotationPage,
    annotationTotal,
    annotationPageCount,
    annotationImagesLoading,
    annotationImagesError,
    loadAnnotationImages,
    invalidateImageCaches,
    replaceImage,
  } = datasetImagePages;

  const task = liveTask ?? status?.task ?? null;
  const dataset = status?.dataset;
  const running = task?.status === 'running';
  const profileOptions = status?.profiles || [];
  const currentProfile = profileOptions.find((item) => item.id === datasetProfile) || profileOptions[0];
  const currentClasses = status?.classes || [];

  function predictionCacheKey(query: string) {
    return query;
  }

  function refreshCacheStats() {
    managedImagesCache.current.prune();
    annotationCache.current.prune();
    predictionResultsCache.current.prune();
    setCacheStatsVersion((value) => value + 1);
  }

  useEffect(() => {
    const timer = window.setInterval(refreshCacheStats, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onPopState = () => setMenu(menuFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const ids = status?.profiles.map((item) => item.id) || [];
    if (status && (!datasetProfile || !ids.includes(datasetProfile))) {
      setDatasetProfile(ids[0] || '');
    }
  }, [status, datasetProfile]);

  useTaskPolling({
    resetKey: datasetProfile,
    logAuto,
    refreshAll,
    refreshTask,
    refreshLog,
    refreshTaskHistory,
    refreshPredictionTasks,
    refreshStatus,
  });

  useEffect(() => {
    setSelectedPhotoNames([]);
  }, [datasetProfile, photoLabelFilter, photoSplit]);

  useEffect(() => {
    void refreshDatasetReport();
  }, [datasetProfile]);

  useEffect(() => {
    if (menu === 'overview') void refreshStorageStats();
  }, [menu]);

  useEffect(() => {
    if (menu === 'training') void refreshTrainingResources();
    if (menu === 'profiles') void loadProfiles();
    if (menu === 'prediction') void loadImportedModels();
  }, [menu]);

  useEffect(() => {
    if (menu === 'training') void refreshTrainingResources();
  }, [menu, trainDevice]);

  useEffect(() => {
    if (menu !== 'prediction') return;
    void refreshPredictions().catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setPredictionMessage(error instanceof Error ? error.message : '读取预测结果失败');
      }
    });
    return () => predictionResultsAbort.current?.abort();
  }, [menu, predictionLimit, predictionFilterProfile, predictionFilterModel, predictionMinConf]);

  useEffect(() => {
    if (menu !== 'annotate') setAnnotateProfile(datasetProfile);
  }, [datasetProfile, menu]);

  const saveAnnotationRef = useRef<() => void>(() => {});
  useEffect(() => {
    saveAnnotationRef.current = () => {
      void saveAnnotation();
    };
  });

  // 保存标注提示：1 秒后自动关闭（类似 Element UI message）
  useEffect(() => {
    if (!saveDialog) return;
    if (saveDialog.onAction) return;
    const timer = window.setTimeout(() => setSaveDialog(null), 1000);
    return () => window.clearTimeout(timer);
  }, [saveDialog]);

  function resetAnnotationHistory(boxes: Box[]) {
    annotationBoxesRef.current = boxes;
    annotationGestureStart.current = null;
    annotationGestureDirty.current = false;
    annotationHistory.current = { past: [boxes], future: [] };
    setAnnotationHistoryVersion((value) => value + 1);
  }

  function changeAnnotationBoxes(next: Box[]) {
    const current = annotationBoxesRef.current;
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    const history = annotationHistory.current;
    history.past = [...history.past, next].slice(-21);
    history.future = [];
    annotationBoxesRef.current = next;
    setAnnotationBoxes(next);
    setAnnotationDirty(true);
    setAnnotationHistoryVersion((value) => value + 1);
  }

  function beginAnnotationGesture() {
    annotationGestureStart.current = annotationBoxesRef.current;
    annotationGestureDirty.current = annotationDirty;
  }

  function previewAnnotationBoxes(next: Box[]) {
    if (JSON.stringify(annotationBoxesRef.current) === JSON.stringify(next)) return;
    annotationBoxesRef.current = next;
    setAnnotationBoxes(next);
    setAnnotationDirty(true);
  }

  function commitAnnotationGesture(next: Box[]) {
    const baseline = annotationGestureStart.current ?? annotationBoxesRef.current;
    annotationGestureStart.current = null;
    annotationGestureDirty.current = false;
    if (JSON.stringify(baseline) === JSON.stringify(next)) return;
    const history = annotationHistory.current;
    history.past = [...history.past, next].slice(-21);
    history.future = [];
    annotationBoxesRef.current = next;
    setAnnotationBoxes(next);
    setAnnotationDirty(true);
    setAnnotationHistoryVersion((value) => value + 1);
  }

  function cancelAnnotationGesture() {
    const baseline = annotationGestureStart.current;
    const wasDirty = annotationGestureDirty.current;
    annotationGestureStart.current = null;
    annotationGestureDirty.current = false;
    if (!baseline) return;
    annotationBoxesRef.current = baseline;
    setAnnotationBoxes(baseline);
    setAnnotationDirty(wasDirty);
  }

  function undoAnnotation() {
    const history = annotationHistory.current;
    if (history.past.length <= 1) return;
    const current = history.past.pop() as Box[];
    history.future = [current, ...history.future].slice(0, 20);
    const previous = history.past[history.past.length - 1];
    annotationBoxesRef.current = previous;
    setAnnotationBoxes(previous);
    setAnnotationDirty(true);
    setAnnotationHistoryVersion((value) => value + 1);
  }

  function redoAnnotation() {
    const history = annotationHistory.current;
    const next = history.future.shift();
    if (!next) return;
    history.past = [...history.past, next].slice(-21);
    annotationBoxesRef.current = next;
    setAnnotationBoxes(next);
    setAnnotationDirty(true);
    setAnnotationHistoryVersion((value) => value + 1);
  }

  function nudgeSelectedBox(dxPx: number, dyPx: number, index: number) {
    const img = selectedImage;
    if (!img) return;
    const imageWidth = img.width || 1;
    const imageHeight = img.height || 1;
    changeAnnotationBoxes(
      annotationBoxesRef.current.map((box, i) => {
        if (i !== index) return box;
        const halfWidth = box.width / 2;
        const halfHeight = box.height / 2;
        return {
          ...box,
          x: Number(Math.min(1 - halfWidth, Math.max(halfWidth, box.x + dxPx / imageWidth)).toFixed(6)),
          y: Number(Math.min(1 - halfHeight, Math.max(halfHeight, box.y + dyPx / imageHeight)).toFixed(6)),
        };
      })
    );
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (menu !== 'annotate' || !selectedImage) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        event.preventDefault();
        if (event.shiftKey) redoAnnotation(); else undoAnnotation();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        event.preventDefault();
        redoAnnotation();
        return;
      }

      if (event.key === 'Enter' && !event.repeat) {
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
        event.preventDefault();
        saveAnnotationRef.current();
        return;
      }

      const moves: Record<string, [number, number]> = {
        ArrowUp: [0, -2],
        ArrowDown: [0, 2],
        ArrowLeft: [-2, 0],
        ArrowRight: [2, 0],
      };
      const move = moves[event.key];
      if (move && selectedBoxIndex != null) {
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        event.preventDefault();
        nudgeSelectedBox(move[0], move[1], selectedBoxIndex);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menu, selectedImage, selectedBoxIndex]);

  async function refreshStatus(profileOverride?: string) {
    statusAbort.current?.abort();
    const controller = new AbortController();
    const trackAnnotationStatus = menu === 'annotate';
    statusAbort.current = controller;
    if (trackAnnotationStatus) {
      setAnnotationStatusLoading(true);
      setAnnotationStatusError('');
    }
    try {
      const next = await api.get<Status>(`/api/status?profile=${profileOverride ?? datasetProfile}`, controller.signal);
      if (controller.signal.aborted) return;
      setStatus(next);
      setAnnotationClasses(next.classes);
      if (!next.classes.some((item) => item.id === selectedClassId)) {
        setSelectedClassId(next.classes[0]?.id ?? 0);
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      if (trackAnnotationStatus) setAnnotationStatusError(error instanceof Error ? error.message : '读取数据集状态失败');
    } finally {
      if (!controller.signal.aborted && trackAnnotationStatus) setAnnotationStatusLoading(false);
    }
  }

  async function refreshLog() {
    setLog(await api.get<LogPayload>('/api/log'));
  }

  async function refreshTask() {
    try {
      const response = await api.get<{ task: Task | null }>('/api/task');
      setLiveTask(response.task);
    } catch {
      // 任务状态轮询失败可暂时忽略，下次刷新会重试
    }
  }

  async function refreshTaskHistory() {
    const response = await api.get<{ tasks: Task[] }>('/api/tasks/history');
    setTaskHistory(response.tasks.slice(0, 50));
  }

  async function openHistoryLog(taskId: string) {
    try {
      const data = await api.get<HistoryLog>(`/api/tasks/history/${taskId}/log`);
      setHistoryLog(data);
    } catch (error) {
      setHistoryLog({ taskId, log: error instanceof Error ? error.message : '加载日志失败' });
    }
  }

  async function refreshStorageStats(force = false) {
    if (force) setStorageStatsLoading(true);
    try {
      const response = force
        ? await api.post<{ storage: NonNullable<typeof storageStats> }>('/api/cache/prune')
        : await api.get<{ storage: NonNullable<typeof storageStats> }>('/api/cache/stats');
      setStorageStats(response.storage);
    } catch {
      // 配额诊断失败不影响预测、上传和标注主流程。
    } finally {
      if (force) setStorageStatsLoading(false);
    }
  }

  async function refreshPredictions(force = false) {
    predictionResultsAbort.current?.abort();
    const controller = new AbortController();
    predictionResultsAbort.current = controller;
    setPredictionResultsLoading(true);
    setPredictionResultsError('');
    const limit = predictionLimit.replace(/\D/g, '') || '48';
    const query = new URLSearchParams({ limit });
    if (predictionFilterProfile) query.set('profile', predictionFilterProfile);
    if (predictionFilterModel) query.set('model', predictionFilterModel);
    if (predictionMinConf) query.set('min_conf', predictionMinConf);
    const queryString = query.toString();
    const cacheKey = predictionCacheKey(queryString);
    predictionResultsCache.current.prune();
    if (!force) {
      const cached = predictionResultsCache.current.get(cacheKey);
      if (cached) {
        if (!controller.signal.aborted) {
          setPredictions(cached.predictions);
          setPredictionStats(cached.stats);
          setPredictionResultsLoading(false);
        }
        return;
      }
    } else {
      predictionResultsCache.current.delete(cacheKey);
    }
    try {
      const [response, stats] = await Promise.all([
        api.get<{ predictions: PredictionItem[] }>(`/api/predictions?${queryString}`, controller.signal),
        api.get<PredictionStats>(`/api/predictions/stats?${queryString}`, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      predictionResultsCache.current.set(cacheKey, { predictions: response.predictions, stats });
      refreshCacheStats();
      setPredictions(response.predictions);
      setPredictionStats(stats);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      setPredictionResultsError(error instanceof Error ? error.message : '读取预测结果失败');
    } finally {
      if (!controller.signal.aborted) setPredictionResultsLoading(false);
    }
  }

  function togglePredictionSelection(path: string) {
    setSelectedPredictionPaths((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path]
    );
  }

  function toggleSelectAllPredictions() {
    setSelectedPredictionPaths((current) => {
      const allSelected = predictions.every((item) => current.includes(item.path));
      return allSelected
        ? current.filter((path) => !predictions.some((item) => item.path === path))
        : Array.from(new Set([...current, ...predictions.map((item) => item.path)]));
    });
  }

  function handlePredictionFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (localFileUrl) URL.revokeObjectURL(localFileUrl);
    setLocalFileUrl(file ? URL.createObjectURL(file) : null);
  }

  async function deleteSelectedPredictions() {
    if (!selectedPredictionPaths.length) return;
    if (!window.confirm(`确定删除选中的 ${selectedPredictionPaths.length} 条预测结果吗？`)) return;
    setPredictionActionError('');
    try {
      const response = await api.postJson<{ deleted: string[] }>('/api/predictions/delete', {
        paths: selectedPredictionPaths,
      });
      setPredictionMessage(`已删除 ${response.deleted.length} 条预测结果。`);
      setSelectedPredictionPaths([]);
      await refreshPredictions(true);
    } catch (error) {
      setPredictionActionError(error instanceof Error ? error.message : '删除预测结果失败');
    }
  }

  async function refreshPredictionTasks() {
    predictionTasksAbort.current?.abort();
    const controller = new AbortController();
    predictionTasksAbort.current = controller;
    setPredictionTasksLoading(true);
    setPredictionTasksError('');
    try {
      const response = await api.get<{ tasks: PredictionTask[] }>('/api/predictions/tasks', controller.signal);
      if (!controller.signal.aborted) setPredictionTasks(response.tasks);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      setPredictionTasksError(error instanceof Error ? error.message : '读取预测任务失败');
    } finally {
      if (!controller.signal.aborted) setPredictionTasksLoading(false);
    }
  }

  async function cancelPredictionTask(taskId: string) {
    if (!window.confirm('确定取消这个预测任务吗？正在运行的模型调用会在返回后停止并清理结果。')) return;
    setPredictionActionError('');
    try {
      const task = await api.postJson<PredictionTask>(`/api/predictions/tasks/${taskId}/cancel`, { reason: '用户取消' });
      setPredictionMessage(predictionTaskMessage(task));
      await refreshPredictionTasks();
    } catch (error) {
      setPredictionActionError(error instanceof Error ? error.message : '取消预测任务失败');
    }
  }

  async function retryPredictionTask(taskId: string) {
    setPredictionActionError('');
    try {
      const task = await api.postJson<PredictionTask>(`/api/predictions/tasks/${taskId}/retry`, {});
      setPredictionMessage('已创建重试任务，正在等待队列...');
      await refreshPredictionTasks();
      await pollPredictionTask(task.id);
    } catch (error) {
      setPredictionActionError(error instanceof Error ? error.message : '重试预测任务失败');
    }
  }

  async function cleanupPredictionTask(taskId: string) {
    if (!window.confirm('确定清理这个任务生成的所有预测图片吗？任务记录会保留。')) return;
    setPredictionActionError('');
    try {
      const response = await api.postJson<{ deletedTasks: string[]; skipped: Array<{ taskId: string; reason: string }>; notFound: string[] }>('/api/predictions/cleanup', { task_ids: [taskId] });
      setPredictionMessage(response.deletedTasks.includes(taskId) ? '已清理该任务的预测结果，任务记录仍保留。' : response.skipped[0]?.reason || '没有可清理的结果。');
      await Promise.all([refreshPredictions(true), refreshPredictionTasks()]);
    } catch (error) {
      setPredictionActionError(error instanceof Error ? error.message : '清理预测结果失败');
    }
  }


  async function loadProfiles() {
    try {
      const response = await api.get<{ profiles: ProfileInfo[] }>('/api/profiles');
      setProfileList(response.profiles);
    } catch (error) {
      setProfilesMessage(error instanceof Error ? error.message : '读取数据集配置失败');
    }
  }

  async function loadProfileModels(profile: string) {
    setModelLoading(true);
    try {
      const response = await api.get<{ models: TrainedModel[] }>(`/api/profiles/${encodeURIComponent(profile)}/models`);
      setProfileModels((prev) => ({ ...prev, [profile]: response.models }));
    } catch (error) {
      setProfilesMessage(error instanceof Error ? error.message : '读取训练模型失败');
    } finally {
      setModelLoading(false);
    }
  }

  async function openModelView(profile: string) {
    setModelViewProfile(profile);
    await loadProfileModels(profile);
  }

  function openCreateForm() {
    setEditingProfile(null);
    setProfileFormId('');
    setProfileFormTitle('');
    setProfileFormClasses([{ name: '', displayName: '' }]);
    setFormError('');
    setShowProfileForm(true);
  }

  function openEditForm(profile: ProfileInfo) {
    setEditingProfile(profile);
    setProfileFormId(profile.id);
    setProfileFormTitle(profile.title);
    setProfileFormClasses(profile.classes.map((item) => ({ name: item.name, displayName: item.displayName })));
    setFormError('');
    setShowProfileForm(true);
  }

  function updateClassRow(index: number, field: 'name' | 'displayName', value: string) {
    setProfileFormClasses((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }

  function addClassRow() {
    setProfileFormClasses((prev) => [...prev, { name: '', displayName: '' }]);
  }

  function removeClassRow(index: number) {
    setProfileFormClasses((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function createProfile() {
    const classes = profileFormClasses.filter((item) => item.name.trim());
    const id = profileFormId.trim();
    const title = profileFormTitle.trim();
    if (!id) { setFormError('请填写配置 ID'); return; }
    if (!title) { setFormError('请填写标题'); return; }
    if (!classes.length) { setFormError('至少添加一个类别'); return; }
    setBusy(true);
    try {
      const response = await api.postJson<{ profile: ProfileInfo }>('/api/profiles', {
        id,
        title,
        classes: classes.map((item) => ({ name: item.name.trim(), displayName: item.displayName.trim() })),
      });
      setShowProfileForm(false);
      setProfilesMessage('已创建数据集配置「' + response.profile.title + '」。');
      setDatasetProfile(response.profile.id);
      setProfileList((prev) => [...prev, response.profile]);
      await refreshStatus(response.profile.id);
      await loadProfiles();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '创建配置失败');
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    if (!editingProfile) return;
    const classes = profileFormClasses.filter((item) => item.name.trim());
    const title = profileFormTitle.trim();
    if (!title) { setFormError('请填写标题'); return; }
    if (!classes.length) { setFormError('至少添加一个类别'); return; }
    setBusy(true);
    try {
      const response = await api.putJson<{ profile: ProfileInfo }>(`/api/profiles/${encodeURIComponent(editingProfile.id)}`, {
        title,
        classes: classes.map((item) => ({ name: item.name.trim(), displayName: item.displayName.trim() })),
      });
      setShowProfileForm(false);
      setProfilesMessage('已更新配置「' + response.profile.title + '」。');
      setProfileList((prev) => prev.map((item) => (item.id === response.profile.id ? response.profile : item)));
      await refreshStatus(response.profile.id);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '保存配置失败');
    } finally {
      setBusy(false);
    }
  }

  async function deleteProfile(profile: ProfileInfo) {
    if (!window.confirm('确定删除数据集配置「' + profile.title + '」（' + profile.id + '）吗？')) return;
    const deleteFiles = window.confirm('是否同时删除该配置下的数据集文件（图片/标签目录）？\n点“确定”删除全部，点“取消”只删除配置文件、保留数据文件。');
    try {
      await api.remove(`/api/profiles/${encodeURIComponent(profile.id)}?deleteFiles=${deleteFiles}`);
      setProfilesMessage('已删除配置「' + profile.title + '」。');
      setModelViewProfile((prev) => (prev === profile.id ? null : prev));
      setProfileModels((prev) => { const next = { ...prev }; delete next[profile.id]; return next; });
      await loadProfiles();
      await refreshStatus();
    } catch (error) {
      setProfilesMessage(error instanceof Error ? error.message : '删除配置失败');
    }
  }

  function changeDatasetProfile(profile: string) {
    if (profile === datasetProfile) return;
    if (annotationDirty && !window.confirm('当前标注尚未保存，确定切换数据集配置吗？')) return;
    setAnnotationDirty(false);
    setDatasetProfile(profile);
  }

  function navigate(nextMenu: MenuKey) {
    const nextPath = MENU_PATHS[nextMenu];
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, '', nextPath);
    }
    setMenu(nextMenu);
  }

  async function refreshAll() {
    await Promise.all([
      refreshStatus(),
      refreshTask(),
      refreshLog(),
      refreshPredictions(true),
      refreshTaskHistory(),
      refreshPredictionTasks(),
    ]);
  }

  function handleAnnotationPageLoaded(response: AnnotationImagePage) {
    setAnnotationClasses(response.classes);
    if (!response.classes.some((item) => item.id === selectedClassId)) setSelectedClassId(response.classes[0]?.id ?? 0);
    const images = response.images;
    const sameContext = Boolean(selectedImage && selectedImage.profile === annotateProfile && selectedImage.split === annotateSplit);
    const matchByName = selectedImage ? images.find((item) => item.name === selectedImage.name) : null;
    if (matchByName) {
      // 当前选中图片仍在响应列表中：保留 selectedImage（含本地最新 boxes），不强制用 match 覆盖
      return;
    }
    if (selectedImage && sameContext) {
      // 列表里没有当前选中（被筛选掉或换页）：保留 selectedImage 不变，由调用方决定后续
      return;
    }
    const fallback = images[0] || null;
    setSelectedImage(fallback);
    annotationBoxesRef.current = fallback?.boxes || [];
    setAnnotationBoxes(fallback?.boxes || []);
    resetAnnotationHistory(fallback?.boxes || []);
    setAnnotationDirty(false);
    setSelectedBoxIndex(null);
  }

  async function refreshDatasetReport() {
    if (!datasetProfile) {
      setDatasetReport(null);
      return;
    }
    try {
      const response = await api.get<{ report: DatasetCheckReport | null }>(`/api/dataset/check?profile=${encodeURIComponent(datasetProfile)}`);
      setDatasetReport(response.report);
    } catch {
      setDatasetReport(null);
    }
  }

  async function runDatasetCheck() {
    setBusy(true);
    try {
      const response = await api.postJson<{ report: DatasetCheckReport }>('/api/tasks/check', { profile: datasetProfile });
      setDatasetReport(response.report);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '数据集检查失败');
    } finally {
      setBusy(false);
    }
  }

  async function refreshTrainingResources() {
    try {
      const response = await api.get<{ resources: ResourceSnapshot }>(`/api/tasks/resources?device=${encodeURIComponent(trainDevice)}`);
      setResourceSnapshot(response.resources);
    } catch {
      setResourceSnapshot(null);
    }
  }

  async function runTask(endpoint: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      await api.postJson(endpoint, { profile: datasetProfile, ...payload });
      await refreshAll();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '任务启动失败');
    } finally {
      setBusy(false);
    }
  }

  async function stopTask() {
    if (!window.confirm('确定停止当前训练任务吗？已完成的轮次会保留，但任务将标记为已取消。')) return;
    await api.post('/api/tasks/stop');
    await refreshAll();
  }

  async function uploadDataset(form: FormData, setMessage: (value: string) => void) {
    setMessage('正在导入...');
    try {
      const response = await api.post<{ savedImages: unknown[]; savedLabels: unknown[] }>('/api/dataset/upload', form);
      setMessage(`导入完成：${response.savedImages.length} 张图片，${response.savedLabels.length} 个标签文件。`);
      invalidateImageCaches();
      await refreshStatus();
      await loadManagedImages(photoSplit, photoPage, true);
      await loadAnnotationImages(annotateSplit, annotationPage, annotationLabelFilter, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败');
    }
  }

  async function deleteDatasetImage(image: DatasetImage) {
    if (!window.confirm(`确定删除 ${image.name} 吗？图片和同名标签都会删除。`)) return;
    try {
      await api.remove(`/api/dataset/images/${image.profile}/${image.split}/${encodeURIComponent(image.name)}`);
      setPhotoMessage(`已删除：${image.name}`);
        setSelectedPhotoNames((current) => current.filter((item) => item !== image.name));
      invalidateImageCaches();
      await refreshStatus();
      await loadManagedImages(photoSplit, photoPage, true);
      await loadAnnotationImages(annotateSplit, annotationPage, annotationLabelFilter, true);
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : '删除失败');
    }
  }
  function togglePhotoSelection(name: string) {
    setSelectedPhotoNames((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name]
    );
  }

  function toggleSelectAllPhotos() {
    setSelectedPhotoNames((current) =>
      (() => {
        const currentNames = new Set(managedImages.map((item) => item.name));
        const allCurrentSelected = managedImages.every((item) => current.includes(item.name));
        return allCurrentSelected
          ? current.filter((name) => !currentNames.has(name))
          : Array.from(new Set([...current, ...currentNames]));
      })()
      // ? []
      // : managedImages.map((item) => item.name)
    );
  }

  async function deleteSelectedPhotos() {
    if (!selectedPhotoNames.length) return;
    if (!window.confirm(`确定删除选中的 ${selectedPhotoNames.length} 张图片吗？图片和同名标签都会删除。`)) return;
    try {
      const response = await api.postJson<{ deleted: string[] }>('/api/dataset/images/batch-delete', {
        profile: datasetProfile,
        split: photoSplit,
        filenames: selectedPhotoNames,
      });
      setPhotoMessage(`已批量删除 ${response.deleted.length} 张图片。`);
      setSelectedPhotoNames([]);
      invalidateImageCaches();
      await refreshStatus();
      await loadManagedImages(photoSplit, photoPage, true);
      await loadAnnotationImages(annotateSplit, annotationPage, annotationLabelFilter, true);
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : '批量删除失败');
    }
  }

  function handleAnnotationChange(next: Box[]) {
    changeAnnotationBoxes(next);
  }

  function selectAnnotationImage(image: DatasetImage, skipConfirm = false): boolean {
    if (selectedImage?.name === image.name && selectedImage.split === image.split && selectedImage.profile === image.profile) return true;
    if (!skipConfirm && annotationDirty && !window.confirm('当前标注尚未保存，确定切换图片吗？')) return false;
    const boxes = image.boxes || [];
    setSelectedImage(image);
    annotationBoxesRef.current = boxes;
    setAnnotationBoxes(boxes);
    resetAnnotationHistory(boxes);
    setAnnotationDirty(false);
    setSelectedBoxIndex(null);
    setAnnotationMessage('');
    return true;
  }

  function changeAnnotationPage(page: number) {
    if (annotationDirty && !window.confirm('当前标注尚未保存，确定切换页面吗？')) return;
    setAnnotationDirty(false);
    setAnnotationPage(page);
  }

  async function goToAdjacentAnnotation(delta: -1 | 1) {
    if (!selectedImage) return;
    const index = annotationImages.findIndex((item) => item.name === selectedImage.name);
    if (index < 0) return;
    const next = annotationImages[index + delta];
    if (next) {
      selectAnnotationImage(next);
      return;
    }
    const targetPage = annotationPage + delta;
    if (targetPage < 1 || targetPage > annotationPageCount) return;
    if (annotationDirty && !window.confirm('当前标注尚未保存，确定切换图片吗？')) return;
    setAnnotationDirty(false);
    const pageImages = await loadAnnotationImages(annotateSplit, targetPage, annotationLabelFilter);
    const target = delta < 0 ? pageImages[pageImages.length - 1] : pageImages[0];
    if (target) selectAnnotationImage(target, true);
  }

  async function saveAnnotation(moveNext = false) {
    if (!selectedImage || savingAnnotation) return;
    const currentName = selectedImage.name;
    setSavingAnnotation(true);
    const currentIndex = annotationImages.findIndex((item) => item.name === currentName);
    setAnnotationMessage('正在保存标注...');
    try {
      const response = await api.postJson<{ image: DatasetImage }>('/api/dataset/labels', {
        profile: selectedImage.profile,
        split: selectedImage.split,
        filename: selectedImage.name,
        expected_label_mtime: selectedImage.labelMtime ?? null,
        boxes: annotationBoxes.map((box) => ({
          class_id: box.classId,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        })),
      });
      const updated = response.image;
      const savedBoxes = updated.boxes || [];
      setSelectedImage(updated);
      setAnnotationBoxes(savedBoxes);
      resetAnnotationHistory(savedBoxes);
      setAnnotationDirty(false);
      const saveMessage = `已保存 ${updated.labelCount} 个标注框。`;
      setAnnotationMessage(saveMessage);
      setSaveDialog({ kind: 'success', message: saveMessage, autoClose: true });
      updateCachedAnnotationImage(updated);
      setSelectedBoxIndex(null);
      await refreshStatus();
      if (annotationLabelFilter === 'unlabeled' && updated.hasLabel) {
        const refreshed = await loadAnnotationImages(annotateSplit, annotationPage, annotationLabelFilter, true);
        if (moveNext) {
          if (refreshed.length) {
            selectAnnotationImage(refreshed[0], true);
          } else if (annotationPage < annotationPageCount) {
            const nextPageImages = await loadAnnotationImages(annotateSplit, annotationPage + 1, annotationLabelFilter);
            if (nextPageImages.length) selectAnnotationImage(nextPageImages[0], true);
          }
        }
      } else if (moveNext) {
        await goToAdjacentAnnotation(1);
      }
    } catch (error) {
      const saveMessage = error instanceof Error ? error.message : '保存标注失败';
      setAnnotationMessage(saveMessage);
      const conflict = error instanceof ApiError && error.status === 409;
      setSaveDialog(
        conflict
          ? {
              kind: 'error',
              message: saveMessage,
              actionLabel: '重新加载图片',
              onAction: () => {
                void reloadCurrentAnnotation();
              },
            }
          : { kind: 'error', message: `保存失败：${saveMessage}`, autoClose: true },
      );
    } finally {
      setSavingAnnotation(false);
    }
  }

  async function reloadCurrentAnnotation() {
    if (!selectedImage) return;
    const currentName = selectedImage.name;
    setSaveDialog(null);
    const images = await loadAnnotationImages(annotateSplit, annotationPage, annotationLabelFilter, true);
    if (!selectedImage || selectedImage.name !== currentName) return;
    const fresh = images.find((item) => item.name === currentName);
    if (fresh) {
      setSelectedImage(fresh);
      annotationBoxesRef.current = fresh.boxes || [];
      setAnnotationBoxes(fresh.boxes || []);
      resetAnnotationHistory(fresh.boxes || []);
      setAnnotationDirty(false);
      setSelectedBoxIndex(null);
      setAnnotationMessage('标注已重新加载，请基于最新内容编辑');
    }
  }

  function updateCachedAnnotationImage(updated: DatasetImage) {
    replaceImage(updated);
  }

  async function predict(form: FormData) {
    setPredicting(true);
    setPredictionMessage('已提交预测任务，正在等待队列...');
    try {
      const submitted = await api.post<{ id: string; status: PredictionTask['status'] }>('/api/predict', form);
      setPredictionMessage('已提交预测任务，正在等待队列...');
      await pollPredictionTask(submitted.id);
    } catch (error) {
      setPredicting(false);
      setPredictionMessage(error instanceof Error ? error.message : '预测失败');
    }
  }

  async function pollPredictionTask(taskId: string) {
    for (;;) {
      const task = await api.get<PredictionTask>(`/api/predictions/tasks/${taskId}`);
      setPredictionMessage(predictionTaskMessage(task));
      await refreshPredictionTasks();
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled' || task.status === 'interrupted') {
        setPredicting(false);
        if (task.status === 'completed' && task.predictions) {
          setPredictions(task.predictions);
          await Promise.all([refreshStatus(), refreshLog()]);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  async function loadImportedModels() {
    setPredictionActionError('');
    try {
      const response = await api.get<{ models: ImportedModelInfo[] }>('/api/models/imported');
      setImportedModels(response.models);
    } catch (error) {
      setPredictionActionError(error instanceof Error ? error.message : '读取导入模型失败');
    }
  }

  async function handleImportModelChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPredictionActionError('');
    setImportingModel(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await api.post<{ model: ImportedModelInfo }>('/api/models/import', form);
      await loadImportedModels();
      setSelectedModel('imported:' + response.model.filename);
      setPredictionMessage('已导入模型「' + response.model.name + '」，已选中用于测试。');
    } catch (error) {
      setPredictionActionError(error instanceof Error ? error.message : '导入模型失败');
    } finally {
      setImportingModel(false);
      event.target.value = '';
    }
  }

  async function removeImportedModel(model: ImportedModelInfo) {
    if (!window.confirm('确定删除导入的模型「' + model.name + '」吗？')) return;
    setPredictionActionError('');
    try {
      await api.remove('/api/models/imported/' + encodeURIComponent(model.filename));
      if (selectedModel === 'imported:' + model.filename) setSelectedModel('');
      await loadImportedModels();
      setPredictionMessage('已删除导入模型「' + model.name + '」。');
    } catch (error) {
      setPredictionActionError(error instanceof Error ? error.message : '删除模型失败');
    }
  }

  const navItems: Array<{ key: MenuKey; label: string; icon: React.ReactNode }> = [
    { key: 'overview', label: '总览', icon: <LayoutDashboard size={18} /> },
    { key: 'dataset', label: '数据集导入', icon: <Upload size={18} /> },
    { key: 'photos', label: '训练图片', icon: <FolderOpen size={18} /> },
    { key: 'annotate', label: '在线标注', icon: <PencilRuler size={18} /> },
    { key: 'profiles', label: '数据集配置', icon: <Settings size={18} /> },
    { key: 'training', label: '训练任务', icon: <Play size={18} /> },
    { key: 'prediction', label: '预测调试', icon: <FileImage size={18} /> },
    { key: 'logs', label: '日志与结果', icon: <TerminalSquare size={18} /> },
  ];



  const cacheStats = useMemo(() => {
    void cacheStatsVersion;
    return {
      images: managedImagesCache.current.stats(),
      annotations: annotationCache.current.stats(),
      predictions: predictionResultsCache.current.stats(),
    };
  }, [cacheStatsVersion]);

  const splitRows = (['train', 'val', 'test'] as Split[]).map((key) => {
    const item = dataset?.splits[key];
    const issues = (item?.missingLabelCount ?? 0) + (item?.orphanLabelCount ?? 0);
    return (
      <tr key={key}>
        <td>{splitName(key)}</td>
        <td>{item?.images ?? 0}</td>
        <td>{item?.labels ?? 0}</td>
        <td>{issues}</td>
        <td>{issues === 0 ? '正常' : '待处理'}</td>
      </tr>
    );
  });

  const stats = useMemo(
    () => [
      {
        label: '当前配置',
        value: currentProfile?.title || datasetProfile,
        note: `profile: ${datasetProfile} / ${currentClasses.length} 个类别`,
        icon: <FolderOpen size={18} />,
      },
      {
        label: '训练设备',
        value: status?.cuda ? 'CUDA' : 'CPU',
        note: status?.cuda ? status.cudaDevice : '当前使用 CPU 训练',
        icon: <Activity size={18} />,
      },
      {
        label: '训练图片',
        value: `${dataset?.totalImages ?? 0} 张`,
        note: `${dataset?.totalLabels ?? 0} 个标签文件`,
        icon: <ImagePlus size={18} />,
      },
      {
        label: '当前任务',
        value: taskName(task?.kind),
        note: taskState(task?.status),
        icon: <TerminalSquare size={18} />,
      },
      {
        label: '模型状态',
        value: status?.bestModel ? '已训练模型' : '预训练模型',
        note: shortPath(status?.bestModel ?? status?.pretrained),
        icon: <CheckCircle2 size={18} />,
      },
    ],
    [currentClasses.length, currentProfile, dataset, datasetProfile, status, task]
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">YO</div>
          <div>
            <div className="brand-title">YOLO 训练台</div>
            <div className="brand-subtitle">目标检测管理系统</div>
          </div>
        </div>

        <nav className="menu">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={menu === item.key ? 'menu-item active' : 'menu-item'}
              onClick={() => navigate(item.key)}
            >
              <span className="menu-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-actions">
            <button type="button" className="btn" onClick={() => void refreshAll()}>
              <RefreshCw size={14} />
              刷新
            </button>
            {running ? (
              <button type="button" className="btn danger" onClick={() => void stopTask()}>
                <X size={14} />
                停止任务
              </button>
            ) : null}
          </div>
          <div className="status-line">
            <span className={running ? 'dot live' : 'dot'} />
            {running ? '训练任务运行中' : '当前没有运行任务'}
          </div>
          <div className="status-line">{status?.cuda ? 'GPU 可用' : 'CPU 模式'}</div>
        </div>
      </aside>

      <main className="content">

        {task?.status === 'failed' ? (
          <div className="task-banner">
            <TerminalSquare size={16} />
            <span>
              任务失败：{taskName(task.kind)}（退出码 {task.returncode ?? '-'}），请查看任务日志了解详细原因。
            </span>
            <button type="button" className="btn" onClick={() => void refreshLog()}>
              查看日志
            </button>
          </div>
        ) : null}

        {menu === 'overview' ? (
          <section className="page-stack">
            <section className="card-grid">
              {stats.map((item) => (
                <StatCard key={item.label} {...item} />
              ))}
            </section>

            <section className="panel dataset-context">
              <PanelHead
                title="当前数据集配置"
                description="导入、训练、预测默认使用这里选中的配置；在线标注可以在页面内单独切换。"
                actions={<span className="pill">{datasetProfile}</span>}
              />
              <div className="dataset-summary-grid">
                <div>
                  <span>配置名称</span>
                  <strong>{currentProfile?.title || '-'}</strong>
                </div>
                <div>
                  <span>训练条件</span>
                  <strong>{dataset?.ready ? 'train 和 val 已有图片' : '需要 train 和 val 都有图片'}</strong>
                </div>
                <div>
                  <span>训练模型</span>
                  <strong>{shortPath(status?.bestModel) || '尚未训练，预测会使用预训练模型'}</strong>
                </div>
              </div>
              <div className="class-chip-list">
                {currentClasses.length ? (
                  currentClasses.map((item) => (
                    <span className="class-chip" key={item.id}>
                      <b>{item.id}</b>
                      {item.displayName}
                      <small>{item.name}</small>
                    </span>
                  ))
                ) : (
                  <span className="empty compact-empty">类别加载中...</span>
                )}
              </div>
            </section>

            <section className="panel cache-diagnostics">
              <PanelHead
                title="缓存诊断"
                description="页面缓存采用 TTL + LRU，切换数据集或筛选条件后会自动隔离并清理。"
                actions={<button type="button" className="btn" onClick={refreshCacheStats}>刷新统计</button>}
              />
              <div className="kv-grid">
                {([
                  ['图片列表', cacheStats.images],
                  ['标注列表', cacheStats.annotations],
                  ['预测结果', cacheStats.predictions],
                ] as const).map(([label, item]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{item.entries} 项 / 命中率 {(item.hitRate * 100).toFixed(1)}%</strong>
                    <small>命中 {item.hits} · 未命中 {item.misses} · 淘汰 {item.evictions} · 过期 {item.expirations}</small>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel storage-diagnostics">
              <PanelHead
                title="磁盘配额"
                description="预测结果与上传暂存目录会按保留时间和容量自动清理，活动任务文件不会被清理。"
                actions={<button type="button" className="btn" disabled={storageStatsLoading} onClick={() => void refreshStorageStats(true)}>{storageStatsLoading ? "清理中..." : "立即清理"}</button>}
              />
              {storageStats ? (
                <div className="kv-grid">
                  {(['predictions', 'uploads'] as const).map((key) => {
                    const item = storageStats[key];
                    return (
                      <div key={key}>
                        <span>{key === 'predictions' ? '预测结果' : '上传暂存'}</span>
                        <strong>{formatBytes(item.bytes)} / {formatBytes(item.quotaBytes)} · {item.entries}/{item.quotaEntries} 项</strong>
                        <small>{item.overQuota ? '超过配额，等待清理' : '配额正常'} · 已保护 {item.protectedEntries} 项 · 清理失败 {item.failed} 次</small>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="help">磁盘配额统计加载中...</p>}
            </section>

            <section className="panel">
              <PanelHead
                title="运行环境"
                actions={<span className="pill">{status?.python ?? '加载中'}</span>}
              />
              <div className="kv-grid">
                <div>
                  <span>Python</span>
                  <strong>{status?.python ?? '-'}</strong>
                </div>
                <div>
                  <span>PyTorch</span>
                  <strong>{status?.torch ?? '-'}</strong>
                </div>
                <div>
                  <span>Ultralytics</span>
                  <strong>{status?.ultralytics ?? '-'}</strong>
                </div>
                <div>
                  <span>OpenCV</span>
                  <strong>{status?.opencv ?? '-'}</strong>
                </div>
                <div>
                  <span>CPU</span>
                  <strong>{status?.cpu ?? '-'}</strong>
                </div>
                <div>
                  <span>最佳模型</span>
                  <strong>{shortPath(status?.bestModel)}</strong>
                </div>
              </div>
            </section>

            <section className="panel">
              <PanelHead
                title="数据集状态"
                actions={<span className="pill">{dataset?.ready ? '可开始训练' : '尚未满足训练条件'}</span>}
              />
              {datasetReport ? (
                <>
                  <div className={`check-summary ${datasetReport.ready ? 'success' : 'danger'}`}>
                    <strong>{datasetReport.ready ? '检查通过，可以开始训练' : `检查未通过：${datasetReport.blockingCount} 个阻断问题`}</strong>
                    <span>警告 {datasetReport.warningCount} 个，类别分布：{Object.entries(datasetReport.classDistribution).map(([id, count]) => `${id}: ${count}`).join('，') || '暂无'}</span>
                  </div>
                  {datasetReport.issues.length ? (
                    <details className="check-details">
                      <summary>查看问题详情（显示前 {Math.min(datasetReport.issues.length, 50)} 条）</summary>
                      <ul>
                        {datasetReport.issues.slice(0, 50).map((issue, index) => (
                          <li key={`${issue.code}-${issue.filename}-${issue.line}-${index}`} className={issue.severity === 'blocking' ? 'danger' : ''}>
                            <strong>{issue.severity === 'blocking' ? '阻断' : '警告'}</strong> {issue.split || ''}{issue.filename ? ` / ${issue.filename}` : ''}{issue.line ? `:${issue.line}` : ''}：{issue.message}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </>
              ) : null}
              <table className="table">
                <thead>
                  <tr>
                    <th>分组</th>
                    <th>图片</th>
                    <th>标签</th>
                    <th>问题数</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>{splitRows}</tbody>
              </table>
            </section>
          </section>
        ) : null}

        {menu === 'dataset' ? (
          <section className="page-stack">
            <section className="panel dataset-context compact-context">
              <PanelHead
                title={<>正在管理：{currentProfile?.title || datasetProfile}</>}
                description="上传的图片和标签会进入此配置对应的数据集目录。"
                actions={<span className="pill">{datasetProfile}</span>}
              />
              <div className="class-chip-list">
                {currentClasses.map((item) => (
                  <span className="class-chip" key={item.id}>
                    <b>{item.id}</b>
                    {item.displayName}
                    <small>{item.name}</small>
                  </span>
                ))}
              </div>
            </section>

            <section className="panel">
              <PanelHead
                title="导入训练数据"
                actions={<span className="pill">YOLO 格式</span>}
              />
              <form
                className="form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData();
                  const element = event.currentTarget;
                  const images = (element.elements.namedItem('images') as HTMLInputElement).files;
                  const labels = (element.elements.namedItem('labels') as HTMLInputElement).files;
                  form.append('profile', datasetProfile);
                  form.append('split', importSplit);
                  Array.from(images ?? []).forEach((file) => form.append('images', file));
                  Array.from(labels ?? []).forEach((file) => form.append('labels', file));
                  void uploadDataset(form, setDatasetMessage);
                  element.reset();
                }}
              >
                <label>
                  导入分组
                  <select value={importSplit} onChange={(event) => setImportSplit(event.target.value as Split)}>
                    <option value="train">训练集 train</option>
                    <option value="val">验证集 val</option>
                    <option value="test">测试集 test</option>
                  </select>
                </label>
                <label>
                  图片文件
                  <input name="images" type="file" accept="image/*" multiple />
                </label>
                <label>
                  YOLO 标签文件
                  <input name="labels" type="file" accept=".txt" multiple />
                </label>
                <button type="submit" className="primary">
                  <Upload size={16} />
                  导入数据
                </button>
              </form>
              <p className="help">
                {datasetMessage || '标签文件需与图片同名，例如 image001.jpg 对应 image001.txt；也可以只导入图片，再到“在线标注”页面画框。'}
              </p>
            </section>

            <section className="panel">
              <PanelHead
                title="数据集检查"
                actions={
                  <button type="button" className="btn" disabled={busy} onClick={() => void runDatasetCheck()}>
                    <ListChecks size={16} />
                    检查数据集
                  </button>
                }
              />
              <table className="table">
                <thead>
                  <tr>
                    <th>分组</th>
                    <th>图片</th>
                    <th>标签</th>
                    <th>问题数</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>{splitRows}</tbody>
              </table>
            </section>
          </section>
        ) : null}

        {menu === 'photos' ? (
          <section className="page-stack">
            <section className="panel">
              <PanelHead
                title="训练图片管理"
                actions={
                  <>
                    <select value={photoSplit} onChange={(event) => { setPhotoPage(1); setPhotoSplit(event.target.value as Split); }}>
                      <option value="train">训练集 train</option>
                      <option value="val">验证集 val</option>
                      <option value="test">测试集 test</option>
                    </select>
                    <select
                      value={photoLabelFilter}
                      onChange={(event) => {
                        setPhotoPage(1);
                        setPhotoLabelFilter(event.target.value as 'all' | 'labeled' | 'unlabeled');
                      }}
                    >
                      <option value="all">全部图片</option>
                      <option value="unlabeled">未标注</option>
                      <option value="labeled">已标注</option>
                    </select>
                    <button type="button" className="btn" onClick={() => void loadManagedImages(photoSplit, photoPage, true)}>
                      <RefreshCw size={16} />
                      刷新列表
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      disabled={!selectedPhotoNames.length}
                      onClick={() => void deleteSelectedPhotos()}
                    >
                      <Trash2 size={16} />
                      批量删除{selectedPhotoNames.length ? ` (${selectedPhotoNames.length})` : ''}
                    </button>
                  </>
                }
              />

              <form
                className="photo-upload-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData();
                  const element = event.currentTarget;
                  const images = (element.elements.namedItem('photoImages') as HTMLInputElement).files;
                  const labels = (element.elements.namedItem('photoLabels') as HTMLInputElement).files;
                  form.append('profile', datasetProfile);
                  form.append('split', photoSplit);
                  Array.from(images ?? []).forEach((file) => form.append('images', file));
                  Array.from(labels ?? []).forEach((file) => form.append('labels', file));
                  void uploadDataset(form, setPhotoMessage);
                  element.reset();
                }}
              >
                <label>
                  批量添加图片
                  <input name="photoImages" type="file" accept="image/*" multiple />
                </label>
                <label>
                  同时添加标签
                  <input name="photoLabels" type="file" accept=".txt" multiple />
                </label>
                <button type="submit" className="primary">
                  <ImagePlus size={16} />
                  添加图片
                </button>
              </form>
              <p className="help">{photoMessage || '可直接添加未标注图片，然后进入“在线标注”进行框选。'}</p>
            </section>

            <section className="panel">
              <PanelHead
                title={splitName(photoSplit)}
                actions={
                  <>
                    <span className="pill">{photoTotal} 张图片</span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={managedImages.length > 0 && managedImages.every((item) => selectedPhotoNames.includes(item.name))}
                        onChange={toggleSelectAllPhotos}
                      />
                      全选本页
                    </label>
                  </>
                }
              />
              <div className="photo-grid">
                {managedImages.length ? (
                  managedImages.map((image) => (
                    <article className={selectedPhotoNames.includes(image.name) ? 'photo-card selected' : 'photo-card'} key={`${image.split}-${image.name}`}>
                        <label className="photo-card-select">
                          <input
                            type="checkbox"
                            checked={selectedPhotoNames.includes(image.name)}
                            onChange={() => togglePhotoSelection(image.name)}
                          />
                          <span>选择</span>
                        </label>
                      <img src={image.thumbnailUrl || image.url} alt={image.name} loading="lazy" />
                      <div className="photo-card-body">
                        <strong>{image.name}</strong>
                        <span>{image.hasLabel ? `已标注 ${image.labelCount} 个框` : '未标注'}</span>
                        <div className="photo-card-actions">
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              if (!selectAnnotationImage(image)) return;
                              setAnnotateSplit(image.split);
                              setAnnotateProfile(image.profile);
                              navigate('annotate');
                            }}
                          >
                            <PencilRuler size={15} />
                            标注
                          </button>
                          <button type="button" className="btn danger" onClick={() => void deleteDatasetImage(image)}>
                            <Trash2 size={15} />
                            删除
                          </button>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty">没有符合条件的图片。</div>
                )}
              </div>
              <Pagination page={photoPage} pageCount={photoPageCount} onChange={setPhotoPage} />
            </section>
          </section>
        ) : null}

        {menu === 'annotate' ? (
          <AnnotationWorkspace
            profileOptions={profileOptions}
            annotateProfile={annotateProfile}
            annotateSplit={annotateSplit}
            annotationLabelFilter={annotationLabelFilter}
            annotationImages={annotationImages}
            annotationTotal={annotationTotal}
            annotationPage={annotationPage}
            annotationPageCount={annotationPageCount}
            selectedImage={selectedImage}
            annotationBoxes={annotationBoxes}
            annotationClasses={annotationClasses}
            selectedClassId={selectedClassId}
            selectedBoxIndex={selectedBoxIndex}
            annotationMessage={annotationMessage}
            annotationDirty={annotationDirty}
            savingAnnotation={savingAnnotation}
            annotationImagesLoading={annotationImagesLoading}
            annotationImagesError={annotationImagesError}
            annotationStatusLoading={annotationStatusLoading}
            annotationStatusError={annotationStatusError}
            historyPastLength={annotationHistory.current.past.length}
            historyFutureLength={annotationHistory.current.future.length}
            onSplitChange={(split) => {
              if (annotationDirty && !window.confirm('当前标注尚未保存，确定切换数据集分组吗？')) return;
              setAnnotationPage(1);
              setAnnotateSplit(split);
            }}
            onProfileChange={(profile) => {
              if (annotationDirty && !window.confirm('当前标注尚未保存，确定切换数据集配置吗？')) return;
              setAnnotationPage(1);
              setAnnotateProfile(profile);
            }}
            onLabelFilterChange={(filter) => {
              if (annotationDirty && !window.confirm('当前标注尚未保存，确定切换筛选条件吗？')) return;
              setAnnotationPage(1);
              setAnnotationLabelFilter(filter);
            }}
            onSelectImage={(image) => { selectAnnotationImage(image); }}
            onPageChange={changeAnnotationPage}
            onPrevious={() => { void goToAdjacentAnnotation(-1); }}
            onNext={() => { void goToAdjacentAnnotation(1); }}
            onClassChange={setSelectedClassId}
            onUndo={undoAnnotation}
            onRedo={redoAnnotation}
            onRemoveLastBox={() => {
              changeAnnotationBoxes(annotationBoxes.slice(0, -1));
              setSelectedBoxIndex(null);
            }}
            onClearBoxes={() => {
              changeAnnotationBoxes([]);
              setSelectedBoxIndex(null);
            }}
            onSave={() => { void saveAnnotation(); }}
            onSaveAndNext={() => { void saveAnnotation(true); }}
            onSelectBox={setSelectedBoxIndex}
            onDeleteBox={(index) => {
              changeAnnotationBoxes(annotationBoxes.filter((_, i) => i !== index));
              setSelectedBoxIndex(null);
            }}
            onAnnotationChange={handleAnnotationChange}
            onPreviewChange={previewAnnotationBoxes}
            onChangeStart={beginAnnotationGesture}
            onChangeCancel={cancelAnnotationGesture}
            onRetryImages={() => { void loadAnnotationImages(annotateSplit, annotationPage, annotationLabelFilter, true); }}
            onRetryStatus={() => { void refreshStatus(); }}
          />
        ) : null}
        {menu === 'training' ? (
          <TrainingPanel
            task={task}
            status={status}
            resourceSnapshot={resourceSnapshot}
            busy={busy}
            running={running}
            trainEpochs={trainEpochs}
            trainImageSize={trainImageSize}
            trainBatch={trainBatch}
            trainDevice={trainDevice}
            trainWorkers={trainWorkers}
            trainModel={trainModel}
            onTrainEpochsChange={setTrainEpochs}
            onTrainImageSizeChange={setTrainImageSize}
            onTrainBatchChange={setTrainBatch}
            onTrainDeviceChange={setTrainDevice}
            onTrainWorkersChange={setTrainWorkers}
            onTrainModelChange={setTrainModel}
            onRunTask={(endpoint, body) => void runTask(endpoint, body)}
            onStopTask={() => void stopTask()}
          />
        ) : null}

        {menu === 'prediction' ? (
          <PredictionPanel
            predictions={predictions}
            predictionStats={predictionStats}
            predictionTasks={predictionTasks}
            predictionMessage={predictionMessage}
            predictionResultsLoading={predictionResultsLoading}
            predictionResultsError={predictionResultsError}
            predictionTasksLoading={predictionTasksLoading}
            predictionTasksError={predictionTasksError}
            predictionActionError={predictionActionError}
            profileOptions={profileOptions}
            datasetProfile={datasetProfile}
            importedModels={importedModels}
            selectedModel={selectedModel}
            confidence={confidence}
            predictionLimit={predictionLimit}
            predictionFilterProfile={predictionFilterProfile}
            predictionFilterModel={predictionFilterModel}
            predictionMinConf={predictionMinConf}
            selectedPredictionPaths={selectedPredictionPaths}
            localFileUrl={localFileUrl}
            predicting={predicting}
            importingModel={importingModel}
            onPredict={(form) => void predict(form)}
            onPredictionFileChange={handlePredictionFileChange}
            onClearLocalFile={() => {
              if (localFileUrl) URL.revokeObjectURL(localFileUrl);
              setLocalFileUrl(null);
            }}
            onSelectedModelChange={setSelectedModel}
            onConfidenceChange={setConfidence}
            onImportModelChange={(event) => void handleImportModelChange(event)}
            onRemoveImportedModel={(model) => void removeImportedModel(model)}
            onPredictionFilterProfileChange={setPredictionFilterProfile}
            onPredictionFilterModelChange={setPredictionFilterModel}
            onPredictionMinConfChange={setPredictionMinConf}
            onPredictionLimitChange={setPredictionLimit}
            onRefreshPredictions={() => void refreshPredictions(true)}
            onDeleteSelectedPredictions={() => void deleteSelectedPredictions()}
            onToggleSelectAllPredictions={toggleSelectAllPredictions}
            onTogglePredictionSelection={togglePredictionSelection}
            onPreviewPrediction={setPreviewPredictionUrl}
            onRefreshPredictionTasks={() => void refreshPredictionTasks()}
            onCancelPredictionTask={(taskId) => void cancelPredictionTask(taskId)}
            onRetryPredictionTask={(taskId) => void retryPredictionTask(taskId)}
            onCleanupPredictionTask={(taskId) => void cleanupPredictionTask(taskId)}
          />
        ) : null}

        {menu === 'profiles' ? (
          <section className="page-stack">
            <section className="panel">
              <PanelHead
                title={<>训练模型 — {profileList.find((item) => item.id === modelViewProfile)?.title || modelViewProfile}</>}
                  description={`存放于 runs/${modelViewProfile}_yolo11n*/weights/best.pt 的已训练模型。`}
                actions={
                  <button type="button" className="btn" onClick={() => setModelViewProfile(null)}>
                    <X size={15} />
                    关闭
                  </button>
                }
              />
              <p className="help">
                {profilesMessage || '共 ' + profileList.length + ' 个数据集配置，当前使用：' + (currentProfile?.title || datasetProfile) + '。'}
              </p>
              {profileList.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>标题</th>
                      <th>ID</th>
                      <th>类别数</th>
                      <th>图片 / 标签</th>
                      <th>训练模型</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileList.map((profile) => (
                      <tr key={profile.id} className={profile.id === datasetProfile ? 'active-row' : ''}>
                        <td>
                          <strong>{profile.title}</strong>{' '}
                          {profile.id === datasetProfile ? <span className="pill">当前</span> : null}
                        </td>
                        <td><code>{profile.id}</code></td>
                        <td>{profile.classCount}</td>
                        <td>
                          {profile.totalImages} / {profile.totalLabels}
                        </td>
                        <td>
                          {profile.bestModel ? (
                            <button type="button" className="btn" onClick={() => void openModelView(profile.id)}>
                              <FolderOpen size={15} />
                              查看模型
                            </button>
                          ) : (
                            <span className="muted-text">暂无</span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="btn" onClick={() => openEditForm(profile)}>
                              <Pencil size={14} />
                              编辑
                            </button>
                            <button type="button" className="btn" onClick={() => void openModelView(profile.id)}>
                              <Eye size={14} />
                              模型
                            </button>
                            <button
                              type="button"
                              className="btn danger"
                              disabled={profileList.length <= 1}
                              onClick={() => void deleteProfile(profile)}
                            >
                              <Trash2 size={14} />
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty">还没有数据集配置，请点击“新增配置”创建。</div>
              )}
            </section>

            {modelViewProfile ? (
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>
                      训练模型 — {profileList.find((item) => item.id === modelViewProfile)?.title || modelViewProfile}
                    </h2>
                    <p className="annotation-help">存放于 runs/{modelViewProfile}_yolo11n*/weights/best.pt 的已训练模型。</p>
                  </div>
                  <button type="button" className="btn" onClick={() => setModelViewProfile(null)}>
                    <X size={15} />
                    关闭
                  </button>
                </div>
                {modelLoading ? (
                  <div className="empty">正在读取模型列表...</div>
                ) : profileModels[modelViewProfile]?.length ? (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>运行目录</th>
                        <th>修改时间</th>
                        <th>大小</th>
                        <th>路径</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profileModels[modelViewProfile].map((model) => (
                        <tr key={model.path}>
                          <td>{model.name}</td>
                          <td>{formatTime(model.mtime)}</td>
                          <td>{formatBytes(model.size)}</td>
                          <td className="command-cell">{model.path}</td>
                          <td>
                            <div className="row-actions">
                              <a className="btn" href={model.url} download>
                                <Download size={14} />
                                下载
                              </a>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => {
                                  void copyText(model.path);
                                  setProfilesMessage('模型路径已复制到剪贴板。');
                                }}
                              >
                                <Copy size={14} />
                                复制路径
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty">该配置还没有训练模型。</div>
                )}
              </section>
            ) : null}
          </section>
        ) : null}

        {showProfileForm ? (
          <div className="modal-overlay" onClick={() => setShowProfileForm(false)}>
            <div className="modal profile-modal" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <h2>{editingProfile ? '编辑配置：' + editingProfile.id : '新增数据集配置'}</h2>
                <button type="button" className="btn icon-btn" onClick={() => setShowProfileForm(false)}>
                  <X size={16} />
                </button>
              </div>
              <div className="modal-body">
                <label className="compact-field">
                  <span>配置 ID（创建后不可修改）</span>
                  <input
                    value={profileFormId}
                    disabled={!!editingProfile}
                    onChange={(event) => setProfileFormId(event.target.value)}
                    placeholder="例如 cat_det"
                  />
                </label>
                <label className="compact-field">
                  <span>标题</span>
                  <input
                    value={profileFormTitle}
                    onChange={(event) => setProfileFormTitle(event.target.value)}
                    placeholder="例如 猫检测"
                  />
                </label>
                <div className="compact-field">
                  <span>类别（显示名可留空，默认使用英文名）</span>
                  {profileFormClasses.map((item, index) => (
                    <div className="class-row" key={index}>
                      <input
                        value={item.name}
                        placeholder={'类别 ' + index + '（英文名称）'}
                        onChange={(event) => updateClassRow(index, 'name', event.target.value)}
                      />
                      <input
                        value={item.displayName}
                        placeholder="显示名（中文）"
                        onChange={(event) => updateClassRow(index, 'displayName', event.target.value)}
                      />
                      <button
                        type="button"
                        className="btn icon-btn"
                        disabled={profileFormClasses.length <= 1}
                        onClick={() => removeClassRow(index)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn" onClick={addClassRow}>
                    <Plus size={14} />
                    添加类别
                  </button>
                </div>
                {formError ? <p className="form-error">{formError}</p> : null}
              </div>
              <div className="modal-foot">
                <button type="button" className="btn" onClick={() => setShowProfileForm(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void (editingProfile ? saveProfile() : createProfile())}
                >
                  <Save size={16} />
                  {editingProfile ? '保存修改' : '创建配置'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {menu === 'logs' ? (
          <section className="page-stack">
            <section className="panel">
              <PanelHead
                title="任务日志"
                actions={
                  <label className="switch">
                    <input type="checkbox" checked={logAuto} onChange={(event) => setLogAuto(event.target.checked)} />
                    <span>自动刷新</span>
                  </label>
                }
              />
              <pre className="log-box">{log?.log || '当前没有任务日志。'}</pre>
            </section>
            <section className="panel">
              <PanelHead
                title="当前任务"
                actions={
                  <button type="button" className="btn" onClick={() => void refreshLog()}>
                    <RefreshCw size={16} />
                    刷新日志
                  </button>
                }
              />
              <div className="kv-grid compact">
                <div>
                  <span>任务类型</span>
                  <strong>{taskName(log?.task?.kind)}</strong>
                </div>
                <div>
                  <span>任务状态</span>
                  <strong>{taskState(log?.task?.status)}</strong>
                </div>
                <div>
                  <span>退出代码</span>
                  <strong>{log?.task?.returncode ?? '-'}</strong>
                </div>
                <div>
                  <span>完成时间</span>
                  <strong>{formatTime(log?.task?.finishedAt)}</strong>
                </div>
              </div>
            </section>
            <section className="panel">
              <PanelHead
                title="任务历史"
                actions={
                  <>
                    <span className="pill">{taskHistory.length} 条</span>
                    <button type="button" className="btn" onClick={() => void refreshTaskHistory()}>
                      <RefreshCw size={16} />
                      刷新历史
                    </button>
                  </>
                }
              />
              <table className="table">
                <thead>
                  <tr>
                    <th>任务类型</th>
                    <th>状态</th>
                    <th>开始时间</th>
                    <th>完成时间</th>
                    <th>退出代码</th>
                    <th>指标</th>
                    <th>执行命令</th>
                    <th>日志</th>
                  </tr>
                </thead>
                <tbody>
                  {taskHistory.length ? (
                    taskHistory.map((item) => (
                      <tr key={item.id}>
                        <td>{taskName(item.kind)}</td>
                        <td>{taskState(item.status)}</td>
                        <td>{formatTime(item.startedAt)}</td>
                        <td>{formatTime(item.finishedAt)}</td>
                        <td>{item.returncode ?? '-'}</td>
                        <td>{item.metrics ? `第 ${item.metrics.current.epoch} 轮，mAP ${item.metrics.current.mAP50_95 == null ? '-' : item.metrics.current.mAP50_95.toFixed(3)}` : '-'}</td>
                        <td className="command-cell">{item.command.join(' ')}</td>
                        <td>
                          <button type="button" className="btn" onClick={() => void openHistoryLog(item.id)}>
                            查看日志
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8}>暂无历史任务。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </section>
        ) : null}

        {previewPredictionUrl ? (
          <div className="modal-overlay" onClick={() => setPreviewPredictionUrl(null)}>
            <div className="modal prediction-preview-modal" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <h3>预测结果预览</h3>
                <button type="button" className="btn" onClick={() => setPreviewPredictionUrl(null)}>
                  <X size={16} />
                  关闭
                </button>
              </div>
              <img src={previewPredictionUrl} alt="预测结果预览" className="prediction-preview-image" />
            </div>
          </div>
        ) : null}

        {historyLog ? (
          <div className="modal-overlay" onClick={() => setHistoryLog(null)}>
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <h3>历史任务日志</h3>
                <button type="button" className="btn" onClick={() => setHistoryLog(null)}>
                  <X size={16} />
                  关闭
                </button>
              </div>
              <pre className="log-box">{historyLog.log || '无日志内容。'}</pre>
            </div>
          </div>
        ) : null}

        {saveDialog ? (
          <div className={`save-toast ${saveDialog.kind}`} role="status">
            {saveDialog.kind === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{saveDialog.message}</span>
            {saveDialog.onAction && saveDialog.actionLabel ? (
              <button type="button" className="save-toast-action" onClick={saveDialog.onAction}>
                {saveDialog.actionLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
