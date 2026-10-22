/**
 * Oracle —— 依 `docs/GDD.md` v1.1 的**公式**獨立算出的期望值。
 *
 * 這是黑箱驗收的「標準答案產生器」：
 * - 規格來源是 GDD（§4 公式、§5 動作、§6 事件流程），不是任何實作。
 * - 數值來源是 `data/balance.json`（AGENTS.md 硬規則 2），這裡不寫死任何遊戲數值。
 * - 實作者與驗收者共用同一份「文字規格」，但各自寫程式；
 *   兩邊對規格的理解不同時，這裡的期望值會與實作對不上 → 測試紅 → 立刻回報。
 *
 * 對照章節：GDD §1（單位）、§3（狀態）、§4.1–§4.6（公式）、§5.1（快照欄位）、§9（容差）。
 */
import type {
  BalanceConfig,
  GameState,
  MilestoneView,
  SettleMode,
  StallDefinition,
  StallState,
} from './types';

/** GDD §1：全 repo 的 `now` 都是毫秒，只有 `capSeconds` 是秒。 */
export const MS_PER_SEC = 1000;

/**
 * GDD §4.1 里程碑倍率（累乘，不是取最高一檔）。
 * Lv25 → ×2、Lv50 → ×4、Lv100 → ×8，達到即生效。
 */
export function milestoneMultiplier(config: BalanceConfig, level: number): number {
  return config.milestones
    .filter((m) => level >= m.level)
    .reduce((acc, m) => acc * m.multiplier, 1);
}

/**
 * GDD §4.2 單一攤位的每秒收益（不取整）。
 * `baseIncomePerSec × incomeGrowthPerLevel^(level-1) × milestoneMultiplier(level) × clerkFactor`
 */
export function stallIncomePerSec(
  config: BalanceConfig,
  stall: StallDefinition,
  level: number,
  clerkHired: boolean,
): number {
  const clerkFactor = clerkHired ? config.clerkIncomeMultiplier : 1;
  return (
    stall.baseIncomePerSec *
    config.incomeGrowthPerLevel ** (level - 1) *
    milestoneMultiplier(config, level) *
    clerkFactor
  );
}

/** GDD §4.4 升級成本：`floor(upgradeCostBase × upgradeCostGrowth^(level-1))`，成本一律是整數。 */
export function upgradeCostOf(stall: StallDefinition, level: number): number {
  return Math.floor(stall.upgradeCostBase * stall.upgradeCostGrowth ** (level - 1));
}

/** GDD §4.3 前景計入條件：`unlocked && (clerkHired || selling)`。 */
export function countsInForeground(stall: StallState): boolean {
  return stall.unlocked && (stall.clerkHired || stall.selling);
}

/** GDD §4.3 離線計入條件：`unlocked && clerkHired`（手動開賣不計）。 */
export function countsInOffline(stall: StallState): boolean {
  return stall.unlocked && stall.clerkHired;
}

/** GDD §4.3 前景速率（`GameSnapshot.incomePerSec`）。 */
export function foregroundRate(config: BalanceConfig, state: GameState): number {
  let total = 0;
  for (const def of config.stalls) {
    const stall = state.stalls[def.id];
    if (!stall || !countsInForeground(stall)) continue;
    total += stallIncomePerSec(config, def, stall.level, stall.clerkHired);
  }
  return total;
}

/** GDD §4.3 離線速率（只算有店員的攤位）。 */
export function offlineRate(config: BalanceConfig, state: GameState): number {
  let total = 0;
  for (const def of config.stalls) {
    const stall = state.stalls[def.id];
    if (!stall || !countsInOffline(stall)) continue;
    total += stallIncomePerSec(config, def, stall.level, stall.clerkHired);
  }
  return total;
}

