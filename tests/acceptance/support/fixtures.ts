/**
 * 驗收用的狀態建構輔助。
 *
 * 原則：**能用公開 API 走出來的狀態，就不要手刻**。
 * 手刻 `GameState` 會讓測試把自己的假設帶進實作（例如「實作其實不認這個欄位」就看不出來），
 * 所以這裡的建構都走 `createInitialState` → `toggleSell` → `settle` 這條公開路徑；
 * 只有「正常玩不到」的邊界狀態（例如 Lv150 上限）才手刻，並在該處註明。
 */
import type {
  BalanceConfig,
  EngineFrame,
  GameEngine,
  GameSnapshot,
  GameState,
  NightMarketCore,
  StallSnapshot,
  StallState,
} from './types';

/** 取攤位狀態；沒有就拋錯（測試寫錯 id 時要立刻看到）。 */
export function stallOf(state: GameState, id: string): StallState {
  const stall = state.stalls[id];
  if (!stall) throw new Error(`測試用的 state 沒有攤位「${id}」`);
  return stall;
}

/** 取快照裡的攤位；沒有就拋錯。 */
export function snapStall(snapshot: GameSnapshot, id: string): StallSnapshot {
  const stall = snapshot.stalls.find((s) => s.id === id);
  if (!stall) throw new Error(`快照裡沒有攤位「${id}」`);
  return stall;
}

/** 開新局的攤位狀態（GDD §3 不變式 3：第一攤 Lv1 已解鎖，其餘未解鎖 Lv0）。 */
export function initialStallStates(config: BalanceConfig): Record<string, StallState> {
  const states: Record<string, StallState> = {};
  config.stalls.forEach((def, index) => {
    states[def.id] = {
      level: index === 0 ? 1 : 0,
      unlocked: index === 0,
      clerkHired: false,
      selling: false,
    };
  });
  return states;
}

/**
 * 手刻狀態 —— 只給「正常玩不到」的邊界案例用（例如等級上限、極端餘額）。
 * 用到的地方必須在註解說明為什麼走不到。
 */
export function handBuiltState(
  config: BalanceConfig,
  options: {
    readonly balance: number;
    readonly lastSettledAt: number;
    readonly stalls?: Readonly<Record<string, Partial<StallState>>>;
    readonly saveVersion?: number;
  },
): GameState {
  const base = initialStallStates(config);
  const stalls: Record<string, StallState> = {};
  for (const def of config.stalls) {
    const patch = options.stalls?.[def.id];
    const origin = base[def.id];
    if (!origin) continue;
    stalls[def.id] = {
      level: patch?.level ?? origin.level,
      unlocked: patch?.unlocked ?? origin.unlocked,
      clerkHired: patch?.clerkHired ?? origin.clerkHired,
      selling: patch?.selling ?? origin.selling,
    };
  }
  return {
    saveVersion: options.saveVersion ?? config.save.currentVersion,
    balance: options.balance,
    stalls,
    lastSettledAt: options.lastSettledAt,
  };
}

/** 純函式層：手動開賣（開局第一個動作，GDD §3 不變式 5）。 */
export function sellStall(core: NightMarketCore, state: GameState, id: string): GameState {
  const result = core.toggleSell(state, id);
  if (!result.ok) {
    throw new Error(`toggleSell(${id}) 失敗：${result.reason}`);
  }
  return result.state;
}

/**
 * 純函式層：前景結算，賺到指定金額。
 *
 * ⚠️ GDD v1.1 §4.6：單次前景結算的 `elapsedMs` 超過 `foreground.maxGapSeconds` 時，
 * 這次會自動改用**離線規則**（只計店員、套 4h 上限）——手動開賣的攤位就賺不到錢。
 * 實機是每 250ms tick 一次，所以這裡也**分段**結算（每段不超過門檻），
 * 才等價於真實遊戲過程。分段後的總收益與「一次前景結算」相同（速率不變、無上限）。
 */
export function earn(core: NightMarketCore, state: GameState, elapsedMs: number): GameState {
  if (!Number.isInteger(elapsedMs)) {
    throw new Error(`earn 的 elapsedMs 必須是整數毫秒，收到 ${elapsedMs}`);
  }
  const step = foregroundStepMs(core.config);
  let current = state;
  let remaining = elapsedMs;
  while (remaining > 0) {
    const chunk = Math.min(step, remaining);
    const result = core.settle(current, current.lastSettledAt + chunk, 'foreground');
    current = result.state;
    remaining -= chunk;
  }
  return current;
}

/**
 * 門面層：從 `from` 一路 tick 到 `to`（分段，避免長空檔觸發離線規則）。
 * 回傳最後一格 frame 給需要看彈窗的測試。
 */
export function tickOver(
  engine: GameEngine,
  from: number,
  to: number,
  config: BalanceConfig,
): EngineFrame {
  const step = foregroundStepMs(config);
  let frame: EngineFrame | null = null;
  let cursor = from;
  while (cursor < to) {
    const next = Math.min(cursor + step, to);
    frame = engine.tick(next);
    cursor = next;
  }
  return frame ?? engine.tick(to);
}

/** 前景結算可以安全使用的單段長度（毫秒）：不超過 v1.1 的長空檔門檻。 */
export function foregroundStepMs(config: BalanceConfig): number {
  return Math.max(1, Math.floor(config.foreground.maxGapSeconds * 1000));
}

/** 純函式層：升級，回傳新狀態；失敗就拋錯。 */
export function upgradeTo(core: NightMarketCore, state: GameState, id: string): GameState {
  const result = core.upgrade(state, id);
  if (!result.ok) throw new Error(`upgrade(${id}) 失敗：${result.reason}`);
  return result.state;
}

/** 純函式層：雇用店員，回傳新狀態；失敗就拋錯。 */
export function hireClerk(core: NightMarketCore, state: GameState, id: string): GameState {
  const result = core.hire(state, id);
  if (!result.ok) throw new Error(`hire(${id}) 失敗：${result.reason}`);
  return result.state;
}

/** 純函式層：解鎖攤位，回傳新狀態；失敗就拋錯。 */
export function unlockStall(core: NightMarketCore, state: GameState, id: string): GameState {
  const result = core.unlock(state, id);
  if (!result.ok) throw new Error(`unlock(${id}) 失敗：${result.reason}`);
  return result.state;
}
