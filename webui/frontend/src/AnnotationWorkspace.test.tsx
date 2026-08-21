import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

vi.mock('./components/AnnotationCanvas', () => ({
  AnnotationCanvas: ({ onSelectIndex, onChange, onPreviewChange, onChangeStart, onChangeCancel }: any) => (
    <div data-testid="annotation-canvas">
      <button type="button" onClick={() => onSelectIndex(0)}>选中画布框</button>
      <button type="button" onClick={() => onChange([{ classId: 1, x: 0.5, y: 0.5, width: 0.2, height: 0.2 }])}>更新画布框</button>
      <button type="button" onClick={onPreviewChange ? () => onPreviewChange([]) : undefined}>预览画布框</button>
      <button type="button" onClick={onChangeStart}>开始拖动</button>
      <button type="button" onClick={onChangeCancel}>取消拖动</button>
    </div>
  ),
}));

vi.mock('./components/VirtualImageList', () => ({
  VirtualImageList: ({ images, onSelect }: any) => (
    <div data-testid="image-list">
      {images.map((image: any) => <button type="button" key={image.name} onClick={() => onSelect(image)}>{image.name}</button>)}
    </div>
  ),
}));

vi.mock('./components/Pagination', () => ({
  Pagination: ({ page, pageCount, onChange }: any) => pageCount > 1 ? (
    <div data-testid="pagination">
      <span>{page} / {pageCount}</span>
      <button type="button" onClick={() => onChange(page + 1)}>下一页测试</button>
    </div>
  ) : null,
}));

import { AnnotationWorkspace } from './components/AnnotationWorkspace';
import type { Box, DatasetImage } from './types';

const boxes: Box[] = [
  { classId: 0, x: 0.25, y: 0.35, width: 0.2, height: 0.3 },
  { classId: 1, x: 0.7, y: 0.6, width: 0.1, height: 0.12 },
];

const images: DatasetImage[] = [
  {
    name: 'cat-01.jpg', stem: 'cat-01', profile: 'cat', split: 'train', url: '/files/cat-01.jpg', width: 1000, height: 800,
    hasLabel: true, labelCount: 1, boxes: [boxes[0]], mtime: 1,
  },
  {
    name: 'cat-02.jpg', stem: 'cat-02', profile: 'cat', split: 'train', url: '/files/cat-02.jpg', width: 1000, height: 800,
    hasLabel: false, labelCount: 0, boxes: [], mtime: 2,
  },
];

function renderWorkspace(overrides: Partial<ComponentProps<typeof AnnotationWorkspace>> = {}) {
  const props: ComponentProps<typeof AnnotationWorkspace> = {
    profileOptions: [{ id: 'cat', title: '猫数据集' }],
    annotateProfile: 'cat',
    annotateSplit: 'train',
    annotationLabelFilter: 'all',
    annotationImages: images,
    annotationTotal: 2,
    annotationPage: 1,
    annotationPageCount: 2,
    selectedImage: images[0],
    annotationBoxes: boxes,
    annotationClasses: [
      { id: 0, name: 'cat', displayName: '猫' },
      { id: 1, name: 'dog', displayName: '狗' },
    ],
    selectedClassId: 0,
    selectedBoxIndex: null,
    annotationMessage: '',
    annotationDirty: false,
    savingAnnotation: false,
    annotationImagesLoading: false,
    annotationImagesError: '',
    annotationStatusLoading: false,
    annotationStatusError: '',
    historyPastLength: 2,
    historyFutureLength: 1,
    onSplitChange: vi.fn(),
    onProfileChange: vi.fn(),
    onLabelFilterChange: vi.fn(),
    onSelectImage: vi.fn(),
    onPageChange: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onClassChange: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onRemoveLastBox: vi.fn(),
    onClearBoxes: vi.fn(),
    onSave: vi.fn(),
    onSaveAndNext: vi.fn(),
    onSelectBox: vi.fn(),
    onDeleteBox: vi.fn(),
    onAnnotationChange: vi.fn(),
    onPreviewChange: vi.fn(),
    onChangeStart: vi.fn(),
    onChangeCancel: vi.fn(),
    onRetryImages: vi.fn(),
    onRetryStatus: vi.fn(),
    ...overrides,
  };
  return { ...render(<AnnotationWorkspace {...props} />), props };
}

