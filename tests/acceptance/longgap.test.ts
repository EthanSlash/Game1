import { describe, expect, it } from 'vitest';

import { BALANCE } from './support/balance';
import { handBuiltState, tickOver } from './support/fixtures';
import { HARNESS, freshEngine, requireCore } from './support/harness';
import { effectiveSettleMode, expectedSettle, withinTolerance } from './support/oracle';

/**
 * C6 / C7 —— GDD v1.1 §4.6「前景長空檔自動轉離線」。
 *
 * 這是 v1.1 專門修的風險：原本前景結算沒有上限，玩家把時鐘往前調、
 * 或分頁凍結／電腦睡眠沒觸發 `visibilitychange`，下一次前景結算就會用
 * 前景速率一次補上全部時間 —— 等於把「離線上限 4 小時」整個繞過。
 *
 * 規則：`elapsedMs > foreground.maxGapSeconds × 1000` 時，這次前景結算
 * 一律改用離線規則（只計店員、套 `offline.capSeconds` 上限）。
 *
 * 怎麼分辨「用離線規則」而不是「用前景規則」？
 * **用手動開賣、沒有店員的攤位**：前景規則算它（1/秒），離線規則不算它（0/秒）。
 */
const CHICKEN = 'chicken-steak';

/** 測試用起點（epoch 毫秒）。 */
const T0 = 1_700_000_000_000;

/** 前景長空檔門檻（毫秒）。 */
const MAX_GAP_MS = BALANCE.foreground.maxGapSeconds * 1000;

/** 離線上限（毫秒）。 */
const CAP_MS = BALANCE.offline.capSeconds * 1000;

const describeCore = HARNESS.core === null ? describe.skip : describe;
const describeEngine = HARNESS.engine === null ? describe.skip : describe;

describeCore('C6 前景長空檔（純函式層，GDD §4.6）', () => {
  it('門檻內（<= maxGapMs）走前景規則：手動開賣的攤位有收益', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, selling: true } },
    });

    const result = core.settle(state, T0 + MAX_GAP_MS, 'foreground');

    expect(result.elapsedMs).toBe(MAX_GAP_MS);
    expect(result.creditedMs).toBe(MAX_GAP_MS);
    expect(result.capped).toBe(false);
    // 前景速率 1/秒 × 60 秒 = 60。
    expect(withinTolerance(result.gained, 60)).toBe(true);
  });

  it('超過門檻（> maxGapMs）改走離線規則：手動開賣的攤位不算收益', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, selling: true } },
    });

    const result = core.settle(state, T0 + MAX_GAP_MS + 1, 'foreground');

    // 離線速率 = 0（沒有店員）→ 這次入帳 0。
    expect(result.gained).toBe(0);
    expect(result.creditedMs).toBe(MAX_GAP_MS + 1);
    expect(result.capped).toBe(false);
  });

  it('超過門檻時有店員的攤位照算，而且套離線上限', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });

    const result = core.settle(state, T0 + MAX_GAP_MS + 1, 'foreground');

    // 離線速率 1.25/秒 × 60.001 秒 = 75.00125。
    expect(withinTolerance(result.gained, (1.25 * (MAX_GAP_MS + 1)) / 1000)).toBe(true);
    expect(result.capped).toBe(false);
  });

  it('長空檔超過離線上限：一律截斷到 4 小時（前景不能繞過上限）', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });

    const elapsed = CAP_MS + 3_600_000; // 4 小時 + 1 小時
    const result = core.settle(state, T0 + elapsed, 'foreground');

    expect(result.creditedMs).toBe(CAP_MS);
    expect(result.capped).toBe(true);
    // 1.25/秒 × 14400 秒 = 18000。
    expect(withinTolerance(result.gained, 18_000)).toBe(true);
  });

  it('oracle 的 effectiveMode 與規則一致', () => {
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, selling: true } },
    });

    expect(effectiveSettleMode(BALANCE, MAX_GAP_MS, 'foreground')).toBe('foreground');
    expect(effectiveSettleMode(BALANCE, MAX_GAP_MS + 1, 'foreground')).toBe('offline');
    expect(effectiveSettleMode(BALANCE, MAX_GAP_MS + 1, 'offline')).toBe('offline');

    const expected = expectedSettle(BALANCE, state, T0 + MAX_GAP_MS + 1, 'foreground');
    expect(expected.effectiveMode).toBe('offline');
    expect(expected.gained).toBe(0);
  });
});

