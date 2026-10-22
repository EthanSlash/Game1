import { describe, expect, it } from 'vitest';

import { BALANCE } from './support/balance';
import { handBuiltState, tickOver } from './support/fixtures';
import { HARNESS, freshEngine, requireCore } from './support/harness';
import { expectedSettle, withinTolerance } from './support/oracle';
import type { GameEngine } from './support/types';

/**
 * E. 水位線與背景回來不重複計算（GDD v1.1 §4.6、§6、§9 E1–E2）。
 *
 * 核心不變式：**任何結算都只從 `lastSettledAt` 起算**。
 * 前景結算（tick）、隱藏時結算（onHidden）、離線結算（onVisible）三條路徑
 * 加起來，玩家待過的每一段時間只能被算一次。
 */
const CHICKEN = 'chicken-steak';

/** 測試用起點（epoch 毫秒）。 */
const T0 = 1_700_000_000_000;

/** 雞排 Lv1 有店員時的速率：1 × 1.25 = 1.25 元/秒。 */
const CLERK_RATE = 1.25;

const describeCore = HARNESS.core === null ? describe.skip : describe;
const describeEngine = HARNESS.engine === null ? describe.skip : describe;

describeCore('E 水位線（純函式層，GDD §4.6）', () => {
  it('E0 冪等：同一個 now 連續結算兩次，第二次 gained = 0', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });

    const first = core.settle(state, T0 + 10_000, 'foreground');
    expect(withinTolerance(first.gained, 12.5)).toBe(true);
    expect(first.state.lastSettledAt).toBe(T0 + 10_000);

    const second = core.settle(first.state, T0 + 10_000, 'foreground');
    expect(second.gained).toBe(0);
    expect(second.elapsedMs).toBe(0);
    expect(second.creditedMs).toBe(0);
    expect(second.state.balance).toBe(first.state.balance);
  });

  it('E0 結算只從 lastSettledAt 起算（不是從開局時間）', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });

    const first = core.settle(state, T0 + 10_000, 'foreground');
    const second = core.settle(first.state, T0 + 20_000, 'foreground');

    // 10 秒 + 10 秒 = 20 秒 × 1.25 = 25，不是 20 秒 × 1.25（後者重複算了第一段）。
    expect(withinTolerance(second.gained, 12.5)).toBe(true);
    expect(withinTolerance(second.state.balance, 25)).toBe(true);
  });
});

describeEngine('E 背景回來不重複計算（門面層，GDD §6、§9 E1–E2）', () => {
  /** 準備一個「有店員」的引擎：先賺 150 元、僱用店員，餘額歸零。 */
  function engineWithClerk(): GameEngine {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);
    tickOver(engine, T0, T0 + 150_000, BALANCE);
    if (!engine.hire(CHICKEN, T0 + 150_000)) throw new Error('hire 應該成功');
    return engine;
  }

  it('E1 前景 + 離線 各算各的，總額不重複', () => {
    const engine = engineWithClerk();
    expect(engine.state().balance).toBe(0);

    // 前景 10 秒：有店員 → 1.25/秒 → 12.5。
    engine.tick(T0 + 160_000);
    expect(withinTolerance(engine.state().balance, 12.5)).toBe(true);

    engine.onHidden(T0 + 160_000);

    // 離線 600 秒：只有店員算 → 1.25 × 600 = 750。
    const frame = engine.onVisible(T0 + 760_000);
    expect(frame.offline).not.toBeNull();
    expect(withinTolerance(frame.offline?.gained ?? NaN, 750)).toBe(true);
    expect(withinTolerance(engine.state().balance, 762.5)).toBe(true);
  });

  it('E1 總收益 = 前景區間 + 離線區間，沒有第三段', () => {
    const engine = engineWithClerk();

    engine.tick(T0 + 160_000);
    engine.onHidden(T0 + 160_000);
    engine.onVisible(T0 + 760_000);

    // 前景 [T0, T0+150s] 是 1/秒（還沒僱店員）→ 150；僱用後歸零。
    // [T0+150s, T0+160s] 前景 1.25/秒 → 12.5；[T0+160s, T0+760s] 離線 1.25/秒 → 750。
    const expected = 12.5 + 750;
    expect(withinTolerance(engine.state().balance, expected)).toBe(true);
  });

  it('E1 onHidden 之後、onVisible 之前的 tick 一律忽略（GDD §6）', () => {
    const engine = engineWithClerk();
    engine.tick(T0 + 160_000);
    engine.onHidden(T0 + 160_000);
    const before = engine.state();

    // 背景中的 tick 不該結算（否則會跟離線結算重複）。
    engine.tick(T0 + 400_000);
    expect(engine.state().balance).toBe(before.balance);
    expect(engine.state().lastSettledAt).toBe(before.lastSettledAt);

    const frame = engine.onVisible(T0 + 400_000);
    // 離線區間 = [T0+160s, T0+400s] = 240 秒 × 1.25 = 300。
    expect(withinTolerance(frame.offline?.gained ?? NaN, 300)).toBe(true);
    expect(withinTolerance(engine.state().balance, 12.5 + 300)).toBe(true);
  });

  it('E2 連續兩次 onVisible：第二次沒有收益、不跳彈窗', () => {
    const engine = engineWithClerk();
    engine.onHidden(T0 + 150_000);

    const first = engine.onVisible(T0 + 210_000);
    expect(first.offline).not.toBeNull();
    expect(withinTolerance(first.offline?.gained ?? NaN, 60 * CLERK_RATE)).toBe(true);

    const second = engine.onVisible(T0 + 210_000);
    expect(second.offline).toBeNull();
    expect(withinTolerance(engine.state().balance, 60 * CLERK_RATE)).toBe(true);
  });

  it('前景時鐘倒退：不給收益、不扣錢，水位線對齊到 now', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);
    engine.tick(T0 + 10_000);
    const before = engine.state();

    const frame = engine.tick(T0 + 5_000); // 比上次結算早 5 秒

    expect(frame.offline).toBeNull();
    expect(engine.state().balance).toBe(before.balance);
    expect(engine.state().lastSettledAt).toBe(T0 + 5_000);
  });

  it('oracle 與實作的前景結算一致（含 v1.1 長空檔轉離線）', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });

    for (const elapsed of [0, 1_000, 10_000, 60_000, 90_000]) {
      const expected = expectedSettle(BALANCE, state, T0 + elapsed, 'foreground');
      const actual = core.settle(state, T0 + elapsed, 'foreground');
      expect(actual.elapsedMs).toBe(expected.elapsedMs);
      expect(actual.creditedMs).toBe(expected.creditedMs);
      expect(actual.capped).toBe(expected.capped);
      expect(withinTolerance(actual.gained, expected.gained)).toBe(true);
    }
  });
});
