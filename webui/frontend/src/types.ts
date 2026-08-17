export type Split = 'train' | 'val' | 'test';
export type MenuKey = 'overview' | 'dataset' | 'photos' | 'annotate' | 'training' | 'prediction' | 'logs';

export type Box = {
  classId: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Task = {
  id: string;
  kind: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  returncode: number | null;
  command: string[];
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

export type LogPayload = {
  task: Task | null;
  log: string;
};

export type PredictionItem = {
  name: string;
  path: string;
  url: string;
  mtime: number;
};

export type DatasetImage = {
  name: string;
  stem: string;
  profile: string;
  split: Split;
  url: string;
  width: number;
  height: number;
  hasLabel: boolean;
  labelCount: number;
  boxes: Box[];
  mtime: number;
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

export type PredictionResponse = {
  profile: string;
  model: string;
  modelSource: 'trained' | 'pretrained';
  detections: Array<{ classId: number; name: string; confidence: number; xyxy: number[] }>;
  images: Array<{ name: string; url: string; path: string }>;
  predictions: PredictionItem[];
};

export type PredictionTask = {
  id: string;
  profile: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  message: string;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  model: string | null;
  modelSource: 'trained' | 'pretrained' | null;
  detections: Array<{ classId: number; name: string; confidence: number; xyxy: number[] }>;
  images: Array<{ name: string; url: string; path: string }>;
  predictions?: PredictionItem[];
};

export type HistoryLog = {
  taskId: string;
  log: string;
};