describeEngine('C6 前景長空檔（tick 路徑，GDD §6）', () => {
  it('長空檔的 tick 帶離線彈窗資訊（frame.offline 有值）', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);
    // 先賺到有店員。
    tickOver(engine, T0, T0 + 150_000, BALANCE);
    if (!engine.hire(CHICKEN, T0 + 150_000)) throw new Error('hire 應該成功');

    // 之後空檔 90 秒 > 60 秒門檻 → 走離線規則。
    const frame = engine.tick(T0 + 150_000 + 90_000);

    expect(frame.offline).not.toBeNull();
    expect(frame.offline?.gained ?? 0).toBeGreaterThan(0);
    expect(frame.offline?.creditedMs).toBe(90_000);
    expect(frame.offline?.capped).toBe(false);
    // 1.25/秒 × 90 秒 = 112.5。
    expect(withinTolerance(frame.offline?.gained ?? NaN, 112.5)).toBe(true);
  });

  it('長空檔的 tick 會套離線上限', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);
    tickOver(engine, T0, T0 + 150_000, BALANCE);
    if (!engine.hire(CHICKEN, T0 + 150_000)) throw new Error('hire 應該成功');

    const frame = engine.tick(T0 + 150_000 + CAP_MS + 60_000);

    expect(frame.offline?.capped).toBe(true);
    expect(frame.offline?.creditedMs).toBe(CAP_MS);
    expect(withinTolerance(frame.offline?.gained ?? NaN, 18_000)).toBe(true);
  });

  it('門檻內的 tick 不會跳離線彈窗（frame.offline 為 null）', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);
    tickOver(engine, T0, T0 + 150_000, BALANCE);
    if (!engine.hire(CHICKEN, T0 + 150_000)) throw new Error('hire 應該成功');

    const frame = engine.tick(T0 + 150_000 + 30_000);

    expect(frame.offline).toBeNull();
    expect(withinTolerance(engine.state().balance, 37.5)).toBe(true);
  });
});

describeEngine('C7 前景長空檔（動作前結算，GDD §5、§9 C7）', () => {
  it('動作前結算也走離線規則：手動開賣的攤位在長空檔時沒有收益，動作因此失敗', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);

    // 空檔 90 秒 > 60 秒門檻 → 結算走離線規則（沒有店員 → 收益 0）。
    // 餘額 0 → 買不起 10 元的升級 → 動作失敗。
    expect(engine.upgrade(CHICKEN, T0 + 90_000)).toBe(false);
    expect(engine.state().balance).toBe(0);
  });

  it('門檻內的動作前結算走前景規則：收益入帳，動作成功', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);

    // 空檔 30 秒 <= 門檻 → 前景規則 → 30 元入帳 → 買得起 10 元的升級。
    expect(engine.upgrade(CHICKEN, T0 + 30_000)).toBe(true);
    expect(withinTolerance(engine.state().balance, 20)).toBe(true);
    expect(engine.state().stalls.find((s) => s.id === CHICKEN)?.level).toBe(2);
  });

  it('長空檔不影響動作本身的成敗判定：店員照雇得到', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);
    tickOver(engine, T0, T0 + 150_000, BALANCE);

    // 空檔 90 秒 → 結算走離線規則（沒有店員 → 收益 0），但「僱用店員」這件事本身
    // 還是照規則判定：餘額 150 >= hireCost 150 → 成功。
    expect(engine.hire(CHICKEN, T0 + 150_000 + 90_000)).toBe(true);
    expect(engine.state().stalls.find((s) => s.id === CHICKEN)?.clerkHired).toBe(true);
    expect(withinTolerance(engine.state().balance, 0)).toBe(true);
  });
});
