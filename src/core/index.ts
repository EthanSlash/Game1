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
