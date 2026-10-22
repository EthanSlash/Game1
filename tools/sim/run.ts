/**
 * 平衡模擬入口（骨架期佔位）。
 *
 * 之後由 MiMo26 接手：跑 1 小時 / 24 小時 / 7 天曲線，對照 docs/GDD.md 的目標值。
 * 完整模擬由 `feat/m1-tools-sim` 整支取代；這裡只保留不依賴任何 M0 舊型別的最小版本。
 * 用法：npm run sim
 */
import { BALANCE_CONFIG, formatMoney } from '../../src/core';

const stallCount = BALANCE_CONFIG.stalls.length;

console.log('[sim] M1 引擎已交付；完整平衡模擬由 feat/m1-tools-sim 提供。');
console.log(
  `[sim] balance.json：${stallCount} 攤、起始餘額 ${formatMoney(BALANCE_CONFIG.startingBalance)}`,
);
