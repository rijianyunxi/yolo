import { useEffect, useRef, useState, type MutableRefObject } from 'react';

import type {
  AnnotationImagePage,
  DatasetImage,
  DatasetImagePage,
  Split,
} from '../types';
import { api } from '../api';
import { TtlLruCache } from '../utils/ttlCache';

export type PhotoLabelFilter = 'all' | 'labeled' | 'unlabeled';

export interface DatasetImagePagesOptions {
  datasetProfile: string;
  annotateProfile: string;
  photosActive: boolean;
  annotationsActive: boolean;
  photoSplit: Split;
  annotateSplit: Split;
  photoLabelFilter: PhotoLabelFilter;
  annotationLabelFilter: PhotoLabelFilter;
  managedImagesCache: MutableRefObject<TtlLruCache<string, DatasetImagePage>>;
  annotationCache: MutableRefObject<TtlLruCache<string, AnnotationImagePage>>;
  refreshCacheStats: () => void;
  onAnnotationPageLoaded?: (response: AnnotationImagePage) => void;
  onAnnotationLoadError?: () => void;
  setPhotoMessage: (value: string) => void;
}

function imagePageCacheKey(profile: string, split: Split, label: PhotoLabelFilter, page: number) {
  return `${profile}|${split}|${label}|${page}`;
}

/**
 * 数据集图片分页数据层：统一管理照片页/标注页的列表状态、TTL 缓存、
 * 请求序号与 AbortController，避免慢响应覆盖用户刚切换后的条件。
 * profile/split/筛选等 UI 状态仍由调用方持有，通过 options 每次渲染同步。
 */
