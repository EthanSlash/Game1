/**
 * 驗收 A（購買／解鎖／雇用）與 B（收益公式）。
 *
 * 對照 `docs/GDD.md` v1.0 §9 的 A1–A7、B1–B5。
 * 期望值有兩個來源，兩邊都要對：
 * 1. **字面值** —— 直接從 GDD 與 balance.json 算出來、寫死在這個檔裡的數字
 *    （例如雞排 Lv1→Lv2 成本 10、Lv25 收益 19.69946535161526）。
 * 2. **oracle** —— `support/oracle.ts` 依 GDD 公式算出來的期望值。
 * 兩者都對上，才算通過：只有 oracle 對、字面值不對，代表 oracle 跟規格都理解錯了。
 */
import { describe, expect, it } from 'vitest';

import { BALANCE, stallDef } from './support/balance';
import {
  earn,
  handBuiltState,
  sellStall,
  snapStall,
  stallOf,
  tickOver,
  unlockStall,
} from './support/fixtures';
import { HARNESS, freshEngine, requireCore } from './support/harness';
import { stallIncomePerSec, upgradeCostOf, withinTolerance } from './support/oracle';

const CHICKEN = 'chicken-steak';
const TEA = 'bubble-tea';
const OYSTER = 'oyster-omelette';

/** 測試用起點（epoch 毫秒）。 */
const T0 = 1_700_000_000_000;

/** 雞排車升級成本字面值：floor(10 × 1.25^(level-1))。 */
const CHICKEN_COST: Readonly<Record<number, number>> = {
  1: 10,
  2: 12,
  3: 15,
  4: 19,
  5: 24,
  6: 30,
  10: 74,
  24: 1694,
  25: 2117,
  26: 2646,
  49: 448_415,
  50: 560_519,
  51: 700_649,
  99: 31_418_198_177,
  100: 39_272_747_722,
};

/** 雞排車每秒收益字面值（無店員）：1 × 1.1^(level-1) × 里程碑倍率。 */
const CHICKEN_INCOME: Readonly<Record<number, number>> = {
  1: 1,
  2: 1.1,
  24: 8.95430243255239,
  25: 19.69946535161526,
  26: 21.66941188677679,
  49: 194.0344675697451,
  50: 426.8758286534392,
  99: 45_555.7432721401,
  100: 100_222.63519870822,
};

/** 雞排車每秒收益字面值（有店員，×1.25）。 */
const CHICKEN_INCOME_CLERK: Readonly<Record<number, number>> = {
  1: 1.25,
  2: 1.375,
  24: 11.192878040690488,
  25: 24.624331689519074,
  49: 242.54308446218135,
  50: 533.594785816799,
  99: 56_944.67909017512,
  100: 125_278.29399838527,
};

const describeCore = HARNESS.core === null ? describe.skip : describe;
const describeEngine = HARNESS.engine === null ? describe.skip : describe;

