import { Save, Trash2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import type { Box, ClassItem, DatasetImage, Split } from '../types';
import { AnnotationCanvas } from './AnnotationCanvas';
import { Pagination } from './Pagination';
import { VirtualImageList } from './VirtualImageList';

type LabelFilter = 'all' | 'labeled' | 'unlabeled';

type AnnotationWorkspaceProps = {
  profileOptions: Array<{ id: string; title: string }>;
  annotateProfile: string;
  annotateSplit: Split;
  annotationLabelFilter: LabelFilter;
  annotationImages: DatasetImage[];
  annotationTotal: number;
  annotationPage: number;
  annotationPageCount: number;
  selectedImage: DatasetImage | null;
  annotationBoxes: Box[];
  annotationClasses: ClassItem[];
  selectedClassId: number;
  selectedBoxIndex: number | null;
  annotationMessage: string;
  annotationDirty: boolean;
  savingAnnotation: boolean;
  annotationImagesLoading: boolean;
  annotationImagesError: string;
  annotationStatusLoading: boolean;
  annotationStatusError: string;
  historyPastLength: number;
  historyFutureLength: number;
  onSplitChange: (split: Split) => void;
  onProfileChange: (profile: string) => void;
  onLabelFilterChange: (filter: LabelFilter) => void;
  onSelectImage: (image: DatasetImage) => void;
  onPageChange: (page: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClassChange: (classId: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onRemoveLastBox: () => void;
  onClearBoxes: () => void;
  onSave: () => void;
  onSaveAndNext: () => void;
  onSelectBox: (index: number | null) => void;
  onDeleteBox: (index: number) => void;
  onAnnotationChange: (boxes: Box[]) => void;
  onPreviewChange: (boxes: Box[]) => void;
  onChangeStart: () => void;
  onChangeCancel: () => void;
  onRetryImages: () => void;
  onRetryStatus: () => void;
};

export function AnnotationWorkspace({
  profileOptions,
  annotateProfile,
  annotateSplit,
  annotationLabelFilter,
  annotationImages,
  annotationTotal,
  annotationPage,
  annotationPageCount,
  selectedImage,
  annotationBoxes,
  annotationClasses,
  selectedClassId,
  selectedBoxIndex,
  annotationMessage,
  annotationDirty,
  savingAnnotation,
  annotationImagesLoading,
  annotationImagesError,
  annotationStatusLoading,
  annotationStatusError,
  historyPastLength,
  historyFutureLength,
  onSplitChange,
  onProfileChange,
  onLabelFilterChange,
  onSelectImage,
  onPageChange,
  onPrevious,
  onNext,
  onClassChange,
  onUndo,
  onRedo,
  onRemoveLastBox,
  onClearBoxes,
  onSave,
  onSaveAndNext,
  onSelectBox,
  onDeleteBox,
  onAnnotationChange,
  onPreviewChange,
  onChangeStart,
  onChangeCancel,
  onRetryImages,
  onRetryStatus,
}: AnnotationWorkspaceProps) {
  const selectedIndex = selectedImage ? annotationImages.findIndex((item) => item.name === selectedImage.name) : -1;
  const canPrevious = Boolean(
    selectedImage && selectedIndex >= 0 && (selectedIndex > 0 || annotationPage > 1),
  );
  const canNext = Boolean(
    selectedImage && selectedIndex >= 0 && (selectedIndex < annotationImages.length - 1 || annotationPage < annotationPageCount),
  );

  return (
    <section className="annotation-layout">
      <aside className="annotation-sidebar panel">
        <div className="panel-head">
          <h2>待标注图片</h2>
          <span className="pill">{annotationTotal} 张</span>
        </div>
        <select aria-label="标注数据集分组" value={annotateSplit} onChange={(event) => onSplitChange(event.target.value as Split)}>
          <option value="train">训练集 train</option>
          <option value="val">验证集 val</option>
          <option value="test">测试集 test</option>
        </select>
        <select aria-label="标注数据集配置" value={annotateProfile} onChange={(event) => onProfileChange(event.target.value)}>
          {profileOptions.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.title}（{profile.id}）
            </option>
          ))}
        </select>
        <select aria-label="标注状态筛选" value={annotationLabelFilter} onChange={(event) => onLabelFilterChange(event.target.value as LabelFilter)}>
          <option value="all">全部图片</option>
          <option value="unlabeled">未标注</option>
          <option value="labeled">已标注</option>
        </select>
        {annotationStatusLoading ? <p className="request-state" aria-live="polite">正在刷新数据集统计...</p> : null}
        {annotationStatusError ? (
          <div className="request-state request-error" role="alert">
            <span>统计刷新失败：{annotationStatusError}</span>
            <button type="button" className="btn" onClick={onRetryStatus}>重试</button>
          </div>
        ) : null}
        {annotationImagesLoading ? <p className="request-state" role="status">正在读取图片列表...</p> : null}
        {annotationImagesError ? (
          <div className="request-state request-error" role="alert">
            <span>图片列表读取失败：{annotationImagesError}</span>
            <button type="button" className="btn" onClick={onRetryImages}>重试</button>
          </div>
        ) : null}
        <VirtualImageList images={annotationImages} selectedName={selectedImage?.name} onSelect={onSelectImage} />
        <Pagination page={annotationPage} pageCount={annotationPageCount} onChange={onPageChange} />
      </aside>

      <section className="annotation-workspace panel">
        <div className="annotation-toolbar">
          <div className="annotation-title">
            <h2>{selectedImage?.name || '在线标注'}</h2>
            {selectedImage ? <span className="pill">{annotationBoxes.length} 个框</span> : null}
          </div>
          <div className="annotation-controls">
            <button type="button" className="btn" disabled={!canPrevious} onClick={onPrevious}>上一张</button>
            <button type="button" className="btn" disabled={!canNext} onClick={onNext}>下一张</button>
            {annotationDirty ? <span className="pill danger">未保存</span> : null}
            <span className="muted-text">历史 {Math.max(0, historyPastLength - 1)}/20</span>
            <label className="class-picker">
              <span>当前类别</span>
              <select aria-label="当前标注类别" value={selectedClassId} onChange={(event) => onClassChange(Number(event.target.value))}>
                {annotationClasses.map((item) => (
                  <option key={item.id} value={item.id}>{item.displayName}</option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" disabled={historyPastLength <= 1} onClick={onUndo}>撤销</button>
            <button type="button" className="btn" disabled={!historyFutureLength} onClick={onRedo}>重做</button>
            <button type="button" className="btn" disabled={!annotationBoxes.length} onClick={onRemoveLastBox}>撤销最后一个框</button>
            <button type="button" className="btn danger" disabled={!annotationBoxes.length} onClick={onClearBoxes}>清空框选</button>
            <button type="button" className="primary" disabled={!selectedImage || savingAnnotation} onClick={onSave}>
              <Save size={16} />
              {savingAnnotation ? '保存中...' : '保存标注'}
            </button>
            <button type="button" className="btn" disabled={!selectedImage || savingAnnotation} onClick={onSaveAndNext}>
              <Save size={16} />
              保存并下一张
            </button>
          </div>
        </div>

        <AnnotationCanvas
          image={selectedImage}
          boxes={annotationBoxes}
          classes={annotationClasses}
          selectedClassId={selectedClassId}
          selectedIndex={selectedBoxIndex}
          onSelectIndex={onSelectBox}
          onChange={onAnnotationChange}
          onPreviewChange={onPreviewChange}
          onChangeStart={onChangeStart}
          onChangeCancel={onChangeCancel}
        />
        <p className="help">{annotationMessage || `当前共 ${annotationBoxes.length} 个标注框。${annotationDirty ? '有未保存修改。' : ''}点击已标注框可拖动微调，选中后用方向键微调，Enter 保存。`}</p>

        <div className="box-list">
          {annotationBoxes.length ? (
            annotationBoxes.map((box, index) => (
              <div
                className={selectedBoxIndex === index ? 'box-row active' : 'box-row'}
                key={`${box.x}-${box.y}-${index}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelectBox(index)}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectBox(index);
                  }
                }}
              >
                <span>{annotationClasses.find((item) => item.id === box.classId)?.displayName || `类别 ${box.classId}`} #{index + 1}</span>
                <span>中心 ({box.x.toFixed(3)}, {box.y.toFixed(3)})</span>
                <span>大小 ({box.width.toFixed(3)}, {box.height.toFixed(3)})</span>
                <button type="button" className="icon-button" aria-label={`删除标注框 ${index + 1}`} onClick={(event) => { event.stopPropagation(); onDeleteBox(index); }}>
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
  );
}

