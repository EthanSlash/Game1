import { expect, test } from '@playwright/test';

test('首頁載入並顯示夜市攤王骨架畫面', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '夜市攤王' })).toBeVisible();
  // 假引擎新局（GDD §3）：起始餘額 0、第一攤解鎖，其餘 4 攤鎖住（data/balance.json）
  await expect(page.locator('.top__balance')).toHaveText('0');
  await expect(page.locator('.stall')).toHaveCount(5);
  await expect(page.locator('.stall--locked')).toHaveCount(4);
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
