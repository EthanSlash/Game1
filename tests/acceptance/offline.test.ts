/**
 * 驗收 C（離線收益）：GDD §4.3、§4.6、§6 與 §9 的 C1–C5。
 *
 * 關鍵數字：離線上限 4 小時 = `balance.json` 的 `offline.capSeconds` = 14400 秒
 * = 14_400_000 毫秒；離線只算「有店員」的攤位。
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from './support/balance';
import { handBuiltState, stallOf, tickOver } from './support/fixtures';
import { HARNESS, freshEngine, requireCore } from './support/harness';
import { expectedSettle, withinTolerance } from './support/oracle';

const CHICKEN = 'chicken-steak';

/** 測試用起點（epoch 毫秒）。 */
const T0 = 1_700_000_000_000;

/** 離線上限（毫秒）。 */
const CAP_MS = BALANCE.offline.capSeconds * 1000;

/** 雞排 Lv1 有店員時的離線速率：1 × 1.25 = 1.25 元/秒。 */
const CLERK_RATE = 1.25;

const describeCore = HARNESS.core === null ? describe.skip : describe;
const describeEngine = HARNESS.engine === null ? describe.skip : describe;

/** 建一個「已雇店員」的存檔字串（用門面走真實流程產出，不手刻 JSON）。 */
function saveWithClerk(now: number): string {
  const engine = freshEngine();
  engine.init(T0, null);
  engine.toggleSell(CHICKEN, T0);
  // 分段 tick：空檔不得超過前景門檻（v1.1 §4.6），否則會改用離線規則而賺不到錢。
  tickOver(engine, T0, T0 + 150_000, BALANCE);
  if (!engine.hire(CHICKEN, T0 + 150_000)) throw new Error('hire 應該成功');
  return engine.save(now);
}

describeCore('C 離線收益（純函式層，GDD §4.6）', () => {
  it('C1 離線 0 秒：gained 0、elapsedMs 0、creditedMs 0', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 100,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });

    const result = core.settle(state, T0, 'offline');

    expect(result.gained).toBe(0);
    expect(result.elapsedMs).toBe(0);
    expect(result.creditedMs).toBe(0);
    expect(result.capped).toBe(false);
    expect(result.timeWentBackwards).toBe(false);
    expect(result.state.balance).toBe(100);
  });

  it('C2 剛好 4 小時：creditedMs === capSeconds × 1000、capped === false', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });

    const result = core.settle(state, T0 + CAP_MS, 'offline');

    expect(result.creditedMs).toBe(CAP_MS);
    expect(result.elapsedMs).toBe(CAP_MS);
    expect(result.capped).toBe(false);
    // 1.25 元/秒 × 14400 秒 = 18000。
    expect(withinTolerance(result.gained, 18_000)).toBe(true);
    expect(withinTolerance(result.gained, CLERK_RATE * BALANCE.offline.capSeconds)).toBe(true);
  });

  it('C3 超過 4 小時：只計 4 小時、capped === true', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });

    const result = core.settle(state, T0 + CAP_MS + 60_000, 'offline');

    expect(result.creditedMs).toBe(CAP_MS);
    expect(result.capped).toBe(true);
    expect(result.elapsedMs).toBe(CAP_MS + 60_000);
    expect(withinTolerance(result.gained, 18_000)).toBe(true);
  });

  it('C4 時鐘倒退：gained 0、不扣錢、水位線對齊到 now', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 500,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });

    const result = core.settle(state, T0 - 1_000, 'offline');

    expect(result.gained).toBe(0);
    expect(result.elapsedMs).toBe(0);
    expect(result.creditedMs).toBe(0);
    expect(result.capped).toBe(false);
    expect(result.timeWentBackwards).toBe(true);
    expect(result.state.balance).toBe(500); // 不得變小
    expect(result.state.lastSettledAt).toBe(T0 - 1_000); // 水位線對齊到 now
  });

  it('C5 連續倒退：不會累積負收益，餘額不變小', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 500,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });

    let current = state;
    for (const back of [1_000, 2_000, 3_000]) {
      const result = core.settle(current, T0 - back, 'offline');
      expect(result.gained).toBe(0);
      expect(result.timeWentBackwards).toBe(true);
      expect(result.state.balance).toBe(500);
      current = result.state;
    }

    // 倒退後水位線對齊到最後一次倒退的時間點，往前只補那一段。
    expect(current.lastSettledAt).toBe(T0 - 3_000);
    const forward = core.settle(current, T0 - 2_000, 'offline');
    expect(forward.timeWentBackwards).toBe(false);
    expect(forward.elapsedMs).toBe(1_000);
    expect(withinTolerance(forward.gained, CLERK_RATE)).toBe(true);
  });

  it('oracle 與實作的離線結算一致', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });

    for (const elapsed of [0, 1_000, CAP_MS, CAP_MS + 60_000]) {
      const expected = expectedSettle(BALANCE, state, T0 + elapsed, 'offline');
      const actual = core.settle(state, T0 + elapsed, 'offline');
      expect(actual.creditedMs).toBe(expected.creditedMs);
      expect(actual.capped).toBe(expected.capped);
      expect(actual.elapsedMs).toBe(expected.elapsedMs);
      expect(withinTolerance(actual.gained, expected.gained)).toBe(true);
    }
  });

  it('沒有店員時離線收益為 0（手動開賣不算）', () => {
    const core = requireCore();
    // 手動開賣中、但沒有店員 → 前景有收益、離線沒有。
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, selling: true } },
    });

    const result = core.settle(state, T0 + CAP_MS, 'offline');

    expect(result.gained).toBe(0);
    expect(result.creditedMs).toBe(CAP_MS);
    expect(stallOf(result.state, CHICKEN).selling).toBe(true);
  });
});

