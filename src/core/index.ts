/**
 * src/core 對外入口。
 *
 * 規則（M1 起生效）：
 * - 這裡的程式碼不得碰 DOM、window、localStorage；時間一律由參數注入（不得呼叫 Date.now()）。
 * - M1 會在此擴充 GameState / tick / upgrade / hire / unlock / computeOffline / save-load，
 *   型別以 docs/GDD.md 與 data/balance.json 為準。
 *
 * 目前只提供 M0 骨架所需的最小內容，方便 src/ui 有東西可 import。
 */
export { formatMoney } from './money';

/**
 * 公開 API 契約（唯一版本）：純函式層 `NightMarketCore` 與 UI 門面 `GameEngine`。
 * 只有型別，沒有實作；M1 在此補上 `createCore` / `createGameEngine` 的實作匯出。
 * 詳見 `src/core/API_CONTRACT.md`。
 */
export type * from './api';

/**
 * 骨架期的唯讀畫面快照；M1 會由真正的 GameState 取代。
 * @deprecated M2 改用 `GameSnapshot`；`src/ui/app.ts` 換掉後本型別與 `PLACEHOLDER_SNAPSHOT` 一起刪除。
 */
export interface Snapshot {
  readonly balance: number;
  readonly stalls: readonly StallView[];
  readonly clerkHired: boolean;
}

/** @deprecated 見 `Snapshot`。 */
export interface StallView {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly unlocked: boolean;
  /** 每秒被動收入（遊戲內單位）。 */
  readonly incomePerSec: number;
}

/**
 * 骨架期假資料，讓 UI 可以先開工；M1 接上真實引擎後移除。
 * @deprecated 由 `GameEngine` 的假實作取代（M2）。
 */
export const PLACEHOLDER_SNAPSHOT: Snapshot = {
  balance: 12_345,
  clerkHired: false,
  stalls: [
    { id: 'chicken-steak', name: '雞排車', level: 3, unlocked: true, incomePerSec: 12 },
    { id: 'bubble-tea', name: '珍奶攤', level: 1, unlocked: true, incomePerSec: 5 },
    { id: 'oyster-omelette', name: '蚵仔煎', level: 0, unlocked: false, incomePerSec: 0 },
    { id: 'stinky-tofu', name: '臭豆腐', level: 0, unlocked: false, incomePerSec: 0 },
    { id: 'sausage', name: '大腸包小腸', level: 0, unlocked: false, incomePerSec: 0 },
  ],
};
