/**
 * M1 純函式層單元測試（oracle = docs/GDD.md §3～§5.1）。
 *
 * 只 import `src/core` 的公開入口；數值一律從 `BALANCE_CONFIG` 取，不另外寫死。
 * 黑箱驗收（tests/acceptance）由 MiniMax31 依 GDD 另寫，本檔不取代它。
 */

import { describe, expect, it } from 'vitest';

import { BALANCE_CONFIG, createCore } from '../../src/core';
import type {
  ActionResult,
  BalanceConfig,
  GameState,
  NightMarketCore,
  StallDefinition,
} from '../../src/core';

const T0 = 1_700_000_000_000;
const core: NightMarketCore = createCore(BALANCE_CONFIG);

/** GDD §9 的浮點容差。 */
function expectClose(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(1e-6, Math.abs(expected) * 1e-9));
}

function stallDef(id: string): StallDefinition {
  const found = BALANCE_CONFIG.stalls.find((def) => def.id === id);
  if (found === undefined) throw new Error(`balance.json 沒有攤位 ${id}`);
  return found;
}

function stateWithBalance(balance: number, now = T0): GameState {
  return { ...core.createInitialState(now), balance };
}

function expectFailure(result: ActionResult, reason: string, original: GameState): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toBe(reason);
  // 失敗必須回傳同一個 state 參考（GDD §5）。
  expect(result.state).toBe(original);
}

function expectSuccess(result: ActionResult): GameState {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`預期成功，實際失敗：${result.reason}`);
  return result.state;
}

describe('createInitialState（GDD §3）', () => {
  it('第一攤開局解鎖 Lv1，其餘未解鎖，balance 與水位線照設定', () => {
    const state = core.createInitialState(T0);

    expect(state.saveVersion).toBe(BALANCE_CONFIG.save.currentVersion);
    expect(state.balance).toBe(BALANCE_CONFIG.startingBalance);
    expect(state.lastSettledAt).toBe(T0);

    const first = state.stalls[stallDef('chicken-steak').id];
    expect(first).toEqual({ level: 1, unlocked: true, clerkHired: false, selling: false });

    for (const def of BALANCE_CONFIG.stalls.slice(1)) {
      expect(state.stalls[def.id]).toEqual({ level: 0, unlocked: false, clerkHired: false, selling: false });
    }
  });

  it('不動傳入的 balance.json（每次呼叫都給新物件）', () => {
    const a = core.createInitialState(T0);
    const b = core.createInitialState(T0 + 1);
    expect(a).not.toBe(b);
    expect(a.stalls).not.toBe(b.stalls);
  });
});

