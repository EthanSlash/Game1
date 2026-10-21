import { expect, test } from '@playwright/test';

test('首頁載入並顯示夜市攤王骨架畫面', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '夜市攤王' })).toBeVisible();
  // 假資料餘額 12345 → 1.23萬
  await expect(page.locator('.top__balance')).toHaveText('1.23萬');
  await expect(page.locator('.stall')).toHaveCount(5);
  await expect(page.locator('.stall--locked')).toHaveCount(3);
});

test('手機尺寸下不會出現水平滾動', async ({ page }) => {
  await page.goto('/');

  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });

  expect(overflow).toBeLessThanOrEqual(0);
});

test('manifest 可取得（PWA 前置）', async ({ page, request }) => {
  await page.goto('/');
  const res = await request.get('/manifest.webmanifest');

  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ name: '夜市攤王', display: 'standalone' });
});
