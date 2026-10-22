/**
 * src/core 對外入口（UI 與測試**只** import 這裡）。
 *
 * 規則（repo AGENTS.md 硬規則 1、2）：
 * - 這裡的程式碼不得碰 DOM、window、localStorage；時間一律由參數注入（不得呼叫 Date.now()）。
 * - 所有遊戲數值都來自 `data/balance.json`，程式不得寫死（`BALANCE_CONFIG` 是唯一入口）。
 *
 * 分層：`NightMarketCore`（純函式）→ `GameEngine`（有狀態門面，UI 唯一會碰的介面）。
 * 契約型別在 `./api`，規格在 `docs/GDD.md`，實作在 `./core`、`./engine`、`./save`。
 */

import balanceData from '../../data/balance.json';

import type { BalanceConfig } from './api';

export { formatMoney } from './money';
export { createCore } from './core';
export { createGameEngine } from './engine';

/**
 * 公開 API 契約（唯一版本）：純函式層 `NightMarketCore` 與 UI 門面 `GameEngine`。
 * 型別定義在 `src/core/api.ts`，說明見 `src/core/API_CONTRACT.md`。
 */
export type * from './api';

/**
 * `data/balance.json` 的內容（唯一的數值來源）。
 * `src/ui` 用它建立引擎：`createGameEngine(BALANCE_CONFIG)`；存檔間隔等設定值也從這裡讀。
 */
export const BALANCE_CONFIG: BalanceConfig = balanceData;

/**
 * 骨架期的唯讀畫面快照；已由 `GameSnapshot` 取代。
 * @deprecated 等 M2 的 `src/ui/app.ts` 改用 `GameSnapshot` 後，於 M1 的後續 PR 刪除
 * （`Snapshot` / `StallView` / `PLACEHOLDER_SNAPSHOT` 三項一起）。
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
 * 骨架期假資料，讓 UI 可以先開工；M2 接上真引擎後移除。
 * @deprecated 由 `GameEngine` 取代（M2）。
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