describe('snapshot（GDD §4.2、§4.3、§5.1）', () => {
  it('未開賣、未雇店員 → 收益 0，仍可切換開賣', () => {
    const snapshot = core.snapshot(core.createInitialState(T0));
    const chicken = snapshot.stalls[0];

    expect(snapshot.balance).toBe(BALANCE_CONFIG.startingBalance);
    expect(snapshot.incomePerSec).toBe(0);
    expect(snapshot.anyClerkHired).toBe(false);
    expect(chicken?.incomePerSec).toBe(0);
    expect(chicken?.canToggleSell).toBe(true);
    expect(chicken?.canUpgrade).toBe(false);
    expect(chicken?.unlockCost).toBeNull();
    expect(chicken?.hireCost).toBe(stallDef('chicken-steak').hireCost);
  });

  it('開賣後收益 = 每秒基礎收益（不套店員加成）', () => {
    const state = expectSuccess(core.toggleSell(core.createInitialState(T0), 'chicken-steak'));
    const snapshot = core.snapshot(state);

    expect(snapshot.stalls[0]?.selling).toBe(true);
    expectClose(snapshot.stalls[0]?.incomePerSec ?? 0, stallDef('chicken-steak').baseIncomePerSec);
    expectClose(snapshot.incomePerSec, stallDef('chicken-steak').baseIncomePerSec);
  });

  it('雇用店員後套 clerkIncomeMultiplier，且不能再手動開賣', () => {
    const opened = expectSuccess(core.toggleSell(stateWithBalance(10_000), 'chicken-steak'));
    const hired = expectSuccess(core.hire(opened, 'chicken-steak'));
    const snapshot = core.snapshot(hired);
    const chicken = snapshot.stalls[0];
    const base = stallDef('chicken-steak').baseIncomePerSec;

    expect(chicken?.clerkHired).toBe(true);
    expect(chicken?.hireCost).toBeNull();
    expect(chicken?.canHire).toBe(false);
    expect(chicken?.canToggleSell).toBe(false);
    expectClose(chicken?.incomePerSec ?? 0, base * BALANCE_CONFIG.clerkIncomeMultiplier);
    expect(snapshot.anyClerkHired).toBe(true);
  });

  it('升級成本 = floor(upgradeCostBase × upgradeCostGrowth^(level-1))', () => {
    const def = stallDef('chicken-steak');
    const cases: readonly [number, number][] = [
      [1, 10],
      [2, 12],
      [3, 15],
      [4, 19],
      [10, 74],
    ];

    for (const [level, expected] of cases) {
      const state: GameState = {
        ...stateWithBalance(0),
        stalls: { ...stateWithBalance(0).stalls, 'chicken-steak': { level, unlocked: true, clerkHired: false, selling: false } },
      };
      const snapshot = core.snapshot(state);
      expect(snapshot.stalls[0]?.upgradeCost).toBe(
        Math.floor(def.upgradeCostBase * def.upgradeCostGrowth ** (level - 1)),
      );
      expect(snapshot.stalls[0]?.upgradeCost).toBe(expected);
      expect(snapshot.stalls[0]?.canUpgrade).toBe(false);
    }
  });

  it('里程碑進度：Lv1 0.04、Lv25 歸 0 往 50、Lv75 0.5、Lv100 null', () => {
    const milestoneState = (level: number): GameState => {
      const base = stateWithBalance(0);
      return { ...base, stalls: { ...base.stalls, 'chicken-steak': { level, unlocked: true, clerkHired: false, selling: false } } };
    };

    const at = (level: number) => core.snapshot(milestoneState(level)).stalls[0];

    expect(at(1)?.nextMilestone).toEqual({ level: 25, multiplier: 2, progress: 1 / 25 });
    expect(at(24)?.nextMilestone).toEqual({ level: 25, multiplier: 2, progress: 24 / 25 });
    expect(at(25)?.nextMilestone).toEqual({ level: 50, multiplier: 2, progress: 0 });
    expect(at(50)?.nextMilestone).toEqual({ level: 100, multiplier: 2, progress: 0 });
    expect(at(75)?.nextMilestone).toEqual({ level: 100, multiplier: 2, progress: 0.5 });
    expect(at(100)?.nextMilestone).toBeNull();
    expect(at(150)?.nextMilestone).toBeNull();
  });

  it('里程碑倍率累乘：Lv25 = ×2、Lv50 = ×4、Lv100 = ×8', () => {
    const base = stallDef('chicken-steak').baseIncomePerSec;
    const growth = BALANCE_CONFIG.incomeGrowthPerLevel;
    const incomeAt = (level: number): number => {
      const state = stateWithBalance(0);
      const withLevel: GameState = {
        ...state,
        stalls: { ...state.stalls, 'chicken-steak': { level, unlocked: true, clerkHired: false, selling: true } },
      };
      return core.snapshot(withLevel).stalls[0]?.incomePerSec ?? 0;
    };

    expectClose(incomeAt(24), base * growth ** 23);
    expectClose(incomeAt(25), base * growth ** 24 * 2);
    expectClose(incomeAt(50), base * growth ** 49 * 4);
    expectClose(incomeAt(100), base * growth ** 99 * 8);
    // GDD §9 B3：Lv24 → Lv25 的收益比 = 2 × incomeGrowthPerLevel。
    expectClose(incomeAt(25) / incomeAt(24), 2 * growth);
  });

  it('未解鎖攤位：成本 null、解鎖鏈看前一攤', () => {
    const snapshot = core.snapshot(stateWithBalance(1_000_000));
    const tea = snapshot.stalls[1];
    const oyster = snapshot.stalls[2];

    expect(tea?.unlocked).toBe(false);
    expect(tea?.upgradeCost).toBeNull();
    expect(tea?.hireCost).toBeNull();
    expect(tea?.incomePerSec).toBe(0);
    expect(tea?.canUnlock).toBe(true);
    // 蚵仔煎的前一攤（珍珠奶茶）還沒解鎖 → 不能解鎖。
    expect(oyster?.canUnlock).toBe(false);
  });

  it('攤位順序與 balance.json 一致', () => {
    const snapshot = core.snapshot(core.createInitialState(T0));
    expect(snapshot.stalls.map((stall) => stall.id)).toEqual(BALANCE_CONFIG.stalls.map((def) => def.id));
    expect(snapshot.lastSettledAt).toBe(T0);
  });
});

