export type Split = 'train' | 'val' | 'test';
export type MenuKey =
  | 'overview'
  | 'dataset'
  | 'photos'
  | 'annotate'
  | 'training'
  | 'prediction'
  | 'profiles'
  | 'logs';

export type Box = {
  classId: number;
  x: number;
  y: number;
  width: number;
  height: number;
};


export type TrainingMetricPoint = {
  epoch: number;
  loss: { box: number | null; cls: number | null; dfl: number | null; total: number | null };
  precision: number | null;
  recall: number | null;
  mAP50: number | null;
  mAP50_95: number | null;
};

export type TrainingMetrics = {
  runDir: string;
  epochs: number;
  current: TrainingMetricPoint;
  best: TrainingMetricPoint;
  recent: TrainingMetricPoint[];
};

export type ResourceSnapshot = {
  checkedAt: number;
  ready: boolean;
  disk: { totalBytes: number; freeBytes: number; usedBytes: number };
  memory: { totalBytes: number; availableBytes: number; percent: number };
  cpu: { count: number; loadPercent: number };
  gpu: { available: boolean; device?: string; freeBytes?: number; totalBytes?: number; error?: string } | null;
  warnings: string[];
  blocking: string[];
};

export type Task = {
  id: string;
  schemaVersion?: number;
  kind: string;
  profile?: string | null;
  params?: Record<string, unknown>;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  returncode: number | null;
  command: string[];
  metrics?: TrainingMetrics | null;
  resultDir?: string | null;
  runDir?: string | null;
  parentTaskId?: string | null;
  cancelReason?: string | null;
  lastHeartbeatAt?: number | null;
  pid?: number | null;
};

export type DatasetSplit = {
  images: number;
  labels: number;
  missingLabels: string[];
  orphanLabels: string[];
  missingLabelCount: number;
  orphanLabelCount: number;
};

export type Status = {
  profile: string;
  profiles: Array<{ id: string; title: string }>;
  classes: Array<{ id: number; name: string; displayName: string }>;
  projectDir: string;
  python: string;
  platform: string;
  cpu: string;
  torch: string;
  cuda: boolean;
  cudaDevice: string | null;
  ultralytics: string;
  opencv: string;
  nvidiaSmi: string | null;
  pretrained: string | null;
  bestModel: string | null;
  dataset: {
    splits: Record<Split, DatasetSplit>;
    totalImages: number;
    totalLabels: number;
    ready: boolean;
  };
  task: Task | null;
};


export type DatasetCheckIssue = {
  severity: 'blocking' | 'warning';
  code: string;
  split: string | null;
  filename: string | null;
  line: number | null;
  message: string;
};

export type DatasetCheckReport = {
  profile: string;
  root: string;
  checkedAt: number;
  ready: boolean;
  blockingCount: number;
  warningCount: number;
  totalImages: number;
  totalLabels: number;
  splits: Record<Split, { images: number; labels: number; missingLabelCount: number; orphanLabelCount: number; issues: DatasetCheckIssue[] }>;
  issues: DatasetCheckIssue[];
  classDistribution: Record<string, number>;
};

export type LogPayload = {
  task: Task | null;
  log: string;
};

export type PredictionItem = {
  name: string;
  path: string;
  url: string;
  mtime: number;
  sizeBytes?: number;
  taskId?: string | null;
  profile?: string | null;
  modelSource?: string | null;
  modelSha256?: string | null;
  conf?: number | null;
  createdAt?: number;
  detectionCount?: number | null;
  outputDir?: string | null;
};

export type DatasetImage = {
  name: string;
  stem: string;
  profile: string;
  split: Split;
  url: string;
  thumbnailUrl?: string;
  width: number;
  height: number;
  hasLabel: boolean;
  labelCount: number;
  boxes: Box[];
  mtime: number;
  labelMtime?: number | null;
};

export type DatasetImagePage = {
  images: DatasetImage[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type ClassItem = {
  id: number;
  name: string;
  displayName: string;
};

export type AnnotationImagePage = DatasetImagePage & {
  classes: ClassItem[];
};

export type PredictionStats = {
  count: number;
  totalBytes: number;
  oldestAt: number | null;
  newestAt: number | null;
  taskCount: number;
};

export type PredictionResponse = {
  profile: string;
  model: string;
  modelSource: string;
  detections: Array<{ classId: number; name: string; confidence: number; xyxy: number[] }>;
  images: Array<{ name: string; url: string; path: string }>;
  predictions: PredictionItem[];
};

export type PredictionTask = {
  id: string;
  profile: string;
  status: 'queued' | 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  message: string;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  model: string | null;
  modelSource: string | null;
  modelSelector: string;
  cancelRequested: boolean;
  cancelReason: string | null;
  originalFilename: string | null;
  inputSha256: string | null;
  inputSize: number | null;
  modelSha256: string | null;
  parentTaskId: string | null;
  conf: number;
  detections: Array<{ classId: number; name: string; confidence: number; xyxy: number[] }>;
  images: Array<{ name: string; url: string; path: string }>;
  predictions?: PredictionItem[];
};

export type HistoryLog = {
  taskId: string;
  log: string;
};

export type ProfileClassInput = {
  name: string;
  displayName: string;
};

export type ProfileInfo = {
  id: string;
  title: string;
  configPath: string;
  classes: Array<{ id: number; name: string; displayName: string }>;
  classCount: number;
  totalImages: number;
  totalLabels: number;
  ready: boolean;
  bestModel: string | null;
};

export type TrainedModel = {
  path: string;
  name: string;
  mtime: number;
  size: number;
  url: string;
};

export type ImportedModelInfo = {
  filename: string;
  name: string;
  path: string;
  size: number;
  mtime: number;
  url: string;
  sha256?: string | null;
  task?: string | null;
  classCount?: number | null;
  classes?: Record<string, string>;
};
