/**
 * 玩法 E2E（GDD §9 的 G 系列）。
 *
 * 這支 spec 走的是「真的玩一遍」的路徑：用 Playwright 假時鐘推進時間，讓引擎自己
 * 結算收益，斷言畫面上看得見的結果（餘額、等級、按鈕狀態、離線彈窗）。不塞存檔、
 * 不改程式狀態。
 *
 * 時間怎麼推進、金額期望值怎麼算，見 `tests/e2e/helpers.ts` 與 `tests/e2e/README.md`。
 * G1–G10 的定義同樣寫在 README（規格歸 DeepSeek41，本 PR 只附建議文字）。
 */
import { expect, test } from '@playwright/test';
import {
  BALANCE,
  advanceForeground,
  bootGame,
  money,
  parseDurationMs,
  readSave,
  setPageHidden,
  setupSellingStallWithClerk,
  stallById,
  stallIncomePerSec,
  tickForeground,
  upgradeCost,
} from './helpers';

const CHICKEN = 'chicken-steak';
const BUBBLE = 'bubble-tea';

test('G1 開局畫面：5 個攤位、第一攤 Lv1 未開賣、其餘 4 攤鎖住', async ({ page }) => {
  await bootGame(page);

  // 頂欄（GDD §3：開局 balance = startingBalance，沒有攤位在營業 → 收益 0）
  await expect(page.getByTestId('balance')).toHaveText(money(BALANCE.startingBalance));
  await expect(page.getByTestId('income-per-sec')).toHaveText(`+${money(0)}/秒`);

  // 攤位清單：5 張卡、4 張鎖住（只有 stalls[0] 開局解鎖，GDD §3 不變式 3）
  await expect(page.locator('[data-testid^="stall-"]')).toHaveCount(BALANCE.stalls.length);
  await expect(page.locator('[data-locked="true"]')).toHaveCount(BALANCE.stalls.length - 1);

  const chicken = stallById(CHICKEN);
  await expect(page.getByTestId(`stall-${CHICKEN}`)).not.toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId(`level-${CHICKEN}`)).toHaveText('Lv.1');
  await expect(page.getByTestId(`income-stall-${CHICKEN}`)).toHaveText(`+${money(0)}/秒`);
  await expect(page.getByTestId(`sell-${CHICKEN}`)).toHaveText('開賣');
  await expect(page.getByTestId(`hire-${CHICKEN}`)).toHaveText(`雇店員 ${money(chicken.hireCost)}`);
  await expect(page.getByTestId(`hire-${CHICKEN}`)).toBeDisabled(); // 餘額 0 < hireCost

  const bubble = stallById(BUBBLE);
  await expect(page.getByTestId(`stall-${BUBBLE}`)).toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId(`level-${BUBBLE}`)).toHaveCount(0); // 鎖住時沒有等級
  await expect(page.getByTestId(`unlock-${BUBBLE}`)).toHaveText(`解鎖 ${money(bubble.unlockCost)}`);
  await expect(page.getByTestId(`unlock-${BUBBLE}`)).toBeDisabled(); // 餘額 0 < unlockCost

  await expect(page.getByTestId('offline-modal')).toBeHidden();
});

test('G2 開賣：前景收益入帳（每秒 = baseIncomePerSec）', async ({ page }) => {
  await bootGame(page);
  const rate = stallIncomePerSec(CHICKEN, 1, false);

  await expect(page.getByTestId(`sell-${CHICKEN}`)).toHaveText('開賣');
  await page.getByTestId(`sell-${CHICKEN}`).click();
  await expect(page.getByTestId(`sell-${CHICKEN}`)).toHaveText('收攤');
  await expect(page.getByTestId('income-per-sec')).toHaveText(`+${money(rate)}/秒`);
  await expect(page.getByTestId(`income-stall-${CHICKEN}`)).toHaveText(`+${money(rate)}/秒`);

  // 前景 10 秒 → 10 秒 × 每秒速率
  await tickForeground(page, 10_000);
  await expect(page.getByTestId('balance')).toHaveText(money(rate * 10));
});