describe('upgrade（GDD §4.4、§5）', () => {
  it('錢不夠 → insufficient-funds 且回傳同一 state', () => {
    const state = core.createInitialState(T0);
    expectFailure(core.upgrade(state, 'chicken-steak'), 'insufficient-funds', state);
  });

  it('錢剛好等於價格 → 成功、balance 歸 0、等級 +1', () => {
    const state = stateWithBalance(10);
    const result = core.upgrade(state, 'chicken-steak');
    const next = expectSuccess(result);

    if (!result.ok) return;
    expect(result.spent).toBe(10);
    expect(next.balance).toBe(0);
    expect(next.stalls['chicken-steak']?.level).toBe(2);
    // 不改傳入的 state。
    expect(state.balance).toBe(10);
    expect(state.stalls['chicken-steak']?.level).toBe(1);
  });

  it('餘額大於價格 → balance = 舊值 − 成本', () => {
    const next = expectSuccess(core.upgrade(stateWithBalance(100), 'chicken-steak'));
    expectClose(next.balance, 90);
  });

  it('升級後收益同步換成新等級的公式值', () => {
    const opened = expectSuccess(core.toggleSell(stateWithBalance(100), 'chicken-steak'));
    const before = core.snapshot(opened);
    const after = core.snapshot(expectSuccess(core.upgrade(opened, 'chicken-steak')));

    expectClose(
      after.stalls[0]?.incomePerSec ?? 0,
      (before.stalls[0]?.incomePerSec ?? 0) * BALANCE_CONFIG.incomeGrowthPerLevel,
    );
  });

  it('不存在的攤位 → no-such-stall', () => {
    const state = core.createInitialState(T0);
    expectFailure(core.upgrade(state, 'not-a-stall'), 'no-such-stall', state);
  });

  it('未解鎖攤位 → stall-locked', () => {
    const state = stateWithBalance(1_000_000);
    expectFailure(core.upgrade(state, 'bubble-tea'), 'stall-locked', state);
  });

  it('已達 maxLevel → max-level', () => {
    const capped: BalanceConfig = {
      ...BALANCE_CONFIG,
      stalls: BALANCE_CONFIG.stalls.map((def) =>
        def.id === 'chicken-steak' ? { ...def, maxLevel: 2 } : def,
      ),
    };
    const cappedCore = createCore(capped);
    const base = cappedCore.createInitialState(T0);
    const atMax: GameState = {
      ...base,
      balance: 1_000_000,
      stalls: { ...base.stalls, 'chicken-steak': { level: 2, unlocked: true, clerkHired: false, selling: false } },
    };

    expectFailure(cappedCore.upgrade(atMax, 'chicken-steak'), 'max-level', atMax);
    expect(cappedCore.snapshot(atMax).stalls[0]?.upgradeCost).toBeNull();
  });
});

