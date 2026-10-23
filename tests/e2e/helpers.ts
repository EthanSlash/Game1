/**
 * 玩法 E2E 共用工具（MiniMax31）。
 *
 * 三個重點：
 *
 * 1. **時間用 Playwright 的假時鐘**（`page.clock`），不靠真實等待。
 *    - `install({ time })` → 固定起始時間，之後 `pauseAt` 把時鐘凍住（`install` 後
 *      時鐘仍會跟真實時間走，凍住才會完全可重現）。
 *    - `fastForward(ms)` → 跳時間，只觸發**一次**待觸發的 timer（等於「使用者離開
 *      一段時間再回來」）。引擎是連續時間制，一段只結算一次，金額與每 250ms 連續
 *      tick 相同（GDD §4.6）。
 *    - `runFor(ms)` → 真的逐格 firing timer（每 250ms 一次），用於量測「持續前景」。
 *
 * 2. **金額期望值一律從 `data/balance.json` + GDD 公式算出來**，顯示值一律經過
 *    `formatMoney`（GDD §7）。spec 裡不寫死任何金額。
 *
 * 3. **為什麼 `formatMoney` 從 `src/core/money` 匯入、不是 `src/core/index.ts`**：
 *    Playwright 的 ESM loader 要求 JSON import 帶 import attribute，而
 *    `src/core/index.ts` 裡的 `import balanceData from '../../data/balance.json'`
 *    沒有帶 → 從 index 匯入會在載入階段直接炸掉。`src/core/money.ts` 本身不 import
 *    JSON，所以單獨從它匯入 `formatMoney`（同一支實作、同樣的格式化規則）。
 */
import type { Page } from '@playwright/test';
import balanceJson from '../../data/balance.json' with { type: 'json' };
import { formatMoney } from '../../src/core/money';

/** `data/balance.json` 的內容（唯一的遊戲數值來源，GDD §13）。 */
export const BALANCE = balanceJson;

type Balance = typeof balanceJson;
type StallDef = Balance['stalls'][number];

/**
 * UI 的前景 tick 節奏（毫秒）。GDD §6 只寫「建議 250ms」，不是遊戲數值，
 * 所以放在測試端當常數；`data/balance.json` 裡沒有這個值。
 */
export const UI_TICK_MS = 250;

/** 固定的起始時間（2026-01-15T08:00:00Z），避免依賴真實時鐘。 */
export const CLOCK_START_MS = Date.UTC(2026, 0, 15, 8, 0, 0);

/** 依 id 取得攤位設定；找不到就拋錯（測試不該靜默通過）。 */
export function stallById(id: string): StallDef {
  const stall = BALANCE.stalls.find((s) => s.id === id);
  if (stall === undefined) throw new Error(`balance.json 沒有攤位 ${id}`);
  return stall;
}

/** GDD §4.1 里程碑倍率（累乘，不是取最高一檔）。 */
export function milestoneMultiplier(level: number): number {
  return BALANCE.milestones
    .filter((m) => m.level <= level)
    .reduce((acc, m) => acc * m.multiplier, 1);
}

/** GDD §4.2 單一攤位的每秒收益。 */
export function stallIncomePerSec(id: string, level: number, clerkHired: boolean): number {
  const stall = stallById(id);
  const clerkFactor = clerkHired ? BALANCE.clerkIncomeMultiplier : 1;
  return (
    stall.baseIncomePerSec *
    BALANCE.incomeGrowthPerLevel ** (level - 1) *
    milestoneMultiplier(level) *
    clerkFactor
  );
}

/** GDD §4.4 升級成本（`level` 是目前等級，即 Lv → Lv+1 的價格）。 */
export function upgradeCost(id: string, level: number): number {
  const stall = stallById(id);
  return Math.floor(stall.upgradeCostBase * stall.upgradeCostGrowth ** (level - 1));
}

/** 顯示用金額（GDD §7：顯示一律走 formatMoney）。 */
export function money(amount: number): string {
  return formatMoney(amount);
}

/**
 * 開一局並把假時鐘對齊到 tick 格線。
 *
 * 為什麼要 `fastForward(250)`：UI 的前景 loop 是 `setInterval(250ms)`，它的觸發點
 * 落在「安裝假時刻 + 250ms」的格線上，跟我們後續的操作時點不一定對齊。格線沒對齊
 * 時，最後一次 tick 會落在量測窗口結束前最多 250ms 的地方，金額就會少一截（畫面金額
 * 又是向下取整，差 1 就看得出來）。`fastForward` 會把待觸發的 timer 推到目標時間再觸發
 * 一次，於是格線就對齊到「現在」；之後每次 `runFor` 的最後一次 tick 都剛好落在窗口
 * 結尾，金額可精確斷言。
 */
export async function bootGame(page: Page): Promise<void> {
  await page.clock.install({ time: CLOCK_START_MS });
  await page.goto('/');
  // pauseAt 要給「現在以後」的時間：install 之後假時鐘仍跟著真實時間走，
  // 讀到的 Date.now() 會比 pauseAt 執行時的內部時間早一點點，直接餵會變成
  // 「fast-forward to the past」。多給 1 秒當緩衝。
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
  await page.clock.fastForward(UI_TICK_MS);
}

