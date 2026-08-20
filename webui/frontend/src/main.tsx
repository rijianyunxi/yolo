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
  ImportedModelInfo,
  HistoryLog,
  LogPayload,
  MenuKey,
  PredictionItem,
  PredictionTask,
  ProfileClassInput,
  ProfileInfo,
  Split,
  Status,
  Task,
  TrainedModel,
} from './types';
import { api } from './api';
import {
  MENU_PATHS,
  copyText,
  formatBytes,
  formatTime,
  menuFromLocation,
  modelSourceName,
  predictionStatusName,
  predictionTaskMessage,
  shortPath,
  splitName,
  taskName,
  taskState,
} from './utils';
import { AnnotationCanvas } from './components/AnnotationCanvas';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { Pagination } from './components/Pagination';
import { StatCard } from './components/StatCard';

function App() {
  const [menu, setMenu] = useState<MenuKey>(() => menuFromLocation());
  const [status, setStatus] = useState<Status | null>(null);
  const [liveTask, setLiveTask] = useState<Task | null>(null);
  const [log, setLog] = useState<LogPayload | null>(null);
  const [taskHistory, setTaskHistory] = useState<Task[]>([]);
  const [predictions, setPredictions] = useState<PredictionItem[]>([]);
  const [predictionTasks, setPredictionTasks] = useState<PredictionTask[]>([]);
  const [historyLog, setHistoryLog] = useState<HistoryLog | null>(null);
  const [busy, setBusy] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [importSplit, setImportSplit] = useState<Split>('train');
  const [datasetProfile, setDatasetProfile] = useState('');
  const [photoSplit, setPhotoSplit] = useState<Split>('train');
  const [annotateSplit, setAnnotateSplit] = useState<Split>('train');
  const [annotateProfile, setAnnotateProfile] = useState('');
  const [managedImages, setManagedImages] = useState<DatasetImage[]>([]);
  const [photoPage, setPhotoPage] = useState(1);
  const [photoTotal, setPhotoTotal] = useState(0);
  const [photoPageCount, setPhotoPageCount] = useState(0);
    const [photoLabelFilter, setPhotoLabelFilter] = useState<'all' | 'labeled' | 'unlabeled'>('all');
    const [selectedPhotoNames, setSelectedPhotoNames] = useState<string[]>([]);
  const [annotationImages, setAnnotationImages] = useState<DatasetImage[]>([]);
  const [annotationPage, setAnnotationPage] = useState(1);
  const [annotationTotal, setAnnotationTotal] = useState(0);
  const [annotationPageCount, setAnnotationPageCount] = useState(0);
  const [annotationLabelFilter, setAnnotationLabelFilter] = useState<'all' | 'labeled' | 'unlabeled'>('all');
  const annotationCache = useRef<{ profile: string; split: Split; label: 'all' | 'labeled' | 'unlabeled'; pages: Map<number, DatasetImage[]> }>({
    profile: '',
    split: 'train',
    label: 'all',
    pages: new Map(),
  });
  const [selectedImage, setSelectedImage] = useState<DatasetImage | null>(null);
  const [annotationBoxes, setAnnotationBoxes] = useState<Box[]>([]);
  const [annotationClasses, setAnnotationClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState(0);
  const [selectedBoxIndex, setSelectedBoxIndex] = useState<number | null>(null);
  const [datasetMessage, setDatasetMessage] = useState('');
  const [photoMessage, setPhotoMessage] = useState('');
  const [annotationMessage, setAnnotationMessage] = useState('');
  const [saveDialog, setSaveDialog] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [predictionMessage, setPredictionMessage] = useState('');
  const [confidence, setConfidence] = useState('0.25');
  const [predictionLimit, setPredictionLimit] = useState('48');
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

  const task = liveTask ?? status?.task ?? null;
  const dataset = status?.dataset;
  const running = task?.status === 'running';
  const profileOptions = status?.profiles || [];
  const currentProfile = profileOptions.find((item) => item.id === datasetProfile) || profileOptions[0];
  const currentClasses = status?.classes || [];

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

  useEffect(() => {
    void refreshAll();
    const refreshingRef: { current: boolean } = { current: false };
    const fastTimer = window.setInterval(() => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      Promise.allSettled([
        refreshTask(),
        logAuto ? refreshLog() : Promise.resolve(),
        refreshTaskHistory(),
        refreshPredictionTasks(),
      ]).finally(() => {
        refreshingRef.current = false;
      });
    }, 2200);
    const slowTimer = window.setInterval(() => {
      void refreshStatus();
    }, 15000);
    return () => {
      window.clearInterval(fastTimer);
      window.clearInterval(slowTimer);
    };
  }, [datasetProfile, logAuto]);

  useEffect(() => {
    setPhotoPage(1);
      setSelectedPhotoNames([]);
  }, [datasetProfile, photoLabelFilter, photoSplit]);

  useEffect(() => {
    if (menu === 'photos') void loadManagedImages(photoSplit, photoPage);
  }, [datasetProfile, menu, photoLabelFilter, photoPage, photoSplit]);

  useEffect(() => {
    setAnnotationPage(1);
  }, [annotateProfile, annotateSplit]);

  useEffect(() => {
    if (menu === 'annotate') void loadAnnotationImages(annotateSplit, annotationPage, annotationLabelFilter);
  }, [annotateProfile, annotationLabelFilter, annotationPage, annotateSplit, menu]);

  useEffect(() => {
    if (menu === 'profiles') void loadProfiles();
    if (menu === 'prediction') void loadImportedModels();
  }, [menu]);

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
    const timer = window.setTimeout(() => setSaveDialog(null), 1000);
    return () => window.clearTimeout(timer);
  }, [saveDialog]);

  function nudgeSelectedBox(dxPx: number, dyPx: number, index: number) {
    const img = selectedImage;
    if (!img) return;
    const imageWidth = img.width || 1;
    const imageHeight = img.height || 1;
    setAnnotationBoxes((current) =>
      current.map((box, i) => {
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
    const next = await api.get<Status>(`/api/status?profile=${profileOverride ?? datasetProfile}`);
    setStatus(next);
    setAnnotationClasses(next.classes);
    if (!next.classes.some((item) => item.id === selectedClassId)) {
      setSelectedClassId(next.classes[0]?.id ?? 0);
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

  async function refreshPredictions() {
    const limit = predictionLimit.replace(/\D/g, '') || '48';
    const response = await api.get<{ predictions: PredictionItem[] }>(`/api/predictions?limit=${limit}`);
    setPredictions(response.predictions);
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
    try {
      const response = await api.postJson<{ deleted: string[] }>('/api/predictions/delete', {
        paths: selectedPredictionPaths,
      });
      setPredictionMessage(`已删除 ${response.deleted.length} 条预测结果。`);
      setSelectedPredictionPaths([]);
      await refreshPredictions();
    } catch (error) {
      setPredictionMessage(error instanceof Error ? error.message : '删除预测结果失败');
    }
  }

  async function refreshPredictionTasks() {
    try {
      const response = await api.get<{ tasks: PredictionTask[] }>('/api/predictions/tasks');
      setPredictionTasks(response.tasks);
    } catch {
      // 队列状态轮询失败可暂时忽略，下次刷新会重试
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
      refreshPredictions(),
      refreshTaskHistory(),
      refreshPredictionTasks(),
    ]);
  }

  async function loadManagedImages(split: Split, page: number) {
    try {
      const response = await api.get<DatasetImagePage>(
        `/api/dataset/images?profile=${datasetProfile}&split=${split}&page=${page}&page_size=60&label=${photoLabelFilter}`
      );
      setManagedImages(response.images);
      setPhotoTotal(response.total);
      setPhotoPage(response.page);
      setPhotoPageCount(response.pageCount);
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : '读取训练图片失败');
    }
  }

  async function loadAnnotationImages(split: Split, page: number, label: 'all' | 'labeled' | 'unlabeled' = 'all', force = false) {
    const cache = annotationCache.current;
    if (force || cache.profile !== annotateProfile || cache.split !== split || cache.label !== label) {
      cache.profile = annotateProfile;
      cache.split = split;
      cache.label = label;
      cache.pages.clear();
    }
    const cached = cache.pages.get(page);
    try {
      let images = cached;
      if (!images) {
        const response = await api.get<AnnotationImagePage>(
          `/api/dataset/images?profile=${annotateProfile}&split=${split}&page=${page}&page_size=60&label=${label}`
        );
        images = response.images;
        cache.pages.set(page, images);
        setAnnotationClasses(response.classes);
        if (!response.classes.some((item) => item.id === selectedClassId)) {
          setSelectedClassId(response.classes[0]?.id ?? 0);
        }
        setAnnotationTotal(response.total);
        setAnnotationPageCount(response.pageCount);
        setAnnotationPage(response.page);
        const sameContext = Boolean(
          selectedImage && selectedImage.profile === annotateProfile && selectedImage.split === split
        );
        const match = selectedImage ? images.find((item) => item.name === selectedImage.name) : null;
        const next = match || (sameContext && selectedImage ? selectedImage : images[0] || null);
        setSelectedImage(next);
        setSelectedBoxIndex(null);
        if (match || !sameContext) setAnnotationBoxes(next?.boxes || []);
      }
      setAnnotationImages(images);
    } catch (error) {
      setAnnotationMessage(error instanceof Error ? error.message : '读取标注图片失败');
    }
  }

  async function runTask(endpoint: string) {
    setBusy(true);
    try {
      await api.postJson(endpoint, { profile: datasetProfile });
      await refreshAll();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '任务启动失败');
    } finally {
      setBusy(false);
    }
  }

  async function stopTask() {
    await api.post('/api/tasks/stop');
    await refreshAll();
  }

  async function uploadDataset(form: FormData, setMessage: (value: string) => void) {
    setMessage('正在导入...');
    try {
      const response = await api.post<{ savedImages: unknown[]; savedLabels: unknown[] }>('/api/dataset/upload', form);
      setMessage(`导入完成：${response.savedImages.length} 张图片，${response.savedLabels.length} 个标签文件。`);
      await refreshStatus();
      await loadManagedImages(photoSplit, photoPage);
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
      await refreshStatus();
      await loadManagedImages(photoSplit, photoPage);
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
      await refreshStatus();
      await loadManagedImages(photoSplit, photoPage);
      await loadAnnotationImages(annotateSplit, annotationPage, annotationLabelFilter, true);
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : '批量删除失败');
    }
  }

  async function saveAnnotation() {
    if (!selectedImage) return;
    setAnnotationMessage('正在保存标注...');
    try {
      const response = await api.postJson<{ image: DatasetImage }>('/api/dataset/labels', {
        profile: selectedImage.profile,
        split: selectedImage.split,
        filename: selectedImage.name,
        boxes: annotationBoxes.map((box) => ({
          class_id: box.classId,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        })),
      });
      const updated = response.image;
      setSelectedImage(updated);
      setAnnotationBoxes(updated.boxes);
      const saveMessage = `已保存 ${updated.labelCount} 个标注框。`;
      setAnnotationMessage(saveMessage);
      setSaveDialog({ kind: 'success', message: saveMessage });
      updateCachedAnnotationImage(updated);
      setSelectedBoxIndex(null);
      await refreshStatus();
      if (annotationLabelFilter === 'unlabeled' && updated.hasLabel) {
        await loadAnnotationImages(annotateSplit, annotationPage, annotationLabelFilter, true);
      }
    } catch (error) {
      const saveMessage = error instanceof Error ? error.message : '保存标注失败';
      setAnnotationMessage(saveMessage);
      setSaveDialog({ kind: 'error', message: `保存失败：${saveMessage}` });
    }
  }

  function updateCachedAnnotationImage(updated: DatasetImage) {
    const cache = annotationCache.current;
    for (const [page, images] of cache.pages) {
      const index = images.findIndex(
        (item) => item.name === updated.name && item.split === updated.split
      );
      if (index >= 0) {
        const next = [...images];
        next[index] = updated;
        cache.pages.set(page, next);
      }
    }
    setAnnotationImages((current) =>
      current.map((item) =>
        item.name === updated.name && item.split === updated.split ? updated : item
      )
    );
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
      if (task.status === 'completed' || task.status === 'failed') {
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
    try {
      const response = await api.get<{ models: ImportedModelInfo[] }>('/api/models/imported');
      setImportedModels(response.models);
    } catch (error) {
      setPredictionMessage(error instanceof Error ? error.message : '读取导入模型失败');
    }
  }

  async function handleImportModelChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportingModel(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await api.post<{ model: ImportedModelInfo }>('/api/models/import', form);
      await loadImportedModels();
      setSelectedModel('imported:' + response.model.filename);
      setPredictionMessage('已导入模型「' + response.model.name + '」，已选中用于测试。');
    } catch (error) {
      setPredictionMessage(error instanceof Error ? error.message : '导入模型失败');
    } finally {
      setImportingModel(false);
      event.target.value = '';
    }
  }

  async function removeImportedModel(model: ImportedModelInfo) {
    if (!window.confirm('确定删除导入的模型「' + model.name + '」吗？')) return;
    try {
      await api.remove('/api/models/imported/' + encodeURIComponent(model.filename));
      if (selectedModel === 'imported:' + model.filename) setSelectedModel('');
      await loadImportedModels();
      setPredictionMessage('已删除导入模型「' + model.name + '」。');
    } catch (error) {
      setPredictionMessage(error instanceof Error ? error.message : '删除模型失败');
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
          <label className="sidebar-profile">
            <span>全局数据集配置</span>
            <select value={datasetProfile} onChange={(event) => setDatasetProfile(event.target.value)}>
              {profileOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.title}（{profile.id}）
                </option>
              ))}
            </select>
          </label>
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
              <div className="panel-head">
                <div>
                  <h2>当前数据集配置</h2>
                  <p className="annotation-help">导入、训练、预测默认使用这里选中的配置；在线标注可以在页面内单独切换。</p>
                </div>
                <span className="pill">{datasetProfile}</span>
              </div>
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

            <section className="panel">
              <div className="panel-head">
                <h2>运行环境</h2>
                <span className="pill">{status?.python ?? '加载中'}</span>
              </div>
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
              <div className="panel-head">
                <h2>数据集状态</h2>
                <span className="pill">{dataset?.ready ? '可开始训练' : '尚未满足训练条件'}</span>
              </div>
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
              <div className="panel-head">
                <div>
                  <h2>正在管理：{currentProfile?.title || datasetProfile}</h2>
                  <p className="annotation-help">上传的图片和标签会进入此配置对应的数据集目录。</p>
                </div>
                <span className="pill">{datasetProfile}</span>
              </div>
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
              <div className="panel-head">
                <h2>导入训练数据</h2>
                <span className="pill">YOLO 格式</span>
              </div>
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
              <div className="panel-head">
                <h2>数据集检查</h2>
                <button type="button" className="btn" disabled={busy} onClick={() => void runTask('/api/tasks/check')}>
                  <ListChecks size={16} />
                  检查数据集
                </button>
              </div>
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
              <div className="panel-head">
                <h2>训练图片管理</h2>
                <div className="inline-controls">
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
                  <button type="button" className="btn" onClick={() => void loadManagedImages(photoSplit, photoPage)}>
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
                </div>
              </div>

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
              <div className="panel-head">
                <h2>{splitName(photoSplit)}</h2>
                <span className="pill">{photoTotal} 张图片</span>