describe('hire（GDD §4.5、§5）', () => {
  it('錢不夠 → insufficient-funds；成功 → clerkHired 且扣款', () => {
    const poor = core.createInitialState(T0);
    expectFailure(core.hire(poor, 'chicken-steak'), 'insufficient-funds', poor);

    const next = expectSuccess(core.hire(stateWithBalance(200), 'chicken-steak'));
    expect(next.stalls['chicken-steak']?.clerkHired).toBe(true);
    expectClose(next.balance, 50);
  });

  it('重複雇用 → clerk-already-hired', () => {
    const hired = expectSuccess(core.hire(stateWithBalance(10_000), 'chicken-steak'));
    expectFailure(core.hire(hired, 'chicken-steak'), 'clerk-already-hired', hired);
  });

  it('未解鎖 → stall-locked；不存在的攤位 → no-such-stall', () => {
    const state = stateWithBalance(1_000_000);
    expectFailure(core.hire(state, 'sausage'), 'stall-locked', state);
    expectFailure(core.hire(state, 'nope'), 'no-such-stall', state);
  });
});

describe('unlock（GDD §4.5、§5）', () => {
  it('解鎖鏈：前一攤未解鎖 → stall-locked', () => {
    const state = stateWithBalance(1_000_000);
    expectFailure(core.unlock(state, 'oyster-omelette'), 'stall-locked', state);
  });

  it('已解鎖 → already-unlocked；不存在 → no-such-stall', () => {
    const state = stateWithBalance(1_000_000);
    expectFailure(core.unlock(state, 'chicken-steak'), 'already-unlocked', state);
    expectFailure(core.unlock(state, 'nope'), 'no-such-stall', state);
  });

  it('錢不夠 → insufficient-funds', () => {
    const state = stateWithBalance(399);
    expectFailure(core.unlock(state, 'bubble-tea'), 'insufficient-funds', state);
  });

  it('成功 → Lv1、未開賣、無店員、扣解鎖金', () => {
    const state = stateWithBalance(400);
    const result = core.unlock(state, 'bubble-tea');
    const next = expectSuccess(result);

    if (!result.ok) return;
    expect(result.spent).toBe(400);
    expect(next.balance).toBe(0);
    expect(next.stalls['bubble-tea']).toEqual({ level: 1, unlocked: true, clerkHired: false, selling: false });
  });
});

describe('toggleSell（GDD §5）', () => {
  it('切換兩次回到原狀，且不收費', () => {
    const opened = expectSuccess(core.toggleSell(stateWithBalance(5), 'chicken-steak'));
    expect(opened.stalls['chicken-steak']?.selling).toBe(true);
    expectClose(opened.balance, 5);

    const closed = expectSuccess(core.toggleSell(opened, 'chicken-steak'));
    expect(closed.stalls['chicken-steak']?.selling).toBe(false);
  });

  it('已雇店員 → clerk-already-hired；未解鎖 → stall-locked；不存在 → no-such-stall', () => {
    const hired = expectSuccess(core.hire(stateWithBalance(10_000), 'chicken-steak'));
    expectFailure(core.toggleSell(hired, 'chicken-steak'), 'clerk-already-hired', hired);

    const locked = stateWithBalance(1_000_000);
    expectFailure(core.toggleSell(locked, 'bubble-tea'), 'stall-locked', locked);
    expectFailure(core.toggleSell(locked, 'nope'), 'no-such-stall', locked);
  });
});