describe('AnnotationWorkspace', () => {
  it('renders filters, image list, controls and current annotation state', () => {
    const { props, rerender } = renderWorkspace({ annotationMessage: '已保存 1 个标注框。', annotationDirty: true });
    const imageList = within(screen.getByTestId('image-list'));

    expect(screen.getByRole('heading', { name: '待标注图片' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '标注状态筛选' })).toHaveValue('all');
    expect(imageList.getByRole('button', { name: 'cat-01.jpg' })).toBeInTheDocument();
    expect(imageList.getByRole('button', { name: 'cat-02.jpg' })).toBeInTheDocument();
    expect(screen.getByText('已保存 1 个标注框。')).toBeInTheDocument();
    expect(screen.getByText('未保存')).toBeInTheDocument();
    expect(screen.getByText('历史 1/20')).toBeInTheDocument();
    expect(screen.getByText('猫 #1')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: '标注状态筛选' }), { target: { value: 'unlabeled' } });
    fireEvent.change(screen.getByRole('combobox', { name: '标注数据集分组' }), { target: { value: 'val' } });
    fireEvent.change(screen.getByRole('combobox', { name: '标注数据集配置' }), { target: { value: 'cat' } });
    fireEvent.click(imageList.getByRole('button', { name: 'cat-02.jpg' }));
    fireEvent.click(screen.getByRole('button', { name: '下一页测试' }));
    fireEvent.click(screen.getByRole('button', { name: '下一张' }));
    rerender(<AnnotationWorkspace {...props} selectedImage={images[1]} />);
    fireEvent.click(screen.getByRole('button', { name: '上一张' }));

    expect(props.onLabelFilterChange).toHaveBeenCalledWith('unlabeled');
    expect(props.onSplitChange).toHaveBeenCalledWith('val');
    expect(props.onProfileChange).toHaveBeenCalledWith('cat');
    expect(props.onSelectImage).toHaveBeenCalledWith(images[1]);
    expect(props.onPageChange).toHaveBeenCalledWith(2);
    expect(props.onNext).toHaveBeenCalledOnce();
    expect(props.onPrevious).toHaveBeenCalledOnce();
  });

  it('shows request states and retries failed annotation reads', () => {
    const onRetryImages = vi.fn();
    const onRetryStatus = vi.fn();
    renderWorkspace({ annotationImagesLoading: true, annotationStatusError: '网络异常', annotationImagesError: '列表不可用', onRetryImages, onRetryStatus });
    expect(screen.getByText('正在读取图片列表...')).toBeInTheDocument();
    expect(screen.getByText('统计刷新失败：网络异常')).toBeInTheDocument();
    expect(screen.getByText('图片列表读取失败：列表不可用')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '重试' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '重试' })[1]);
    expect(onRetryStatus).toHaveBeenCalledOnce();
    expect(onRetryImages).toHaveBeenCalledOnce();
  });

  it('emits annotation actions and shows saving/empty states', () => {
    const onSave = vi.fn();
    const onSaveAndNext = vi.fn();
    const onDeleteBox = vi.fn();
    const onSelectBox = vi.fn();
    const onAnnotationChange = vi.fn();
    const { props, rerender } = renderWorkspace({ onSave, onSaveAndNext, onDeleteBox, onSelectBox, onAnnotationChange });

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销最后一个框' }));
    fireEvent.click(screen.getByRole('button', { name: '清空框选' }));
    fireEvent.click(screen.getByRole('button', { name: '选中画布框' }));
    fireEvent.click(screen.getByRole('button', { name: '更新画布框' }));
    fireEvent.click(screen.getByRole('button', { name: '删除标注框 1' }));
    fireEvent.click(screen.getByRole('button', { name: '保存标注' }));
    fireEvent.click(screen.getByRole('button', { name: '保存并下一张' }));

    expect(props.onUndo).toHaveBeenCalledOnce();
    expect(props.onRedo).toHaveBeenCalledOnce();
    expect(props.onRemoveLastBox).toHaveBeenCalledOnce();
    expect(props.onClearBoxes).toHaveBeenCalledOnce();
    expect(onSelectBox).toHaveBeenCalledWith(0);
    expect(onAnnotationChange).toHaveBeenCalledWith([{ classId: 1, x: 0.5, y: 0.5, width: 0.2, height: 0.2 }]);
    expect(onDeleteBox).toHaveBeenCalledWith(0);
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSaveAndNext).toHaveBeenCalledOnce();

    rerender(<AnnotationWorkspace {...props} savingAnnotation annotationBoxes={[]} selectedImage={null} />);
    expect(screen.getByText(/还没有框选/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存中...' })).toBeDisabled();
  });
});



