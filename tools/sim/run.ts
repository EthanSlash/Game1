/**
 * 平衡模擬入口（骨架期佔位）。
 *
 * 之後由 MiMo26 接手：跑 1 小時 / 24 小時 / 7 天曲線，對照 docs/GDD.md 的目標值。
 * 用法：npm run sim
 */
import { PLACEHOLDER_SNAPSHOT, formatMoney } from '../../src/core';

const totalIncome = PLACEHOLDER_SNAPSHOT.stalls.reduce((sum, s) => sum + s.incomePerSec, 0);

console.log('[sim] M1 引擎尚未交付，目前只驗證 core 可被 Node 直接載入。');
console.log(`[sim] 假資料：餘額 ${formatMoney(PLACEHOLDER_SNAPSHOT.balance)}、每秒 ${totalIncome}`);