export function useDatasetImagePages(options: DatasetImagePagesOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [managedImages, setManagedImages] = useState<DatasetImage[]>([]);
  const [photoPage, setPhotoPage] = useState(1);
  const [photoTotal, setPhotoTotal] = useState(0);
  const [photoPageCount, setPhotoPageCount] = useState(0);

  const [annotationImages, setAnnotationImages] = useState<DatasetImage[]>([]);
  const [annotationPage, setAnnotationPage] = useState(1);
  const [annotationTotal, setAnnotationTotal] = useState(0);
  const [annotationPageCount, setAnnotationPageCount] = useState(0);
  const [annotationImagesLoading, setAnnotationImagesLoading] = useState(false);
  const [annotationImagesError, setAnnotationImagesError] = useState('');

  const managedImagesRequestId = useRef(0);
  const annotationImagesRequestId = useRef(0);
  const annotationImagesAbort = useRef<AbortController | null>(null);

  function invalidateImageCaches(profile?: string, split?: Split) {
    const prefix = profile && split ? `${profile}|${split}|` : profile ? `${profile}|` : null;
    for (const cache of [
      optionsRef.current.managedImagesCache.current,
      optionsRef.current.annotationCache.current,
    ]) {
      if (!prefix) {
        cache.clear();
        continue;
      }
      for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
    }
    optionsRef.current.refreshCacheStats();
  }

  async function loadManagedImages(split: Split, page: number, force = false) {
    const current = optionsRef.current;
    current.managedImagesCache.current.prune();
    const requestId = ++managedImagesRequestId.current;
    const profile = current.datasetProfile;
    const label = current.photoLabelFilter;
    const key = imagePageCacheKey(profile, split, label, page);
    let cached: DatasetImagePage | undefined;
    if (!force) {
      cached = current.managedImagesCache.current.peek(key);
    } else {
      current.managedImagesCache.current.delete(key);
    }
    if (cached) {
      setManagedImages(cached.images);
      setPhotoTotal(cached.total);
      setPhotoPage(cached.page);
      setPhotoPageCount(cached.pageCount);
      return;
    }
    const query = new URLSearchParams({
      profile,
      split,
      page: String(page),
      page_size: '60',
      label,
      include_boxes: 'false',
    });
    try {
      const response = await api.get<DatasetImagePage>(`/api/dataset/images?${query.toString()}`);
      if (requestId !== managedImagesRequestId.current || profile !== optionsRef.current.datasetProfile) return;
      optionsRef.current.managedImagesCache.current.set(key, response);
      optionsRef.current.refreshCacheStats();
      setManagedImages(response.images);
      setPhotoTotal(response.total);
      setPhotoPage(response.page);
      setPhotoPageCount(response.pageCount);
    } catch (error) {
      if (requestId !== managedImagesRequestId.current || profile !== optionsRef.current.datasetProfile) return;
      optionsRef.current.setPhotoMessage(error instanceof Error ? error.message : '读取训练图片失败');
    }
  }

  async function loadAnnotationImages(
    split: Split,
    page: number,
    label: PhotoLabelFilter = 'all',
    force = false,
  ): Promise<DatasetImage[]> {
    annotationImagesAbort.current?.abort();
    const controller = new AbortController();
    annotationImagesAbort.current = controller;
    const requestId = ++annotationImagesRequestId.current;
    const current = optionsRef.current;
    const profile = current.annotateProfile;
    current.annotationCache.current.prune();
    const key = imagePageCacheKey(profile, split, label, page);
    let response = force ? undefined : current.annotationCache.current.peek(key);
    if (!response) {
      if (force) current.annotationCache.current.delete(key);
      setAnnotationImagesLoading(true);
      setAnnotationImagesError('');
    }
    try {
      if (!response) {
        const query = new URLSearchParams({ profile, split, page: String(page), page_size: '60', label });
        response = await api.get<AnnotationImagePage>(`/api/dataset/images?${query.toString()}`, controller.signal);
        if (controller.signal.aborted || requestId !== annotationImagesRequestId.current || profile !== optionsRef.current.annotateProfile) return [];
        optionsRef.current.annotationCache.current.set(key, response);
        optionsRef.current.refreshCacheStats();
      }
      if (requestId !== annotationImagesRequestId.current || profile !== optionsRef.current.annotateProfile) return [];
      optionsRef.current.onAnnotationPageLoaded?.(response);
      setAnnotationTotal(response.total);
      setAnnotationPageCount(response.pageCount);
      const images = response.images;
      setAnnotationPage(page);
      setAnnotationImages(images);
      return images;
    } catch (error) {
      if (
        controller.signal.aborted ||
        requestId !== annotationImagesRequestId.current ||
        profile !== optionsRef.current.annotateProfile ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return [];
      }
      setAnnotationImagesError(error instanceof Error ? error.message : '读取标注图片失败');
      optionsRef.current.onAnnotationLoadError?.();
      return [];
    } finally {
      if (requestId === annotationImagesRequestId.current) setAnnotationImagesLoading(false);
    }
  }

  // profile 切换后缓存整体失效
  useEffect(() => {
    invalidateImageCaches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.datasetProfile]);

  useEffect(() => {
    invalidateImageCaches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.annotateProfile, options.annotateSplit, options.annotationLabelFilter]);

  // 切换数据集/分组/筛选后回到第一页
  useEffect(() => {
    setPhotoPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.datasetProfile, options.photoLabelFilter, options.photoSplit]);

  // 照片页：激活时按当前条件加载（含翻页）
  useEffect(() => {
    if (!options.photosActive) return;
    void loadManagedImages(options.photoSplit, photoPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.datasetProfile, options.photosActive, options.photoLabelFilter, photoPage, options.photoSplit]);

  // 标注页：切换分组时回到第一页
  useEffect(() => {
    setAnnotationPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.annotateProfile, options.annotateSplit]);

  // 标注页：激活时按当前条件加载
  useEffect(() => {
    if (!options.annotationsActive) return;
    void loadAnnotationImages(options.annotateSplit, annotationPage, options.annotationLabelFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.annotationsActive, options.annotationLabelFilter, annotationPage, options.annotateSplit]);

  useEffect(() => () => {
    annotationImagesAbort.current?.abort();
  }, []);


  function replaceImage(updated: DatasetImage) {
    const updatePage = <T extends DatasetImagePage | AnnotationImagePage>(page: T): T => ({
      ...page,
      images: page.images.map((item) => item.name === updated.name && item.split === updated.split ? updated : item),
    } as T);
    for (const cache of [optionsRef.current.managedImagesCache.current, optionsRef.current.annotationCache.current]) {
      for (const key of cache.keys()) {
        const page = cache.peek(key);
        if (page && page.images.some((item) => item.name === updated.name && item.split === updated.split)) {
          cache.set(key, updatePage(page));
        }
      }
    }
    optionsRef.current.refreshCacheStats();
    setManagedImages((current) => current.map((item) => item.name === updated.name && item.split === updated.split ? updated : item));
    setAnnotationImages((current) => current.map((item) => item.name === updated.name && item.split === updated.split ? updated : item));
  }

  return {
    managedImages,
    setManagedImages,
    photoPage,
    setPhotoPage,
    photoTotal,
    setPhotoTotal,
    photoPageCount,
    loadManagedImages,
    annotationImages,
    setAnnotationImages,
    annotationPage,
    setAnnotationPage,
    annotationTotal,
    annotationPageCount,
    annotationImagesLoading,
    annotationImagesError,
    setAnnotationImagesError,
    loadAnnotationImages,
    invalidateImageCaches,
    replaceImage,
  };
}

