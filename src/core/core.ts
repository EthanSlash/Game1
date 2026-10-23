/**
 * 純函式層實作：`createCore(config)` 產生 `NightMarketCore`（型別見 `./api`）。
 *
 * 規則（repo AGENTS.md 硬規則 1、2）：
 * - 不碰 DOM / window / localStorage，不呼叫 `Date.now()`；時間一律由參數注入。
 * - 所有遊戲數值都從傳入的 `BalanceConfig`（= `data/balance.json`）讀，程式不寫死。
 * - 每個方法都不修改傳入的 state，只回傳新物件；失敗時回傳**同一個** state 參考。
 *
 * 公式對照：`docs/GDD.md` §4（收益、里程碑、成本、結算）、§5（動作）、§5.1（快照）。
 */

import type {
  ActionFailure,
  ActionResult,
  BalanceConfig,
  GameSnapshot,
  GameState,
  MilestoneView,
  NightMarketCore,
  SettleMode,
  SettleResult,
  StallDefinition,
  StallId,
  StallSnapshot,
  StallState,
  TimestampMs,
} from './api';
import { loadSave, serializeSave } from './save';
import { msToSeconds, secondsToMs } from './time';

/** 未解鎖攤位的預設狀態（GDD §3 不變式 1）。 */
function defaultStallState(): StallState {
  return { level: 0, unlocked: false, clerkHired: false, selling: false };
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function failed(reason: ActionFailure, state: GameState): ActionResult {
  return { ok: false, reason, state };
}

export function createCore(config: BalanceConfig): NightMarketCore {
  const definitions = new Map<StallId, StallDefinition>(config.stalls.map((def) => [def.id, def]));
  /** 離線收益上限（毫秒）：設定值是秒，換算只走 `secondsToMs`（GDD §1 時間單位鐵則）。 */
  const capMs = secondsToMs(config.offline.capSeconds);
  /** 前景長空檔門檻（毫秒）：設定值是秒（GDD §4.6）。 */
  const maxGapMs = secondsToMs(config.foreground.maxGapSeconds);

  function definitionOf(id: StallId): StallDefinition | undefined {
    return definitions.get(id);
  }

  function stateOf(state: GameState, id: StallId): StallState | undefined {
    return state.stalls[id];
  }

  /** GDD §4.1：里程碑倍率累乘（不是取最高一檔）。 */
  function milestoneMultiplier(level: number): number {
    let multiplier = 1;
    for (const milestone of config.milestones) {
      if (level >= milestone.level) multiplier *= milestone.multiplier;
    }
    return multiplier;
  }

  /** GDD §4.2：單一攤位的每秒收益（浮點，不取整）。 */
  function stallIncomePerSec(def: StallDefinition, level: number, clerkHired: boolean): number {
    const levelFactor = Math.pow(config.incomeGrowthPerLevel, level - 1);
    const clerkFactor = clerkHired ? config.clerkIncomeMultiplier : 1;
    return def.baseIncomePerSec * levelFactor * milestoneMultiplier(level) * clerkFactor;
  }

  /** GDD §4.4：下一級的升級成本；已達上限回 `null`。 */
  function upgradeCostOf(def: StallDefinition, level: number): number | null {
    if (def.maxLevel !== null && level >= def.maxLevel) return null;
    return Math.floor(def.upgradeCostBase * Math.pow(def.upgradeCostGrowth, level - 1));
  }

  /** GDD §4.3：這個攤位在這一次結算是否計入收益。 */
  function countsTowardIncome(stall: StallState, mode: SettleMode): boolean {
    if (!stall.unlocked) return false;
    return mode === 'foreground' ? stall.clerkHired || stall.selling : stall.clerkHired;
  }

  /**
   * GDD §5.1：動作還差多少錢。錢夠回 `0`（不是 `null`），差額不取整。
   * 「不可行且原因不是錢」由呼叫端回 `null`。
   */
  function shortfallOf(cost: number, balance: number): number {
    const missing = cost - balance;
    return missing > 0 ? missing : 0;
  }

  /** GDD §4.3：整頁在該模式下的每秒速率。 */
  function ratePerSec(state: GameState, mode: SettleMode): number {
    let total = 0;
    for (const def of config.stalls) {
      const stall = stateOf(state, def.id);
      if (stall === undefined || !countsTowardIncome(stall, mode)) continue;
      total += stallIncomePerSec(def, stall.level, stall.clerkHired);
    }
    return total;
  }

  /** GDD §5.1：下一個尚未達成的里程碑與進度。 */
  function nextMilestoneOf(level: number): MilestoneView | null {
    const index = config.milestones.findIndex((milestone) => milestone.level > level);
    if (index < 0) return null;

    const next = config.milestones[index];
    if (next === undefined) return null;
    const previous = index === 0 ? undefined : config.milestones[index - 1];
    const previousLevel = previous === undefined ? 0 : previous.level;
    const span = next.level - previousLevel;
    const progress = span <= 0 ? 1 : clamp01((level - previousLevel) / span);

    return { level: next.level, multiplier: next.multiplier, progress };
  }

  return {
    config,

    createInitialState(now: TimestampMs): GameState {
      const stalls: Record<StallId, StallState> = {};
      config.stalls.forEach((def, index) => {
        // GDD §3 不變式 3：第一攤開局即解鎖 Lv1、未開賣、無店員。
        const unlocked = index === 0;
        stalls[def.id] = {
          level: unlocked ? 1 : 0,
          unlocked,
          clerkHired: false,
          selling: false,
        };
      });
      return {
        saveVersion: config.save.currentVersion,
        balance: config.startingBalance,
        stalls,
        lastSettledAt: now,
      };
    },

    snapshot(state: GameState): GameSnapshot {
      let anyClerkHired = false;

      const stalls: StallSnapshot[] = config.stalls.map((def, index) => {
        const stall = stateOf(state, def.id) ?? defaultStallState();
        if (stall.clerkHired) anyClerkHired = true;

        const previous = index === 0 ? undefined : config.stalls[index - 1];
        // GDD §4.5：解鎖鏈只看前一攤（第一攤沒有前置）。
        const previousUnlocked =
          index === 0 ? true : previous !== undefined && stateOf(state, previous.id)?.unlocked === true;
        const upgradeCost = stall.unlocked ? upgradeCostOf(def, stall.level) : null;
        const counts = stall.unlocked && (stall.clerkHired || stall.selling);
        const canToggleSell = stall.unlocked && !stall.clerkHired;
        const canHire = canToggleSell && state.balance >= def.hireCost;

        return {
          id: def.id,
          name: def.name,
          emoji: def.emoji,
          unlocked: stall.unlocked,
          level: stall.level,
          incomePerSec: counts ? stallIncomePerSec(def, stall.level, stall.clerkHired) : 0,
          clerkHired: stall.clerkHired,
          selling: stall.selling,
          unlockCost: stall.unlocked ? null : def.unlockCost,
          upgradeCost,
          hireCost: stall.unlocked && !stall.clerkHired ? def.hireCost : null,
          canUnlock: !stall.unlocked && previousUnlocked && state.balance >= def.unlockCost,
          canUpgrade: upgradeCost !== null && state.balance >= upgradeCost,
          canHire,
          canToggleSell,
          shortfall: {
            // 已解鎖或解鎖鏈前提不成立 → null：有錢也不能解鎖，不該顯示「還差多少」。
            unlock:
              stall.unlocked || !previousUnlocked
                ? null
                : shortfallOf(def.unlockCost, state.balance),
            upgrade: upgradeCost === null ? null : shortfallOf(upgradeCost, state.balance),
            hire: canToggleSell ? shortfallOf(def.hireCost, state.balance) : null,
          },
          // 雇用預覽：只算「還沒雇」的已解鎖攤位；含里程碑與店員倍率（GDD §4.1／§4.2）。
          incomePerSecIfHired: canToggleSell ? stallIncomePerSec(def, stall.level, true) : null,
          nextMilestone: nextMilestoneOf(stall.level),
        };
      });

      return {
        balance: state.balance,
        incomePerSec: ratePerSec(state, 'foreground'),
        anyClerkHired,
        stalls,
        lastSettledAt: state.lastSettledAt,
      };
    },

    upgrade(state: GameState, stallId: StallId): ActionResult {
      const def = definitionOf(stallId);
      const stall = stateOf(state, stallId);
      if (def === undefined || stall === undefined) return failed('no-such-stall', state);
      if (!stall.unlocked) return failed('stall-locked', state);

      const cost = upgradeCostOf(def, stall.level);
      if (cost === null) return failed('max-level', state);
      if (state.balance < cost) return failed('insufficient-funds', state);

      return {
        ok: true,
        spent: cost,
        state: {
          ...state,
          balance: state.balance - cost,
          stalls: { ...state.stalls, [stallId]: { ...stall, level: stall.level + 1 } },
        },
      };
    },

    hire(state: GameState, stallId: StallId): ActionResult {
      const def = definitionOf(stallId);
      const stall = stateOf(state, stallId);
      if (def === undefined || stall === undefined) return failed('no-such-stall', state);
      if (!stall.unlocked) return failed('stall-locked', state);
      if (stall.clerkHired) return failed('clerk-already-hired', state);
      if (state.balance < def.hireCost) return failed('insufficient-funds', state);

      return {
        ok: true,
        spent: def.hireCost,
        state: {
          ...state,
          balance: state.balance - def.hireCost,
          stalls: { ...state.stalls, [stallId]: { ...stall, clerkHired: true } },
        },
      };
    },

    unlock(state: GameState, stallId: StallId): ActionResult {
      const def = definitionOf(stallId);
      const stall = stateOf(state, stallId);
      if (def === undefined || stall === undefined) return failed('no-such-stall', state);
      if (stall.unlocked) return failed('already-unlocked', state);

      // GDD §4.5：必須依序解鎖（前一攤未解鎖就用 stall-locked）。
      const index = config.stalls.findIndex((candidate) => candidate.id === stallId);
      const previous = index <= 0 ? undefined : config.stalls[index - 1];
      if (previous !== undefined && stateOf(state, previous.id)?.unlocked !== true) {
        return failed('stall-locked', state);
      }
      if (state.balance < def.unlockCost) return failed('insufficient-funds', state);

      return {
        ok: true,
        spent: def.unlockCost,
        state: {
          ...state,
          balance: state.balance - def.unlockCost,
          stalls: {
            ...state.stalls,
            // GDD §3 不變式 4：解鎖即 Lv1、未開賣、無店員。
            [stallId]: { level: 1, unlocked: true, clerkHired: false, selling: false },
          },
        },
      };
    },

    toggleSell(state: GameState, stallId: StallId): ActionResult {
      const stall = stateOf(state, stallId);
      if (definitionOf(stallId) === undefined || stall === undefined) return failed('no-such-stall', state);
      if (!stall.unlocked) return failed('stall-locked', state);
      if (stall.clerkHired) return failed('clerk-already-hired', state);

      return {
        ok: true,
        spent: 0,
        state: {
          ...state,
          stalls: { ...state.stalls, [stallId]: { ...stall, selling: !stall.selling } },
        },
      };
    },

    settle(state: GameState, now: TimestampMs, mode: SettleMode): SettleResult {
      const elapsedMs = now - state.lastSettledAt;

      // GDD §4.6 第 2 點：時鐘倒退 → 不給收益、不扣錢，水位線對齊 now。
      if (elapsedMs < 0) {
        return {
          state: { ...state, lastSettledAt: now },
          gained: 0,
          elapsedMs: 0,
          creditedMs: 0,
          capped: false,
          timeWentBackwards: true,
        };
      }

      // GDD §4.6：前景長空檔一律改用離線規則（只計店員、套上限）。
      const effectiveMode: SettleMode =
        mode === 'foreground' && elapsedMs > maxGapMs ? 'offline' : mode;

      let creditedMs = elapsedMs;
      let capped = false;
      if (effectiveMode === 'offline') {
        creditedMs = Math.min(elapsedMs, capMs);
        capped = elapsedMs > capMs;
      }

      // GDD §4.6：gained = rate(每秒) × creditedMs / 1000；換算只走 `time.ts`（§1 時間單位鐵則）。
      const gained = ratePerSec(state, effectiveMode) * msToSeconds(creditedMs);

      return {
        state: { ...state, balance: state.balance + gained, lastSettledAt: now },
        gained,
        elapsedMs,
        creditedMs,
        capped,
        timeWentBackwards: false,
      };
    },

    serialize(state: GameState, now: TimestampMs): string {
      return serializeSave(config, state, now);
    },

    load(raw: string | null) {
      return loadSave(config, raw);
    },
  };
}