describeCore('A 購買／解鎖／雇用（GDD §9 A1–A7）', () => {
  it('A1 餘額 < 價格：純函式層回 insufficient-funds 且 state 是同一個參考', () => {
    const core = requireCore();
    // 賺 9 秒 × 1 元/秒 = 9 元，升級要 10 元 → 不夠。
    const state = earn(core, sellStall(core, core.createInitialState(T0), CHICKEN), 9_000);
    expect(state.balance).toBe(9);

    const result = core.upgrade(state, CHICKEN);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('insufficient-funds');
    // 失敗時 state 必須是傳入的同一個物件參考（狀態完全不變）。
    expect(result.state).toBe(state);
    expect(result.state.balance).toBe(9);
    expect(stallOf(result.state, CHICKEN).level).toBe(1);
  });

  it('A2 餘額 == 價格：成功且餘額剛好歸零', () => {
    const core = requireCore();
    // 賺 10 秒 × 1 元/秒 = 10 元，正好等於 Lv1→Lv2 的成本 10。
    const state = earn(core, sellStall(core, core.createInitialState(T0), CHICKEN), 10_000);
    expect(state.balance).toBe(10);

    const result = core.upgrade(state, CHICKEN);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.spent).toBe(10);
    expect(result.state.balance).toBe(0);
    expect(stallOf(result.state, CHICKEN).level).toBe(2);
  });

  it('A3 餘額 > 價格：餘額變成舊值減成本', () => {
    const core = requireCore();
    const state = earn(core, sellStall(core, core.createInitialState(T0), CHICKEN), 30_000);
    expect(state.balance).toBe(30);

    const result = core.upgrade(state, CHICKEN);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.spent).toBe(10);
    expect(withinTolerance(result.state.balance, 20)).toBe(true);
    expect(result.state.balance).toBe(20);
  });

  it('A4 升級成本 = floor(upgradeCostBase × upgradeCostGrowth^(level-1))，且成本是整數', () => {
    const core = requireCore();
    const def = stallDef(BALANCE, CHICKEN);

    for (const [levelText, expected] of Object.entries(CHICKEN_COST)) {
      const level = Number(levelText);
      // 手刻狀態只是為了直接跳到高等級（正常玩要 25 天），公式本身不受影響。
      const state = handBuiltState(BALANCE, {
        balance: 1e15,
        lastSettledAt: T0,
        stalls: { [CHICKEN]: { level, unlocked: true, selling: true } },
      });

      const snapshot = core.snapshot(state);
      expect(snapStall(snapshot, CHICKEN).upgradeCost).toBe(expected);
      expect(Number.isInteger(expected)).toBe(true);
      // oracle 也必須對上（兩邊都對才算通過）。
      expect(upgradeCostOf(def, level)).toBe(expected);

      const result = core.upgrade(state, CHICKEN);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.spent).toBe(expected);
      expect(stallOf(result.state, CHICKEN).level).toBe(level + 1);
    }
  });

  it('A4 升級成本在最高等級（Lv150）仍可用整數表示', () => {
    const core = requireCore();
    const def = stallDef(BALANCE, CHICKEN);
    const maxLevel = def.maxLevel;
    if (maxLevel === null) throw new Error('balance.json 的 maxLevel 不應為 null');

    const state = handBuiltState(BALANCE, {
      balance: 1e15,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: maxLevel, unlocked: true, selling: true } },
    });

    // 到了上限就沒有下一階：upgradeCost 為 null、升級失敗（max-level）。
    expect(snapStall(core.snapshot(state), CHICKEN).upgradeCost).toBeNull();
    const result = core.upgrade(state, CHICKEN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('max-level');
    expect(result.state).toBe(state);
  });

  it('A5 升級後等級 +1，收益同步變成新等級的公式值', () => {
    const core = requireCore();
    const def = stallDef(BALANCE, CHICKEN);

    const state = handBuiltState(BALANCE, {
      balance: 1e15,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, selling: true } },
    });
    const before = snapStall(core.snapshot(state), CHICKEN);
    const result = core.upgrade(state, CHICKEN);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const after = snapStall(core.snapshot(result.state), CHICKEN);
    expect(after.level).toBe(2);
    expect(withinTolerance(after.incomePerSec, CHICKEN_INCOME[2] ?? NaN)).toBe(true);
    expect(withinTolerance(after.incomePerSec, stallIncomePerSec(BALANCE, def, 2, false))).toBe(
      true,
    );
    expect(after.incomePerSec).toBeGreaterThan(before.incomePerSec);
  });

  it('A6 雇用店員：錢不夠回 false 且狀態不變；成功後 clerkHired=true 且收益套店員倍率', () => {
    const core = requireCore();
    const def = stallDef(BALANCE, CHICKEN);

    // 149 元 < hireCost 150。
    const poor = earn(core, sellStall(core, core.createInitialState(T0), CHICKEN), 149_000);
    expect(poor.balance).toBe(149);
    const failed = core.hire(poor, CHICKEN);
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error('unreachable');
    expect(failed.reason).toBe('insufficient-funds');
    expect(failed.state).toBe(poor);
    expect(stallOf(failed.state, CHICKEN).clerkHired).toBe(false);

    // 剛好 150 元。
    const rich = earn(core, sellStall(core, core.createInitialState(T0), CHICKEN), 150_000);
    expect(rich.balance).toBe(150);
    const hired = core.hire(rich, CHICKEN);
    expect(hired.ok).toBe(true);
    if (!hired.ok) throw new Error('unreachable');
    expect(hired.spent).toBe(150);
    expect(hired.state.balance).toBe(0);
    expect(stallOf(hired.state, CHICKEN).clerkHired).toBe(true);

    // 有店員時前景收益 = 公式 × clerkIncomeMultiplier（Lv1 → 1.25）。
    const snapshot = core.snapshot(hired.state);
    expect(snapStall(snapshot, CHICKEN).clerkHired).toBe(true);
    expect(withinTolerance(snapStall(snapshot, CHICKEN).incomePerSec, CHICKEN_INCOME_CLERK[1]!)).toBe(
      true,
    );
    expect(
      withinTolerance(
        snapStall(snapshot, CHICKEN).incomePerSec,
        stallIncomePerSec(BALANCE, def, 1, true),
      ),
    ).toBe(true);
  });

  it('A6 雇用店員：重複雇用回 clerk-already-hired 且狀態不變', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 1000,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });
    const result = core.hire(state, CHICKEN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('clerk-already-hired');
    expect(result.state).toBe(state);
  });

  it('A7 解鎖順序：前一攤未解鎖 → stall-locked；依序解鎖後 level=1、selling=false', () => {
    const core = requireCore();

    // 開局只有雞排車解鎖 → 蚵仔煎的前一攤（珍奶）沒解鎖。
    const initial = core.createInitialState(T0);
    const locked = core.unlock(initial, OYSTER);
    expect(locked.ok).toBe(false);
    if (locked.ok) throw new Error('unreachable');
    expect(locked.reason).toBe('stall-locked');
    expect(locked.state).toBe(initial);

    // 重複解鎖第一攤。
    const again = core.unlock(initial, CHICKEN);
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error('unreachable');
    expect(again.reason).toBe('already-unlocked');

    // 不存在的攤位。
    const ghost = core.unlock(initial, 'no-such-stall');
    expect(ghost.ok).toBe(false);
    if (ghost.ok) throw new Error('unreachable');
    expect(ghost.reason).toBe('no-such-stall');

    // 賺 400 元解鎖珍奶。
    const state = earn(core, sellStall(core, core.createInitialState(T0), CHICKEN), 400_000);
    const unlocked = core.unlock(state, TEA);
    expect(unlocked.ok).toBe(true);
    if (!unlocked.ok) throw new Error('unreachable');
    expect(unlocked.spent).toBe(400);
    expect(unlocked.state.balance).toBe(0);
    const tea = stallOf(unlocked.state, TEA);
    expect(tea.unlocked).toBe(true);
    expect(tea.level).toBe(1);
    expect(tea.selling).toBe(false);
    expect(tea.clerkHired).toBe(false);
  });

  it('A7 解鎖：門面層在解鎖鏈未滿足時回 false', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    expect(engine.unlock(OYSTER, T0)).toBe(false);
    expect(engine.unlock(CHICKEN, T0)).toBe(false);
  });
});

