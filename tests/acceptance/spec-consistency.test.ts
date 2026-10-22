import { describe, expect, it } from 'vitest';

import { BALANCE, stallDef } from './support/balance';
import {
  milestoneMultiplier,
  stallIncomePerSec,
  upgradeCostOf,
  withinTolerance,
} from './support/oracle';

/**
 * 規格一致性 —— **不依賴 M1**，每次 `npm test` 都會跑。
 *
 * 驗收測試有兩層期望值：
 * 1. **字面值**（`economy.test.ts` 裡的表）：照 GDD 公式算一次、寫死的數字。
 * 2. **oracle**（`support/oracle.ts`）：吃 `data/balance.json` 的公式實作。
 *
 * 兩者是**獨立**算出來的（一個是手算寫死、一個是程式算），所以這支檔案
 * 專門檢查「兩層期望值彼此一致」——只有兩邊都對，驗收才有意義。
 *
 * 這支檔案也會在 `data/balance.json` 的數值被調動時立刻紅掉：
 * 那是刻意的 —— 平衡數值一改，驗收期望值就必須跟著重算，不能默默沿用舊數字。
 */
const CHICKEN = 'chicken-steak';

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

describe('規格一致性（字面值 ↔ oracle ↔ balance.json）', () => {
  it('升級成本字面值 = GDD §4.4 公式', () => {
    const def = stallDef(BALANCE, CHICKEN);
    for (const [levelText, expected] of Object.entries(CHICKEN_COST)) {
      const level = Number(levelText);
      expect(upgradeCostOf(def, level), `upgradeCost(${level})`).toBe(expected);
      expect(Number.isInteger(expected)).toBe(true);
    }
  });

  it('每秒收益字面值 = GDD §4.2 公式（無店員）', () => {
    const def = stallDef(BALANCE, CHICKEN);
    for (const [levelText, expected] of Object.entries(CHICKEN_INCOME)) {
      const level = Number(levelText);
      expect(
        withinTolerance(stallIncomePerSec(BALANCE, def, level, false), expected),
        `incomePerSec(Lv${level}, no clerk)`,
      ).toBe(true);
    }
  });

  it('每秒收益字面值 = GDD §4.2 公式（有店員，×1.25）', () => {
    const def = stallDef(BALANCE, CHICKEN);
    for (const [levelText, expected] of Object.entries(CHICKEN_INCOME_CLERK)) {
      const level = Number(levelText);
      expect(
        withinTolerance(stallIncomePerSec(BALANCE, def, level, true), expected),
        `incomePerSec(Lv${level}, clerk)`,
      ).toBe(true);
    }
  });

  it('里程碑倍率是累乘 2 / 4 / 8（GDD §4.1）', () => {
    expect(milestoneMultiplier(BALANCE, 24)).toBe(1);
    expect(milestoneMultiplier(BALANCE, 25)).toBe(2);
    expect(milestoneMultiplier(BALANCE, 49)).toBe(2);
    expect(milestoneMultiplier(BALANCE, 50)).toBe(4);
    expect(milestoneMultiplier(BALANCE, 99)).toBe(4);
    expect(milestoneMultiplier(BALANCE, 100)).toBe(8);
    expect(milestoneMultiplier(BALANCE, 150)).toBe(8);
  });

  it('balance.json 的結構符合 GDD §13（值被調動時這裡會紅掉，QA 必須重算期望值）', () => {
    expect(BALANCE.version).toBe(1);
    expect(BALANCE.startingBalance).toBe(0);
    expect(BALANCE.incomeGrowthPerLevel).toBe(1.1);
    expect(BALANCE.clerkIncomeMultiplier).toBe(1.25);
    expect(BALANCE.milestones).toEqual([
      { level: 25, multiplier: 2 },
      { level: 50, multiplier: 2 },
      { level: 100, multiplier: 2 },
    ]);
    expect(BALANCE.offline.capSeconds).toBe(14_400); // 4 小時
    expect(BALANCE.foreground.maxGapSeconds).toBe(60); // 前景長空檔門檻
    expect(BALANCE.save.currentVersion).toBe(1);
    expect(BALANCE.save.minSupportedVersion).toBe(0);
    expect(BALANCE.save.foregroundIntervalSeconds).toBe(10);
    // 攤位順序 = 解鎖順序（GDD §2、§13）。
    expect(BALANCE.stalls.map((s) => s.id)).toEqual([
      'chicken-steak',
      'bubble-tea',
      'oyster-omelette',
      'stinky-tofu',
      'sausage',
    ]);
    // 第一攤開局即解鎖（unlockCost = 0）。
    expect(BALANCE.stalls[0]?.unlockCost).toBe(0);
  });
});