describe('settle（GDD §4.3、§4.6）', () => {
  it('前景只計入「有店員或手動開賣」的攤位；離線只計入有店員的', () => {
    const opened = expectSuccess(core.toggleSell(stateWithBalance(0), 'chicken-steak'));

    const foreground = core.settle(opened, T0 + 60_000, 'foreground');
    expect(foreground.timeWentBackwards).toBe(false);
    expectClose(foreground.gained, 60);
    expectClose(foreground.state.balance, 60);

    const offline = core.settle(opened, T0 + 60_000, 'offline');
    expect(offline.gained).toBe(0);
    expectClose(offline.state.balance, 0);
  });

  it('有店員的攤位前景與離線都計入，並套 clerkIncomeMultiplier', () => {
    const hired = expectSuccess(core.hire(stateWithBalance(10_000), 'chicken-steak'));
    const rate = stallDef('chicken-steak').baseIncomePerSec * BALANCE_CONFIG.clerkIncomeMultiplier;

    const foreground = core.settle(hired, T0 + 10_000, 'foreground');
    expectClose(foreground.gained, rate * 10);

    const offline = core.settle(hired, T0 + 10_000, 'offline');
    expectClose(offline.gained, rate * 10);
  });

  it('幂等：同一個 now 連呼兩次，第二次 gained 0', () => {
    const opened = expectSuccess(core.toggleSell(stateWithBalance(0), 'chicken-steak'));
    const first = core.settle(opened, T0 + 5_000, 'foreground');
    const second = core.settle(first.state, T0 + 5_000, 'foreground');

    expectClose(first.gained, 5);
    expect(second.gained).toBe(0);
    expect(second.elapsedMs).toBe(0);
    expectClose(second.state.balance, first.state.balance);
  });

  it('時鐘倒退：不給收益、不扣錢、水位線對齊 now', () => {
    const hired = expectSuccess(core.hire(stateWithBalance(10_000), 'chicken-steak'));
    const settled = core.settle(hired, T0 + 10_000, 'foreground');
    const backwards = core.settle(settled.state, T0 + 9_000, 'foreground');

    expect(backwards.gained).toBe(0);
    expect(backwards.elapsedMs).toBe(0);
    expect(backwards.creditedMs).toBe(0);
    expect(backwards.capped).toBe(false);
    expect(backwards.timeWentBackwards).toBe(true);
    expect(backwards.state.balance).toBe(settled.state.balance);
    expect(backwards.state.lastSettledAt).toBe(T0 + 9_000);
  });

  it('剛好 4h 不截斷；超過 4h 截斷並標 capped', () => {
    const hired = expectSuccess(core.hire(stateWithBalance(10_000), 'chicken-steak'));
    const capMs = BALANCE_CONFIG.offline.capSeconds * 1000;

    const exact = core.settle(hired, T0 + capMs, 'offline');
    expect(exact.creditedMs).toBe(capMs);
    expect(exact.capped).toBe(false);

    const over = core.settle(hired, T0 + capMs + 3_600_000, 'offline');
    expect(over.creditedMs).toBe(capMs);
    expect(over.capped).toBe(true);
    expectClose(over.gained, exact.gained);
  });

  it('前景長空檔（> maxGapMs）改用離線規則：手動開賣不計、有店員才計', () => {
    const maxGapMs = BALANCE_CONFIG.foreground.maxGapSeconds * 1000;
    const opened = expectSuccess(core.toggleSell(stateWithBalance(0), 'chicken-steak'));
    const longGap = core.settle(opened, T0 + maxGapMs + 60_000, 'foreground');

    // 只有手動開賣 → 長空檔期間視為離線，不入帳。
    expect(longGap.gained).toBe(0);
    expect(longGap.creditedMs).toBe(maxGapMs + 60_000);
    expect(longGap.capped).toBe(false);

    const hired = expectSuccess(core.hire(stateWithBalance(10_000), 'chicken-steak'));
    const withClerk = core.settle(hired, T0 + maxGapMs + 60_000, 'foreground');
    const rate = stallDef('chicken-steak').baseIncomePerSec * BALANCE_CONFIG.clerkIncomeMultiplier;
    expectClose(withClerk.gained, (rate * (maxGapMs + 60_000)) / 1000);
  });

  it('前景長空檔也套 4h 上限', () => {
    const hired = expectSuccess(core.hire(stateWithBalance(10_000), 'chicken-steak'));
    const capMs = BALANCE_CONFIG.offline.capSeconds * 1000;
    const result = core.settle(hired, T0 + capMs + 1_000, 'foreground');

    expect(result.capped).toBe(true);
    expect(result.creditedMs).toBe(capMs);
  });

  it('不改傳入的 state', () => {
    const opened = expectSuccess(core.toggleSell(stateWithBalance(0), 'chicken-steak'));
    const before = JSON.stringify(opened);
    core.settle(opened, T0 + 1_000, 'foreground');
    expect(JSON.stringify(opened)).toBe(before);
  });
});