describeEngine('A 購買／解鎖／雇用（門面層，GDD §9 A1–A7）', () => {
  it('A1 餘額 < 價格：門面層回 false 且 state() 不變', () => {
    const engine = freshEngine();
    const now = T0 + 9_000;
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);
    engine.tick(now);
    expect(engine.state().balance).toBe(9);
    const before = engine.state();

    // 用**相同的 now** 呼叫：門面會先結算，但 delta = 0，所以狀態必須完全不變。
    expect(engine.upgrade(CHICKEN, now)).toBe(false);

    expect(engine.state()).toEqual(before);
  });
});

describeCore('B 收益公式（GDD §9 B1–B5）', () => {
  it('B1 每秒收益 = base × 1.1^(level-1) × 里程碑倍率 × 店員倍率', () => {
    const core = requireCore();
    const def = stallDef(BALANCE, CHICKEN);

    for (const [levelText, expected] of Object.entries(CHICKEN_INCOME)) {
      const level = Number(levelText);
      const state = handBuiltState(BALANCE, {
        balance: 0,
        lastSettledAt: T0,
        stalls: { [CHICKEN]: { level, unlocked: true, selling: true } },
      });
      const income = snapStall(core.snapshot(state), CHICKEN).incomePerSec;
      expect(withinTolerance(income, expected)).toBe(true);
      expect(withinTolerance(income, stallIncomePerSec(BALANCE, def, level, false))).toBe(true);
    }
  });

  it('B1 有店員時套 clerkIncomeMultiplier', () => {
    const core = requireCore();
    const def = stallDef(BALANCE, CHICKEN);

    for (const [levelText, expected] of Object.entries(CHICKEN_INCOME_CLERK)) {
      const level = Number(levelText);
      const state = handBuiltState(BALANCE, {
        balance: 0,
        lastSettledAt: T0,
        stalls: { [CHICKEN]: { level, unlocked: true, clerkHired: true } },
      });
      const income = snapStall(core.snapshot(state), CHICKEN).incomePerSec;
      expect(withinTolerance(income, expected)).toBe(true);
      expect(withinTolerance(income, stallIncomePerSec(BALANCE, def, level, true))).toBe(true);
    }
  });

  it('B2 里程碑 25/50/100 各 ×2，而且是累乘', () => {
    const core = requireCore();
    const def = stallDef(BALANCE, CHICKEN);

    const cases: readonly { level: number; multiplier: number }[] = [
      { level: 24, multiplier: 1 },
      { level: 25, multiplier: 2 },
      { level: 49, multiplier: 2 },
      { level: 50, multiplier: 4 },
      { level: 99, multiplier: 4 },
      { level: 100, multiplier: 8 },
      { level: 150, multiplier: 8 },
    ];

    for (const { level, multiplier } of cases) {
      const state = handBuiltState(BALANCE, {
        balance: 0,
        lastSettledAt: T0,
        stalls: { [CHICKEN]: { level, unlocked: true, selling: true } },
      });
      const income = snapStall(core.snapshot(state), CHICKEN).incomePerSec;
      // 倍率 × incomeGrowthPerLevel^(level-1) 才是完整收益。
      const expected =
        def.baseIncomePerSec *
        BALANCE.incomeGrowthPerLevel ** (level - 1) *
        multiplier;
      expect(withinTolerance(income, expected)).toBe(true);
    }
  });

  it('B3 里程碑前後的收益比 = 2 × incomeGrowthPerLevel', () => {
    const core = requireCore();

    const incomeAt = (level: number): number => {
      const state = handBuiltState(BALANCE, {
        balance: 0,
        lastSettledAt: T0,
        stalls: { [CHICKEN]: { level, unlocked: true, selling: true } },
      });
      return snapStall(core.snapshot(state), CHICKEN).incomePerSec;
    };

    const expectedRatio = 2 * BALANCE.incomeGrowthPerLevel;
    expect(withinTolerance(incomeAt(25) / incomeAt(24), expectedRatio)).toBe(true);
    expect(withinTolerance(incomeAt(50) / incomeAt(49), expectedRatio)).toBe(true);
    expect(withinTolerance(incomeAt(100) / incomeAt(99), expectedRatio)).toBe(true);
  });

  it('B4 無店員、未開賣：incomePerSec = 0，tick 不產生收益', () => {
    const core = requireCore();
    const state = core.createInitialState(T0);
    const snapshot = core.snapshot(state);
    expect(snapStall(snapshot, CHICKEN).incomePerSec).toBe(0);
    expect(snapshot.incomePerSec).toBe(0);

    const settled = core.settle(state, T0 + 60_000, 'foreground');
    expect(settled.gained).toBe(0);
    expect(settled.state.balance).toBe(0);
  });

  it('解鎖後新攤位是 Lv1、未開賣、無店員（GDD §3 不變式 4）', () => {
    const core = requireCore();
    const state = earn(core, sellStall(core, core.createInitialState(T0), CHICKEN), 400_000);
    const unlocked = unlockStall(core, state, TEA);
    const tea = stallOf(unlocked, TEA);
    expect(tea.unlocked).toBe(true);
    expect(tea.level).toBe(1);
    expect(tea.selling).toBe(false);
    expect(tea.clerkHired).toBe(false);
    // 未開賣 → 收益 0。
    expect(snapStall(core.snapshot(unlocked), TEA).incomePerSec).toBe(0);
  });

  it('已雇店員的攤位不能再 toggleSell（GDD §5：canToggleSell = false）', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 1000,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });
    const result = core.toggleSell(state, CHICKEN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('clerk-already-hired');
    expect(result.state).toBe(state);
    expect(snapStall(core.snapshot(state), CHICKEN).canToggleSell).toBe(false);
  });
});