test('G3 升級：等級 +1、每秒收益同步上升', async ({ page }) => {
  await bootGame(page);
  await page.getByTestId(`sell-${CHICKEN}`).click();
  const rateLv1 = stallIncomePerSec(CHICKEN, 1, false);

  // 先賺到剛好等於升級成本（GDD §9 A2 的邊界：餘額 == 價格要成功）
  await tickForeground(page, 10_000);
  await expect(page.getByTestId('balance')).toHaveText(money(rateLv1 * 10));

  const cost = upgradeCost(CHICKEN, 1);
  await expect(page.getByTestId(`upgrade-${CHICKEN}`)).toHaveText(`升級 ${money(cost)}`);
  await page.getByTestId(`upgrade-${CHICKEN}`).click();

  await expect(page.getByTestId(`level-${CHICKEN}`)).toHaveText('Lv.2');
  await expect(page.getByTestId('balance')).toHaveText(money(rateLv1 * 10 - cost));

  // 速率由 incomeGrowthPerLevel 成長：Lv1 → Lv2 是 1.1 倍（GDD §4.2）
  const rateLv2 = stallIncomePerSec(CHICKEN, 2, false);
  await expect(page.getByTestId('income-per-sec')).toHaveText(`+${money(rateLv2)}/秒`);

  // 畫面金額是向下取整的整數（§7），所以速率有沒有真的上升，看「25 秒賺多少」：
  // Lv1 是 25、Lv2 是 27.5（顯示 27）。
  await tickForeground(page, 25_000);
  await expect(page.getByTestId('balance')).toHaveText(money(rateLv2 * 25));
});

test('G4 雇店員：收益套 clerkIncomeMultiplier、開賣/雇店員鈕消失', async ({ page }) => {
  await bootGame(page);
  await page.getByTestId(`sell-${CHICKEN}`).click();
  const rateNoClerk = stallIncomePerSec(CHICKEN, 1, false);

  // 賺到剛好等於雇店員成本
  await advanceForeground(page, stallById(CHICKEN).hireCost * 1000);
  const hireCost = stallById(CHICKEN).hireCost;
  await expect(page.getByTestId('balance')).toHaveText(money(hireCost));
  await expect(page.getByTestId(`hire-${CHICKEN}`)).toBeEnabled();

  await page.getByTestId(`hire-${CHICKEN}`).click();

  // 雇用後：雇店員鈕與開賣鈕都不再渲染（GDD §5：店員自動營業，不再需要手動開賣）
  await expect(page.getByTestId(`hire-${CHICKEN}`)).toHaveCount(0);
  await expect(page.getByTestId(`sell-${CHICKEN}`)).toHaveCount(0);
  await expect(page.getByTestId('balance')).toHaveText(money(0));

  // 店員加成：10 秒賺 12.5（顯示 12），沒有店員是 10 → 兩者差得開
  const rateWithClerk = stallIncomePerSec(CHICKEN, 1, true);
  await tickForeground(page, 10_000);
  await expect(page.getByTestId('balance')).toHaveText(money(rateWithClerk * 10));
  expect(money(rateWithClerk * 10)).not.toBe(money(rateNoClerk * 10));
});

test('G5 解鎖：攤位解鎖、等級 Lv1、沒有店員也不開賣', async ({ page }) => {
  await bootGame(page);
  await page.getByTestId(`sell-${CHICKEN}`).click();

  const bubble = stallById(BUBBLE);
  await advanceForeground(page, (bubble.unlockCost + 20) * 1000);
  await expect(page.getByTestId(`unlock-${BUBBLE}`)).toBeEnabled();

  await page.getByTestId(`unlock-${BUBBLE}`).click();

  await expect(page.getByTestId(`stall-${BUBBLE}`)).not.toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId(`level-${BUBBLE}`)).toHaveText('Lv.1'); // GDD §3 不變式 4
  await expect(page.getByTestId(`income-stall-${BUBBLE}`)).toHaveText(`+${money(0)}/秒`); // 沒開賣 → 0
  await expect(page.getByTestId(`sell-${BUBBLE}`)).toHaveText('開賣');
  await expect(page.getByTestId('balance')).toHaveText(money(20));
});

test('G6 解鎖鏈：前一攤沒解鎖時，後一攤的解鎖鈕是 disabled', async ({ page }) => {
  await bootGame(page);
  await page.getByTestId(`sell-${CHICKEN}`).click();

  const bubble = stallById(BUBBLE);
  const oyster = stallById('oyster-omelette');

  // 賺到足以解鎖第三攤，但第二攤還沒解鎖 → 解鎖鏈沒滿足
  await advanceForeground(page, (oyster.unlockCost + 600) * 1000);
  await expect(page.getByTestId('balance')).toHaveText(money(oyster.unlockCost + 600));
  await expect(page.getByTestId(`unlock-${oyster.id}`)).toBeDisabled(); // 錢夠、但鏈沒滿足
  await expect(page.getByTestId(`unlock-${bubble.id}`)).toBeEnabled(); // 鏈滿足、錢也夠

  // 解鎖第二攤之後，鏈滿足 → 第三攤可以解鎖
  await page.getByTestId(`unlock-${bubble.id}`).click();
  await expect(page.getByTestId(`unlock-${oyster.id}`)).toBeEnabled();
  await page.getByTestId(`unlock-${oyster.id}`).click();
  await expect(page.getByTestId(`level-${oyster.id}`)).toHaveText('Lv.1');
});

