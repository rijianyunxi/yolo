import { useEffect, useRef, useState } from 'react';
import type { DatasetImage } from '../types';

type Props = {
  images: DatasetImage[];
  selectedName?: string;
  onSelect: (image: DatasetImage) => void;
};

// 固定行高使列表可以只渲染可视区域；分页仍由后端负责控制总数据量。
const ITEM_HEIGHT = 78;
const OVERSCAN = 4;

export function VirtualImageList({ images, selectedName, onSelect }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(420);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const updateHeight = () => setViewportHeight(element.clientHeight || 420);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedName) return;
    const index = images.findIndex((image) => image.name === selectedName);
    const element = viewportRef.current;
    if (index < 0 || !element) return;
    const top = index * ITEM_HEIGHT;
    const bottom = top + ITEM_HEIGHT;
    if (top < element.scrollTop) element.scrollTo({ top, behavior: 'auto' });
    else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTo({ top: bottom - element.clientHeight, behavior: 'auto' });
    }
  }, [images, selectedName]);

  const first = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ITEM_HEIGHT) + OVERSCAN * 2;
  const last = Math.min(images.length, first + visibleCount);

  return (
    <div
      ref={viewportRef}
      className="annotation-image-list"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="virtual-image-list-spacer" style={{ height: images.length * ITEM_HEIGHT }}>
        <div className="virtual-image-list-window" style={{ transform: `translateY(${first * ITEM_HEIGHT}px)` }}>
          {images.slice(first, last).map((image) => (
            <button
              type="button"
              key={`${image.split}-${image.name}`}
              className={selectedName === image.name ? 'annotation-image active' : 'annotation-image'}
              onClick={() => onSelect(image)}
            >
              <img src={image.thumbnailUrl || image.url} alt={image.name} loading="lazy" />
              <span>
                <strong>{image.name}</strong>
                <small>{image.hasLabel ? `${image.labelCount} 个框` : '未标注'}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
