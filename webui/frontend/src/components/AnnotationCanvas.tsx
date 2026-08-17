import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Box, ClassItem, DatasetImage } from '../types';

export function AnnotationCanvas({
  image,
  boxes,
  classes,
  selectedClassId,
  onChange,
}: {
  image: DatasetImage | null;
  boxes: Box[];
  classes: ClassItem[];
  selectedClassId: number;
  onChange: (boxes: Box[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
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
      ctx.strokeStyle = '#27c5f3';
      ctx.fillStyle = 'rgb(39 197 243 / 0.18)';
      ctx.strokeRect(left, top, width, height);
      ctx.fillRect(left, top, width, height);
      ctx.fillStyle = '#052431';
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
  }, [boxes, classes, draft]);

  useEffect(() => {
    imageRef.current = null;
    setLoaded(false);
    setLoadError('');
    setDraft(null);
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

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!imageRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    dragStart.current = point;
    setDraft({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dragStart.current) return;
    const point = pointFromEvent(event);
    setDraft((current) => (current ? { ...current, x2: point.x, y2: point.y } : current));
  }

  function finishBox(event: ReactPointerEvent<HTMLCanvasElement>) {
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
          setDraft(null);
        }}
      />
    </div>
  );
}