/** 一次結算的期望值（GDD §4.6）。 */
export interface ExpectedSettle {
  readonly gained: number;
  readonly elapsedMs: number;
  readonly creditedMs: number;
  readonly capped: boolean;
  readonly timeWentBackwards: boolean;
  readonly lastSettledAt: number;
  /** 實際採用的結算模式（長空檔會從 foreground 轉成 offline）。 */
  readonly effectiveMode: SettleMode;
}

/**
 * GDD v1.1 §4.6：前景長空檔自動轉離線。
 *
 * `effectiveMode = (requested === 'foreground' && elapsedMs > maxGapMs) ? 'offline' : requested`
 *
 * 這條規則是 v1.1 對「離線上限 4h 被前景結算繞過」這個風險的修補：
 * 分頁凍結／睡眠／玩家把時鐘往前調時，下一次前景結算會用離線規則（只計店員、套上限）。
 */
export function effectiveSettleMode(
  config: BalanceConfig,
  elapsedMs: number,
  requested: SettleMode,
): SettleMode {
  const maxGapMs = config.foreground.maxGapSeconds * MS_PER_SEC;
  if (requested === 'foreground' && elapsedMs > maxGapMs) return 'offline';
  return requested;
}

/**
 * GDD §4.6 結算：
 * - `elapsedMs = now - lastSettledAt`
 * - 時鐘倒退 → gained/elapsedMs/creditedMs 都 0、capped false、timeWentBackwards true、`lastSettledAt` 對齊到 now
 * - 前景長空檔（v1.1）→ 這次改用離線規則（只計店員、套 4h 上限）
 * - 離線套 4h 上限；前景不套上限
 * - `gained = rate × creditedMs / 1000`（rate 用結算當下的等級與店員狀態）
 */
export function expectedSettle(
  config: BalanceConfig,
  state: GameState,
  now: number,
  mode: SettleMode,
): ExpectedSettle {
  const elapsedMs = now - state.lastSettledAt;

  if (elapsedMs < 0) {
    return {
      gained: 0,
      elapsedMs: 0,
      creditedMs: 0,
      capped: false,
      timeWentBackwards: true,
      lastSettledAt: now,
      effectiveMode: mode,
    };
  }

  const effectiveMode = effectiveSettleMode(config, elapsedMs, mode);
  const rate = effectiveMode === 'offline' ? offlineRate(config, state) : foregroundRate(config, state);
  const capMs = config.offline.capSeconds * MS_PER_SEC;
  const creditedMs = effectiveMode === 'offline' ? Math.min(elapsedMs, capMs) : elapsedMs;
  const capped = effectiveMode === 'offline' && elapsedMs > capMs;

  return {
    gained: (rate * creditedMs) / MS_PER_SEC,
    elapsedMs,
    creditedMs,
    capped,
    timeWentBackwards: false,
    lastSettledAt: now,
    effectiveMode,
  };
}

/**
 * GDD §5.1 快照的里程碑欄位。
 * `nextMilestone` = 第一個 `level > 目前等級` 的里程碑；沒有 → null。
 * `progress` = `clamp((level - prev) / (next.level - prev), 0, 1)`，`prev` = 前一個已達成的里程碑等級（第一段用 0）。
 */
export function expectedMilestoneView(
  config: BalanceConfig,
  level: number,
): MilestoneView | null {
  const sorted = [...config.milestones].sort((a, b) => a.level - b.level);
  const next = sorted.find((m) => m.level > level);
  if (!next) return null;
  const prev = sorted.filter((m) => m.level <= level).at(-1);
  const base = prev ? prev.level : 0;
  const width = next.level - base;
  const progress = width <= 0 ? 0 : Math.min(1, Math.max(0, (level - base) / width));
  return { level: next.level, multiplier: next.multiplier, progress };
}

/**
 * GDD §9 的浮點比較容差：
 * `|actual - expected| <= max(1e-6, |expected| × 1e-9)`
 *
 * 成本（整數）與 `creditedMs`（整數）另外用 `===` 斷言，不走這個容差。
 */
export function withinTolerance(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-9);
}
