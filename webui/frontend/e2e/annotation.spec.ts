import { expect, test } from '@playwright/test';

const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

const classes = [
  { id: 0, name: 'cat', displayName: '猫' },
  { id: 1, name: 'dog', displayName: '狗' },
];

function image(name: string, hasLabel: boolean, labelCount: number, boxes: unknown[] = []) {
  return {
    name,
    stem: name.replace(/\.jpg$/, ''),
    profile: 'cat',
    split: 'train',
    url: `/files/datasets/cat/train/images/${name}`,
    thumbnailUrl: `/thumbnails/cat/train/${name}`,
    width: 1200,
    height: 800,
    hasLabel,
    labelCount,
    boxes,
    mtime: 1,
  };
}

const initialBoxes = [{ classId: 0, x: 0.25, y: 0.35, width: 0.2, height: 0.3 }];
const images = [
  image('cat-01.jpg', true, 1, initialBoxes),
  ...Array.from({ length: 19 }, (_, index) => image(`cat-${String(index + 2).padStart(2, '0')}.jpg`, false, 0)),
];

async function mockApi(page: import('@playwright/test').Page) {
  let savedImage = images[0];
  let saveCount = 0;

  await page.route('**/files/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: onePixelPng });
  });
  await page.route('**/thumbnails/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: onePixelPng });
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/status') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          profile: 'cat',
          profiles: [{ id: 'cat', title: '猫数据集' }],
          classes,
          projectDir: '/tmp/yolo',
          python: '3.12',
          platform: 'test',
          cpu: 'test',
          torch: 'test',
          cuda: false,
          cudaDevice: null,
          ultralytics: 'test',
          opencv: 'test',
          nvidiaSmi: null,
          pretrained: null,
          bestModel: null,
          dataset: {
            splits: {
              train: { images: savedImage.hasLabel ? 3 : 3, labels: savedImage.hasLabel ? 1 : 0, missingLabels: [], orphanLabels: [], missingLabelCount: 0, orphanLabelCount: 0 },
              val: { images: 0, labels: 0, missingLabels: [], orphanLabels: [], missingLabelCount: 0, orphanLabelCount: 0 },
              test: { images: 0, labels: 0, missingLabels: [], orphanLabels: [], missingLabelCount: 0, orphanLabelCount: 0 },
            },
            totalImages: 3,
            totalLabels: savedImage.hasLabel ? 1 : 0,
            ready: true,
          },
          task: null,
        }),
      });
      return;
    }

    if (path === '/api/dataset/check') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ report: null }) });
      return;
    }

    if (path === '/api/dataset/images') {
      const label = url.searchParams.get('label') || 'all';
      const filtered = images.map((item) => item.name === savedImage.name ? savedImage : item).filter((item) => {
        if (label === 'labeled') return item.hasLabel;
        if (label === 'unlabeled') return !item.hasLabel;
        return true;
      });
      const pageNumber = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('page_size') || 60);
      const start = (pageNumber - 1) * pageSize;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          profile: 'cat',
          split: 'train',
          classes,
          images: filtered.slice(start, start + pageSize),
          total: filtered.length,
          page: 1,
          pageSize,
          pageCount: filtered.length ? 1 : 0,
        }),
      });
      return;
    }

    if (path === '/api/dataset/labels' && request.method() === 'POST') {
      const body = request.postDataJSON() as { boxes: Array<{ class_id: number; x: number; y: number; width: number; height: number }> };
      savedImage = {
        ...savedImage,
        boxes: body.boxes.map((box) => ({ classId: box.class_id, x: box.x, y: box.y, width: box.width, height: box.height })),
        hasLabel: body.boxes.length > 0,
        labelCount: body.boxes.length,
      };
      saveCount += 1;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ image: savedImage, dataset: {} }) });
      return;
    }

    if (path === '/api/task') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ task: null }) });
      return;
    }
    if (path === '/api/log') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ task: null, log: '' }) });
      return;
    }
    if (path === '/api/tasks/history') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
      return;
    }
    if (path === '/api/predictions/tasks') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
      return;
    }
    if (path.startsWith('/api/predictions')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(path.endsWith('/stats') ? { count: 0, totalBytes: 0, oldestAt: null, newestAt: null, taskCount: 0 } : { predictions: [] }) });
      return;
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: `Unhandled mock: ${path}` }) });
  });

  return { getSaveCount: () => saveCount };
}

test.describe('在线标注浏览器验收', () => {
  test('保存后不刷新页面即可同步状态、筛选和提示', async ({ page }) => {
    const mock = await mockApi(page);
    await page.goto('/annotate');

    await expect(page.getByRole('heading', { name: '待标注图片' })).toBeVisible();
    await expect(page.getByRole('button', { name: /cat-01\.jpg/ })).toBeVisible();
    await expect(page.locator('.annotation-title').getByText('1 个框', { exact: true })).toBeVisible();

    const filter = page.getByLabel('标注状态筛选');
    await filter.selectOption('labeled');
    await expect(filter).toHaveValue('labeled');
    await expect(page.getByRole('button', { name: /cat-01\.jpg/ })).toBeVisible();
    await filter.selectOption('all');
    await expect(filter).toHaveValue('all');

    await page.getByRole('button', { name: '清空框选' }).click();
    await expect(page.getByText('未保存', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '保存标注' }).click();

    await expect(page.getByRole('status')).toContainText('已保存 0 个标注框');
    await expect(page.getByRole('button', { name: /cat-01\.jpg.*未标注/ })).toBeVisible();
    expect(mock.getSaveCount()).toBe(1);
    await expect(page).toHaveURL(/\/annotate$/);
  });

  test('窄屏下左侧列表保持独立滚动，主图片容器不被横向撑开', async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/annotate');

    const sidebar = page.locator('.annotation-sidebar');
    const list = page.locator('.annotation-image-list');
    const canvasWrap = page.locator('.annotation-canvas-wrap');
    await expect(sidebar).toBeVisible();
    await expect(list).toBeVisible();
    await expect(canvasWrap).toBeVisible();

    const metrics = await page.evaluate(() => {
      const listElement = document.querySelector('.annotation-image-list') as HTMLElement;
      const canvasElement = document.querySelector('.annotation-canvas-wrap') as HTMLElement;
      const body = document.body;
      return {
        listScrollHeight: listElement.scrollHeight,
        listClientHeight: listElement.clientHeight,
        bodyScrollWidth: body.scrollWidth,
        viewportWidth: window.innerWidth,
        canvasWidth: canvasElement.getBoundingClientRect().width,
      };
    });
    expect(metrics.listScrollHeight).toBeGreaterThanOrEqual(metrics.listClientHeight);
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.canvasWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  });
});