describeEngine('C 離線收益（門面層，GDD §6）', () => {
  it('C1 離線 0 秒：offline === null（不跳彈窗）', () => {
    const saved = saveWithClerk(T0 + 150_000);
    const engine = freshEngine();

    // 存檔的水位線就是 init 的時間 → 離線 0 秒。
    const frame = engine.init(T0 + 150_000, saved);

    expect(frame.offline).toBeNull();
    expect(frame.loadError).toBeNull();
  });

  it('C2 剛好 4 小時：offline 有值、capped === false', () => {
    const saved = saveWithClerk(T0 + 150_000);
    const engine = freshEngine();

    const frame = engine.init(T0 + 150_000 + CAP_MS, saved);

    expect(frame.offline).not.toBeNull();
    expect(frame.offline?.creditedMs).toBe(CAP_MS);
    expect(frame.offline?.capped).toBe(false);
    expect(withinTolerance(frame.offline?.gained ?? NaN, 18_000)).toBe(true);
  });

  it('C3 超過 4 小時：只計 4 小時、capped === true', () => {
    const saved = saveWithClerk(T0 + 150_000);
    const engine = freshEngine();

    const frame = engine.init(T0 + 150_000 + CAP_MS + 60_000, saved);

    expect(frame.offline?.creditedMs).toBe(CAP_MS);
    expect(frame.offline?.capped).toBe(true);
    expect(withinTolerance(frame.offline?.gained ?? NaN, 18_000)).toBe(true);
    expect(withinTolerance(engine.state().balance, 18_000)).toBe(true);
  });

  it('C4 時鐘倒退：offline === null、餘額不變小', () => {
    const saved = saveWithClerk(T0 + 150_000);
    const engine = freshEngine();

    const frame = engine.init(T0, saved); // 比存檔水位線早 → 倒退

    expect(frame.offline).toBeNull();
    expect(engine.state().balance).toBe(0);
  });

  it('C5 連續兩次 onVisible：第二次沒有收益', () => {
    const saved = saveWithClerk(T0 + 150_000);
    const engine = freshEngine();

    engine.init(T0 + 150_000, saved);
    engine.onHidden(T0 + 150_000);
    const first = engine.onVisible(T0 + 150_000 + 60_000);
    expect(first.offline).not.toBeNull();

    // 同一個時間點再收一次前台 → 離線 0 秒 → 沒有收益、不跳彈窗。
    const second = engine.onVisible(T0 + 150_000 + 60_000);
    expect(second.offline).toBeNull();
  });
});