describeEngine('B 收益（門面層，GDD §9 B4–B5）', () => {
  it('B4 門面層：沒有開賣時 tick 不會有任何進帳', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.tick(T0 + 60_000);
    expect(engine.state().balance).toBe(0);
    expect(engine.state().incomePerSec).toBe(0);
  });

  it('B5 手動開賣後前景有收益', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    expect(engine.toggleSell(CHICKEN, T0)).toBe(true);
    engine.tick(T0 + 10_000);
    expect(engine.state().balance).toBe(10);
    expect(withinTolerance(engine.state().incomePerSec, 1)).toBe(true);
  });

  it('B5 進背景後手動開賣的攤位不計入離線收益（離線只算有店員的）', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);
    engine.tick(T0 + 10_000);
    expect(engine.state().balance).toBe(10);

    engine.onHidden(T0 + 10_000);
    const frame = engine.onVisible(T0 + 20_000);

    // 沒有店員 → 離線收益 0 → 不跳彈窗（GDD §6）。
    expect(frame.offline).toBeNull();
    expect(engine.state().balance).toBe(10);
    // 回到前景後 selling 狀態保留（GDD §4.3）。
    expect(snapStall(engine.state(), CHICKEN).selling).toBe(true);
  });

  it('B5 有店員的攤位離線有收益', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);
    // 分段 tick：空檔不得超過前景門檻，否則 v1.1 會改用離線規則（見 longgap.test.ts）。
    tickOver(engine, T0, T0 + 150_000, BALANCE);
    expect(engine.state().balance).toBe(150);
    expect(engine.hire(CHICKEN, T0 + 150_000)).toBe(true);
    expect(engine.state().balance).toBe(0);

    engine.onHidden(T0 + 150_000);
    const frame = engine.onVisible(T0 + 150_000 + 3_600_000);

    expect(frame.offline).not.toBeNull();
    // 離線速率 = 1 × 1.25 = 1.25/秒 × 3600 秒 = 4500。
    expect(withinTolerance(frame.offline?.gained ?? NaN, 4500)).toBe(true);
    expect(withinTolerance(engine.state().balance, 4500)).toBe(true);
  });
});
