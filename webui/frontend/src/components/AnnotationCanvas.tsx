import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Box, ClassItem, DatasetImage } from '../types';

export function AnnotationCanvas({
  image,
  boxes,
  classes,
  selectedClassId,
  selectedIndex,
  onSelectIndex,
  onChange,
  onPreviewChange,
  onChangeStart,
  onChangeCancel,
}: {
  image: DatasetImage | null;
  boxes: Box[];
  classes: ClassItem[];
  selectedClassId: number;
  selectedIndex: number | null;
  onSelectIndex: (index: number | null) => void;
  onChange: (boxes: Box[]) => void;
  onPreviewChange?: (boxes: Box[]) => void;
  onChangeStart?: () => void;
  onChangeCancel?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const moving = useRef<{ index: number; offsetX: number; offsetY: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const bitmap = imageRef.current;
    if (!canvas || !bitmap) return;

    canvas.width = bitmap.naturalWidth;
    canvas.height = bitmap.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    ctx.lineWidth = Math.max(2, Math.round(canvas.width / 420));
    ctx.font = `${Math.max(14, Math.round(canvas.width / 45))}px Segoe UI`;

    boxes.forEach((box, index) => {
      const left = (box.x - box.width / 2) * canvas.width;
      const top = (box.y - box.height / 2) * canvas.height;
      const width = box.width * canvas.width;
      const height = box.height * canvas.height;
      const selected = index === selectedIndex;
      ctx.strokeStyle = selected ? '#f3b83d' : '#27c5f3';
      ctx.fillStyle = selected ? 'rgb(243 184 61 / 0.22)' : 'rgb(39 197 243 / 0.18)';
      ctx.strokeRect(left, top, width, height);
      ctx.fillRect(left, top, width, height);
      if (selected) {
        ctx.lineWidth = Math.max(3, Math.round(canvas.width / 300));
        ctx.strokeRect(left, top, width, height);
        ctx.lineWidth = Math.max(2, Math.round(canvas.width / 420));
      }
      ctx.fillStyle = selected ? '#3d2b00' : '#052431';
      ctx.fillRect(left, Math.max(0, top - 28), 72, 25);
      ctx.fillStyle = '#ffffff';
      const className = classes.find((item) => item.id === box.classId)?.displayName || `类别 ${box.classId}`;
      ctx.fillText(`${className} #${index + 1}`, left + 6, Math.max(18, top - 10));
    });

    if (draft) {
      const left = Math.min(draft.x1, draft.x2);
      const top = Math.min(draft.y1, draft.y2);
      const width = Math.abs(draft.x2 - draft.x1);
      const height = Math.abs(draft.y2 - draft.y1);
      ctx.setLineDash([10, 7]);
      ctx.strokeStyle = '#f3b83d';
      ctx.strokeRect(left, top, width, height);
      ctx.setLineDash([]);
    }
  }, [boxes, classes, draft, selectedIndex]);

  useEffect(() => {
    imageRef.current = null;
    setLoaded(false);
    setLoadError('');
    setDraft(null);
    dragStart.current = null;
    moving.current = null;
    if (!image) return;

    const bitmap = new Image();
    bitmap.onload = () => {
      imageRef.current = bitmap;
      setLoaded(true);
    };
    bitmap.onerror = () => {
      imageRef.current = null;
      setLoadError('图片加载失败，请检查文件是否存在或重新导入。');
    };
    bitmap.src = image.url;
  }, [image?.url]);

  useEffect(() => {
    if (loaded) draw();
  }, [draw, loaded]);

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function pointInBox(point: { x: number; y: number }, box: Box, width: number, height: number) {
    const left = (box.x - box.width / 2) * width;
    const top = (box.y - box.height / 2) * height;
    const right = (box.x + box.width / 2) * width;
    const bottom = (box.y + box.height / 2) * height;
    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!imageRef.current) return;
    const canvas = event.currentTarget;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);

    for (let i = boxes.length - 1; i >= 0; i--) {
      if (pointInBox(point, boxes[i], canvas.width, canvas.height)) {
        onSelectIndex(i);
        const box = boxes[i];
        moving.current = {
          index: i,
          offsetX: point.x - box.x * canvas.width,
          offsetY: point.y - box.y * canvas.height,
        };
        onChangeStart?.();
        return;
      }
    }

    onSelectIndex(null);
    dragStart.current = point;
    setDraft({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (moving.current) {
      const canvas = event.currentTarget;
      const point = pointFromEvent(event);
      const { index, offsetX, offsetY } = moving.current;
      const box = boxes[index];
      if (!box) {
        moving.current = null;
        return;
      }
      const halfWidth = box.width / 2;
      const halfHeight = box.height / 2;
      const nextX = Math.min(1 - halfWidth, Math.max(halfWidth, (point.x - offsetX) / canvas.width));
      const nextY = Math.min(1 - halfHeight, Math.max(halfHeight, (point.y - offsetY) / canvas.height));
      const next = [...boxes];
      next[index] = {
        ...box,
        x: Number(nextX.toFixed(6)),
        y: Number(nextY.toFixed(6)),
      };
      onPreviewChange?.(next);
      return;
    }
    if (!dragStart.current) return;
    const point = pointFromEvent(event);
    setDraft((current) => (current ? { ...current, x2: point.x, y2: point.y } : current));
  }

  function finishBox(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (moving.current) {
      const canvas = event.currentTarget;
      const point = pointFromEvent(event);
      const { index, offsetX, offsetY } = moving.current;
      const box = boxes[index];
      moving.current = null;
      if (box) {
        const halfWidth = box.width / 2;
        const halfHeight = box.height / 2;
        const next = [...boxes];
        next[index] = {
          ...box,
          x: Number(Math.min(1 - halfWidth, Math.max(halfWidth, (point.x - offsetX) / canvas.width)).toFixed(6)),
          y: Number(Math.min(1 - halfHeight, Math.max(halfHeight, (point.y - offsetY) / canvas.height)).toFixed(6)),
        };
        onChange(next);
      }
      return;
    }
    const start = dragStart.current;
    const canvas = event.currentTarget;
    if (!start || !canvas.width || !canvas.height) return;

    const end = pointFromEvent(event);
    dragStart.current = null;
    setDraft(null);

    const left = Math.max(0, Math.min(start.x, end.x));
    const top = Math.max(0, Math.min(start.y, end.y));
    const width = Math.min(canvas.width - left, Math.abs(end.x - start.x));
    const height = Math.min(canvas.height - top, Math.abs(end.y - start.y));
    if (width < 8 || height < 8) return;

    onChange([
      ...boxes,
      {
        classId: selectedClassId,
        x: Number(((left + width / 2) / canvas.width).toFixed(6)),
        y: Number(((top + height / 2) / canvas.height).toFixed(6)),
        width: Number((width / canvas.width).toFixed(6)),
        height: Number((height / canvas.height).toFixed(6)),
      },
    ]);
  }

  if (!image) {
    return <div className="annotation-empty">请先从左侧图片列表选择一张训练图片。</div>;
  }

  if (loadError) {
    return <div className="annotation-empty">{loadError}</div>;
  }

  return (
    <div className="annotation-canvas-wrap">
      {!loaded ? <div className="annotation-empty">图片加载中...</div> : null}
      <canvas
        ref={canvasRef}
        className="annotation-canvas"
        aria-label={`标注图片 ${image.name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishBox}
        onPointerCancel={() => {
          dragStart.current = null;
          moving.current = null;
          setDraft(null);
          onChangeCancel?.();
        }}
      />
    </div>
  );
}