<label className="switch">
                    <input
                      type="checkbox"
                      checked={managedImages.length > 0 && managedImages.every((item) => selectedPhotoNames.includes(item.name))}
                      onChange={toggleSelectAllPhotos}
                    />
                    全选本页
                  </label>
              </div>
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
                      <img src={image.url} alt={image.name} />
                      <div className="photo-card-body">
                        <strong>{image.name}</strong>
                        <span>{image.hasLabel ? `已标注 ${image.labelCount} 个框` : '未标注'}</span>
                        <div className="photo-card-actions">
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setAnnotateSplit(image.split);
                              setSelectedImage(image);
                              setAnnotationBoxes(image.boxes);
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
          <section className="annotation-layout">
            <aside className="annotation-sidebar panel">
              <div className="panel-head">
                <h2>待标注图片</h2>
                <span className="pill">{annotationTotal} 张</span>
              </div>
              <select value={annotateSplit} onChange={(event) => { setAnnotationPage(1); setAnnotateSplit(event.target.value as Split); }}>
                <option value="train">训练集 train</option>
                <option value="val">验证集 val</option>
                <option value="test">测试集 test</option>
              </select>
              <select value={annotateProfile} onChange={(event) => { setAnnotationPage(1); setAnnotateProfile(event.target.value); }}>
                {profileOptions.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.title}（{profile.id}）
                  </option>
                ))}
              </select>
              <select
                value={annotationLabelFilter}
                onChange={(event) => {
                  setAnnotationPage(1);
                  setAnnotationLabelFilter(event.target.value as 'all' | 'labeled' | 'unlabeled');
                }}
              >
                <option value="all">全部图片</option>
                <option value="unlabeled">未标注</option>
                <option value="labeled">已标注</option>
              </select>
              <div className="annotation-image-list">
                {annotationImages.map((image) => (
                  <button
                    type="button"
                    key={`${image.split}-${image.name}`}
                    className={selectedImage?.name === image.name ? 'annotation-image active' : 'annotation-image'}
                    onClick={() => {
                      setSelectedImage(image);
                      setAnnotationBoxes(image.boxes);
                      setSelectedBoxIndex(null);
                      setAnnotationMessage('');
                    }}
                  >
                    <img src={image.url} alt={image.name} />
                    <span>
                      <strong>{image.name}</strong>
                      <small>{image.hasLabel ? `${image.labelCount} 个框` : '未标注'}</small>
                    </span>
                  </button>
                ))}
              </div>
              <Pagination page={annotationPage} pageCount={annotationPageCount} onChange={setAnnotationPage} />
            </aside>

            <section className="annotation-workspace panel">
              <div className="annotation-toolbar">
                <div className="annotation-title">
                  <h2>{selectedImage?.name || '在线标注'}</h2>
                  {selectedImage ? <span className="pill">{annotationBoxes.length} 个框</span> : null}
                </div>
                <div className="annotation-controls">
                  <label className="class-picker">
                    <span>当前类别</span>
                    <select value={selectedClassId} onChange={(event) => setSelectedClassId(Number(event.target.value))}>
                      {annotationClasses.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn"
                    disabled={!annotationBoxes.length}
                    onClick={() => {
                      setAnnotationBoxes((current) => current.slice(0, -1));
                      setSelectedBoxIndex(null);
                    }}
                  >
                    撤销最后一个框
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={!annotationBoxes.length}
                    onClick={() => {
                      setAnnotationBoxes([]);
                      setSelectedBoxIndex(null);
                    }}
                  >
                    清空框选
                  </button>
                  <button type="button" className="primary" disabled={!selectedImage} onClick={() => void saveAnnotation()}>
                    <Save size={16} />
                    保存标注
                  </button>
                </div>
              </div>

              <AnnotationCanvas
                image={selectedImage}
                boxes={annotationBoxes}
                classes={annotationClasses}
                selectedClassId={selectedClassId}
                selectedIndex={selectedBoxIndex}
                onSelectIndex={setSelectedBoxIndex}
                onChange={setAnnotationBoxes}
              />
              <p className="help">{annotationMessage || `当前共 ${annotationBoxes.length} 个标注框。点击已标注框可拖动微调，选中后用方向键微调，Enter 保存。`}</p>

              <div className="box-list">
                {annotationBoxes.length ? (
                  annotationBoxes.map((box, index) => (
                    <div
                      className={selectedBoxIndex === index ? 'box-row active' : 'box-row'}
                      key={`${box.x}-${box.y}-${index}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedBoxIndex(index)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedBoxIndex(index);
                        }
                      }}
                    >
                      <span>{annotationClasses.find((item) => item.id === box.classId)?.displayName || `类别 ${box.classId}`} #{index + 1}</span>
                      <span>中心 ({box.x.toFixed(3)}, {box.y.toFixed(3)})</span>
                      <span>大小 ({box.width.toFixed(3)}, {box.height.toFixed(3)})</span>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`删除标注框 ${index + 1}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setAnnotationBoxes((current) => current.filter((_, i) => i !== index));
                          setSelectedBoxIndex(null);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty">还没有框选。请在图片上按住鼠标左键拖动，框住每个目标；点击已标注框可拖动微调。</div>
                )}
              </div>
            </section>
          </section>
        ) : null}

        {menu === 'training' ? (
          <section className="page-stack">
            <section className="panel">
              <div className="panel-head">
                <h2>训练任务</h2>
                <span className={running ? 'pill live' : 'pill'}>{taskState(task?.status)}</span>
              </div>
              <div className="action-grid">
                <button type="button" className="primary" disabled={busy || running} onClick={() => void runTask('/api/tasks/train-smoke')}>
                  <Play size={16} />
                  CPU 快速试训
                </button>
                <button type="button" className="btn" disabled={busy || running} onClick={() => void runTask('/api/tasks/train-full')}>
                  <Play size={16} />
                  开始正式训练
                </button>
                <button type="button" className="btn danger" disabled={!running} onClick={() => void stopTask()}>
                  <X size={16} />
                  停止当前任务
                </button>
              </div>
              <p className="help">快速试训使用较小图片尺寸并只跑 5 轮，适合先验证数据和训练链路。当前机器未检测到 CUDA，因此使用 CPU 训练。</p>
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
              </div>
            </section>
          </section>
        ) : null}

        {menu === 'prediction' ? (
          <section className="page-stack">
            <section className="panel">
              <div className="panel-head">
                <h2>预测调试</h2>
                <span className="pill">{predictions.length} 个输出结果</span>
              </div>
              <form
                className="prediction-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const input = (event.currentTarget.elements.namedItem('file') as HTMLInputElement).files;
                  if (!input?.length) return;
                  const form = new FormData();
                  form.append('file', input[0]);
                  form.append('conf', confidence);
                  form.append('profile', datasetProfile);
                  form.append('model', selectedModel);
                  void predict(form);
                  event.currentTarget.reset();
                  if (localFileUrl) URL.revokeObjectURL(localFileUrl);
                  setLocalFileUrl(null);
                }}
              >
                <label>
                  选择测试图片
                  <input name="file" type="file" accept="image/*" onChange={handlePredictionFileChange} />
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
                      <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
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
                      <input
                        type="file"
                        accept=".pt"
                        style={{ display: 'none' }}
                        onChange={(event) => void handleImportModelChange(event)}
                      />
                    </label>
                  </div>
                  {importedModels.length ? (
                    <div className="imported-model-list">
                      {importedModels.map((model) => (
                        <span key={model.filename} className={'imported-model-chip' + (selectedModel === 'imported:' + model.filename ? ' active' : '')}>
                          {model.name}（{(model.size / 1024 / 1024).toFixed(1)} MB）
                          <button
                            type="button"
                            className="icon-btn"
                            title="删除导入的模型"
                            onClick={() => void removeImportedModel(model)}
                          >
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
                    <input value={confidence} onChange={(event) => setConfidence(event.target.value)} type="number" min="0.01" max="0.99" step="0.01" />
                  </label>
                  <button type="submit" className="primary" disabled={predicting}>
                    <FileImage size={16} />
                    {predicting ? '已提交，排队中...' : '开始预测'}
                  </button>
                </div>
              </form>
              <p className="help">{predictionMessage || '优先使用当前数据集配置对应的 best.pt；如果还没有训练模型，则使用 yolo11n.pt 预训练模型并明确提示。'}</p>
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
                        onChange={toggleSelectAllPredictions}
                      />
                      全选
                    </label>
                    <label className="inline-field">
                      数量上限
                      <input
                        type="number"
                        min="1"
                        max="200"
                        value={predictionLimit}
                        onChange={(event) => setPredictionLimit(event.target.value)}
                      />
                    </label>
                    <button type="button" className="btn" onClick={() => void refreshPredictions()}>
                      <RefreshCw size={16} />
                      刷新结果
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      disabled={!selectedPredictionPaths.length}
                      onClick={() => void deleteSelectedPredictions()}
                    >
                      <Trash2 size={16} />
                      删除{selectedPredictionPaths.length ? ` (${selectedPredictionPaths.length})` : ''}
                    </button>
                  </div>
                </div>
                {predictions.length ? (
                  <div className="prediction-grid">
                    {predictions.map((item) => (
                      <article
                        key={item.path}
                        className={selectedPredictionPaths.includes(item.path) ? 'prediction-card selected' : 'prediction-card'}
                      >
                        <label className="prediction-card-select">
                          <input
                            type="checkbox"
                            checked={selectedPredictionPaths.includes(item.path)}
                            onChange={() => togglePredictionSelection(item.path)}
                          />
                          <span>选择</span>
                        </label>
                        <img
                          src={item.url}
                          alt={item.name}
                          onClick={() => setPreviewPredictionUrl(item.url)}
                        />
                        <div className="prediction-card-body">
                          <strong>{item.name}</strong>
                          <span>{formatTime(item.mtime)}</span>
                          <button type="button" className="btn" onClick={() => setPreviewPredictionUrl(item.url)}>
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

            <section className="panel">
              <div className="panel-head">
                <h2>推理队列</h2>
                <span className="pill">{predictionTasks.length} 个任务</span>
                <button type="button" className="btn" onClick={() => void refreshPredictionTasks()}>
                  <RefreshCw size={16} />
                  刷新队列
                </button>
              </div>
              {predictionTasks.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>状态</th>
                      <th>配置</th>
                      <th>模型来源</th>
                      <th>说明</th>
                      <th>提交时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {predictionTasks.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <span
                            className={`pill ${
                              item.status === 'running' ? 'live' : item.status === 'failed' ? 'danger' : ''
                            }`}
                          >
                            {predictionStatusName(item.status)}
                          </span>
                        </td>
                        <td>{profileOptions.find((option) => option.id === item.profile)?.title || item.profile}</td>
                        <td>
                          {modelSourceName(item.modelSource)}
                        </td>
                        <td className="command-cell">{predictionTaskMessage(item)}</td>
                        <td>{formatTime(item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty">当前没有推理任务。</div>
              )}
            </section>

          </section>
        ) : null}


        {menu === 'profiles' ? (
          <section className="page-stack">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>数据集配置管理</h2>
                  <p className="annotation-help">管理 YOLO 数据集配置（新增 / 修改 / 删除），并可查看每个配置已训练好的模型。</p>
                </div>
                <button type="button" className="primary" onClick={openCreateForm}>
                  <Plus size={16} />
                  新增配置
                </button>
              </div>
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
              <div className="panel-head">
                <h2>任务日志</h2>
                <label className="switch">
                  <input type="checkbox" checked={logAuto} onChange={(event) => setLogAuto(event.target.checked)} />
                  <span>自动刷新</span>
                </label>
              </div>
              <pre className="log-box">{log?.log || '当前没有任务日志。'}</pre>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>当前任务</h2>
                <button type="button" className="btn" onClick={() => void refreshLog()}>
                  <RefreshCw size={16} />
                  刷新日志
                </button>
              </div>
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
              <div className="panel-head">
                <h2>任务历史</h2>
                <span className="pill">{taskHistory.length} 条</span>
                <button type="button" className="btn" onClick={() => void refreshTaskHistory()}>
                  <RefreshCw size={16} />
                  刷新历史
                </button>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>任务类型</th>
                    <th>状态</th>
                    <th>开始时间</th>
                    <th>完成时间</th>
                    <th>退出代码</th>
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
                      <td colSpan={7}>暂无历史任务。</td>
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
