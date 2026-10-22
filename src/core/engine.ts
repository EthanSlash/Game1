/**
 * 有狀態門面：`createGameEngine(config)` 產生 UI 唯一會碰的 `GameEngine`（型別見 `./api`）。
 *
 * 責任邊界（GDD §6）：
 * - 持有唯一可信的 `GameState`，所有入口都只透過純函式層改狀態。
 * - 時間一律由參數注入（毫秒），引擎不呼叫 `Date.now()`、不碰 localStorage。
 * - 動作先 `settle(now, 'foreground')` 再執行（GDD §5）。
 * - `onHidden` 之後、`onVisible` 之前的 `tick` 一律忽略，避免與離線結算重複計入。
 */

import type {
  ActionResult,
  BalanceConfig,
  EngineFrame,
  GameEngine,
  GameSnapshot,
  GameState,
  LoadFailureReason,
  NightMarketCore,
  OfflineSettlement,
  SettleMode,
  SettleResult,
  StallId,
  TimestampMs,
} from './api';
import { createCore } from './core';
import { secondsToMs } from './time';

/** 只有真的入帳才回傳離線結算資訊（GDD §6：`gained === 0` 不跳彈窗）。 */
function offlineOf(result: SettleResult): OfflineSettlement | null {
  if (!(result.gained > 0)) return null;
  return {
    gained: result.gained,
    creditedMs: result.creditedMs,
    capped: result.capped,
    timeWentBackwards: result.timeWentBackwards,
  };
}

export function createGameEngine(config: BalanceConfig): GameEngine {
  const core: NightMarketCore = createCore(config);
  /** 前景長空檔門檻（毫秒）；與 core 用同一個換算函式（GDD §4.6）。 */
  const maxGapMs = secondsToMs(config.foreground.maxGapSeconds);
  /** `init` 之前的佔位狀態；UI 一定先呼叫 `init`，這裡只是避免 `state()` 沒有東西可回。 */
  let state: GameState = core.createInitialState(0);
  /** 是否在背景（`onHidden` 之後、`onVisible` 之前）。 */
  let hidden = false;

  function frame(offline: OfflineSettlement | null, loadError: LoadFailureReason | null): EngineFrame {
    return { snapshot: core.snapshot(state), offline, loadError };
  }

  function advance(now: TimestampMs, mode: SettleMode): SettleResult {
    const result = core.settle(state, now, mode);
    state = result.state;
    return result;
  }

  /** 動作共用流程：先結算到 `now`，成功才採用新狀態（GDD §5）。 */
  function act(
    stallId: StallId,
    now: TimestampMs,
    action: (current: GameState, id: StallId) => ActionResult,
  ): boolean {
    advance(now, 'foreground');
    const result = action(state, stallId);
    if (!result.ok) return false;
    state = result.state;
    return true;
  }

  return {
    init(now: TimestampMs, savedState: string | null): EngineFrame {
      let loadError: LoadFailureReason | null = null;

      if (savedState === null) {
        // GDD §6：沒有存檔是正常首啟，不算錯誤。
        state = core.createInitialState(now);
      } else {
        const loaded = core.load(savedState);
        if (loaded.ok) {
          state = loaded.state;
        } else {
          // 讀檔失敗不擋遊戲：開新局並回報原因，既有存檔不由 core 覆寫。
          state = core.createInitialState(now);
          loadError = loaded.reason;
        }
      }

      hidden = false;
      return frame(offlineOf(advance(now, 'offline')), loadError);
    },

    tick(now: TimestampMs): EngineFrame {
      // GDD §6：背景期間的 tick 一律忽略（不結算、不改狀態）。
      if (hidden) return frame(null, null);
      const result = advance(now, 'foreground');
      // 一般前景結算不跳彈窗；只有前景長空檔自動轉離線的入帳才帶 offline（GDD §4.6）。
      return frame(result.elapsedMs > maxGapMs ? offlineOf(result) : null, null);
    },

    onHidden(now: TimestampMs): void {
      advance(now, 'foreground');
      hidden = true;
    },

    onVisible(now: TimestampMs): EngineFrame {
      hidden = false;
      return frame(offlineOf(advance(now, 'offline')), null);
    },

    upgrade(stallId: StallId, now: TimestampMs): boolean {
      return act(stallId, now, (current, id) => core.upgrade(current, id));
    },

    hire(stallId: StallId, now: TimestampMs): boolean {
      return act(stallId, now, (current, id) => core.hire(current, id));
    },

    unlock(stallId: StallId, now: TimestampMs): boolean {
      return act(stallId, now, (current, id) => core.unlock(current, id));
    },

    toggleSell(stallId: StallId, now: TimestampMs): boolean {
      return act(stallId, now, (current, id) => core.toggleSell(current, id));
    },

    save(now: TimestampMs): string {
      return core.serialize(state, now);
    },

    state(): GameSnapshot {
      return core.snapshot(state);
    },
  };
}