/**
 * 前景推進（長時間）。
 *
 * 每段最多 `maxGapSeconds - 1` 秒，避免觸發 GDD §4.6 的「前景長空檔改用離線規則」
 * （那條規則是 G10 專門測的）。用 fastForward 是因為引擎是連續時間制：一段 59 秒的
 * 前景結算與每 250ms 連續 tick 59 秒的金額完全相同。
 */
export async function advanceForeground(page: Page, timeMs: number): Promise<void> {
  const chunkMs = (BALANCE.foreground.maxGapSeconds - 1) * 1000;
  let remaining = timeMs;
  while (remaining > 0) {
    const step = Math.min(chunkMs, remaining);
    await page.clock.fastForward(step);
    remaining -= step;
  }
}

/**
 * 前景推進（短時間、真的逐格 tick）。
 *
 * `timeMs` 必須是 `UI_TICK_MS` 的倍數，這樣最後一次 tick 才剛好落在窗口結尾、
 * 金額可以精確斷言。
 */
export async function tickForeground(page: Page, timeMs: number): Promise<void> {
  if (timeMs % UI_TICK_MS !== 0) {
    throw new Error(`tickForeground 的時間必須是 ${UI_TICK_MS}ms 的倍數，收到 ${timeMs}`);
  }
  await page.clock.runFor(timeMs);
}

/** 模擬頁面進背景 / 回前景（GDD §6：`visibilitychange` → `onHidden` / `onVisible`）。 */
export async function setPageHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => isHidden,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** 存檔信封（只取 E2E 需要的欄位）。 */
export interface SaveSnapshot {
  readonly version: number;
  readonly savedAt: number;
  readonly state: {
    readonly balance: number;
    readonly lastSettledAt: number;
    readonly stalls: Readonly<Record<string, { readonly level: number; readonly unlocked: boolean; readonly clerkHired: boolean; readonly selling: boolean }>>;
  };
}

/**
 * 讀出 UI 寫在 localStorage 的存檔。
 *
 * GDD §6.1 沒有指定 key 名稱（由 UI 自己決定），所以掃全部 key，找第一个能解析成
 * 存檔信封的 JSON。
 */
export async function readSave(page: Page): Promise<SaveSnapshot | null> {
  return page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue; // 不是 JSON 就略過
      }
      if (parsed === null || typeof parsed !== 'object') continue;
      const envelope = parsed as { version?: unknown; savedAt?: unknown; state?: unknown };
      if (
        typeof envelope.version === 'number' &&
        typeof envelope.savedAt === 'number' &&
        envelope.state !== null &&
        typeof envelope.state === 'object'
      ) {
        return envelope as unknown as SaveSnapshot;
      }
    }
    return null;
  });
}

/**
 * 把離線時長文字換算回毫秒。
 *
 * 離線時長的**格式**沒有寫在 GDD（`src/ui/app.ts` 自己决定），所以這裡不綁死字串，
 * 只讀出「幾小時 / 幾分 / 幾秒」三個數字，驗證語意（ creditedMs）而不是排版。
 */
export function parseDurationMs(text: string): number {
  const hours = /(\d+)\s*小時/.exec(text);
  const minutes = /(\d+)\s*分/.exec(text);
  const seconds = /(\d+)\s*秒/.exec(text);
  const totalSeconds =
    (hours === null ? 0 : Number(hours[1])) * 3600 +
    (minutes === null ? 0 : Number(minutes[1])) * 60 +
    (seconds === null ? 0 : Number(seconds[1]));
  return totalSeconds * 1000;
}

/**
 * 常用的前置狀態：雞排車手動開賣、珍珠奶茶解鎖並雇店員。
 *
 * 這組狀態下（GDD §4.3）：
 * - 前景速率 = 雞排 1/秒 + 珍奶 4/秒 × 1.25 = 6/秒
 * - 離線速率 = 只有珍奶的店員 → 5/秒
 * 前景與離線速率不同，G8（背景回來）與 G10（前景長空檔）才有辦法分辨引擎到底用了
 * 哪一套規則。
 *
 * 回傳最後的餘額（雇用店員後）。
 */
export async function setupSellingStallWithClerk(page: Page): Promise<number> {
  const chicken = stallById('chicken-steak');
  const bubble = stallById('bubble-tea');
  const clerkCost = bubble.hireCost;

  await page.getByTestId(`sell-${chicken.id}`).click();

  // 湊到「解鎖珍奶 + 雇店員」的钱：解鎖費 + 雇店員費 + 一點餘裕
  const need = bubble.unlockCost + clerkCost + 100;
  await advanceForeground(page, need * 1000);

  await page.getByTestId(`unlock-${bubble.id}`).click();
  await page.getByTestId(`hire-${bubble.id}`).click();

  const balance = need - bubble.unlockCost - clerkCost;
  return balance;
}