test('G7 動作後存檔：重載後進度保留（等級、開賣狀態、餘額不倒退）', async ({ page }) => {
  await bootGame(page);
  await page.getByTestId(`sell-${CHICKEN}`).click();
  await tickForeground(page, 20_000);
  await expect(page.getByTestId('balance')).toHaveText(money(20));

  // 動作成功後立刻存檔（GDD §6.1 第 2 條）：存檔內容已經是升級後的狀態
  await page.getByTestId(`upgrade-${CHICKEN}`).click();
  await expect(page.getByTestId(`level-${CHICKEN}`)).toHaveText('Lv.2');
  await expect(page.getByTestId('balance')).toHaveText(money(10));

  const saved = await readSave(page);
  expect(saved).not.toBeNull();
  expect(saved!.state.stalls[CHICKEN]?.level).toBe(2);
  expect(saved!.state.balance).toBe(10);

  // 往前一點（還沒到下一次定期存檔）再重載
  await tickForeground(page, 5_000);
  const beforeReload = Number(await page.getByTestId('balance').textContent());

  await page.reload();

  // 進度保留到那個動作：等級與開賣狀態都還在
  await expect(page.getByTestId(`level-${CHICKEN}`)).toHaveText('Lv.2');
  await expect(page.getByTestId(`sell-${CHICKEN}`)).toHaveText('收攤');

  // 餘額不得倒退（§6.1：手動開賣的攤位最多損失一個存檔間隔的收益）
  const afterReload = Number(await page.getByTestId('balance').textContent());
  expect(afterReload).toBeGreaterThanOrEqual(10);
  expect(afterReload).toBeLessThanOrEqual(beforeReload);

  await expect(page.getByTestId('offline-modal')).toBeHidden(); // 離線收益 0 → 不跳彈窗
});

test('G8 離線收益彈窗：回前景補算、金額正確、關閉後不重彈', async ({ page }) => {
  await bootGame(page);
  const balanceBefore = await setupSellingStallWithClerk(page);
  const offlineRate = stallIncomePerSec(BUBBLE, 1, true); // 只有店員攤算離線收益

  // 進背景
  await setPageHidden(page, true);
  // 隱藏 1 小時（引擎這段期間不 tick，時間整整走過 3,600,000ms）
  await page.clock.fastForward(3_600_000);
  // 回前景 → 結算離線收益
  await setPageHidden(page, false);

  await expect(page.getByTestId('offline-modal')).toBeVisible();
  const offlineAmount = offlineRate * 3600;
  await expect(page.getByTestId('offline-amount')).toHaveText(`+${money(offlineAmount)}`);
  expect(parseDurationMs((await page.getByTestId('offline-duration').textContent()) ?? '')).toBe(
    3_600_000,
  );
  await expect(page.getByTestId('offline-cap-hint')).toBeHidden(); // 1 小時 < 離線上限
  await expect(page.getByTestId('balance')).toHaveText(money(balanceBefore + offlineAmount));

  // 關掉彈窗後不會再跳同一筆
  await page.getByTestId('offline-close').click();
  await expect(page.getByTestId('offline-modal')).toBeHidden();
  await tickForeground(page, 1000);
  await expect(page.getByTestId('offline-modal')).toBeHidden();
});

test('G9 前景定期存檔：每 foregroundIntervalSeconds 秒寫一次存檔', async ({ page }) => {
  await bootGame(page);

  // 動作後立刻存檔（GDD §6.1 第 2 條）
  await page.getByTestId(`sell-${CHICKEN}`).click();
  const afterAction = await readSave(page);
  expect(afterAction).not.toBeNull();

  // 前景定期存檔（GDD §6.1 第 3 條）
  await tickForeground(page, (BALANCE.save.foregroundIntervalSeconds + 2) * 1000);
  const afterInterval = await readSave(page);
  expect(afterInterval).not.toBeNull();
  expect(afterInterval!.savedAt).toBeGreaterThan(afterAction!.savedAt);
  expect(afterInterval!.state.lastSettledAt).toBeGreaterThan(afterAction!.state.lastSettledAt);
});

test('G10 前景長空檔：超過 maxGapSeconds 就改用離線規則（只算店員）', async ({ page }) => {
  await bootGame(page);
  const balanceBefore = await setupSellingStallWithClerk(page);
  const offlineRate = stallIncomePerSec(BUBBLE, 1, true);

  // 前景長空檔：tick 只觸發一次，中間的時間超過 foreground.maxGapSeconds（GDD §4.6）
  const gapMs = 120_000;
  await page.clock.fastForward(gapMs);

  // 走離線規則 → 只算店員攤；前景規則會把「自己顧攤」的攤也算進來，兩者金額不同
  const offlineAmount = offlineRate * (gapMs / 1000);
  await expect(page.getByTestId('offline-modal')).toBeVisible();
  await expect(page.getByTestId('offline-amount')).toHaveText(`+${money(offlineAmount)}`);
  await expect(page.getByTestId('balance')).toHaveText(money(balanceBefore + offlineAmount));
});
