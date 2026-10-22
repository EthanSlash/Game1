/**
 * M1 門面層（`createGameEngine`）單元測試（oracle = docs/GDD.md §5、§6）。
 *
 * 門面的職責是「持有狀態 + 決定何時結算」，公式本身已在 core.test.ts 驗過；
 * 這裡驗事件流程、結算時機、tick 忽略規則與存檔往返。
 */

import { describe, expect, it } from 'vitest';

import { BALANCE_CONFIG, createCore, createGameEngine } from '../../src/core';
import type { GameEngine, GameState, NightMarketCore } from '../../src/core';

const T0 = 1_700_000_000_000;
const core: NightMarketCore = createCore(BALANCE_CONFIG);
const chickenRate = (BALANCE_CONFIG.stalls[0]?.baseIncomePerSec ?? 0) * BALANCE_CONFIG.clerkIncomeMultiplier;

function expectClose(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(1e-6, Math.abs(expected) * 1e-9));
}

/** 造一個有店員的存檔字串（離線收益用）。 */
function saveWithClerk(now = T0, balance = 0): string {
  const initial = core.createInitialState(now);
  const hired = core.hire({ ...initial, balance: balance + 150 }, 'chicken-steak');
  if (!hired.ok) throw new Error('測試前置失敗：hire');
  return core.serialize(hired.state, now);
}

/** 引擎開新局並把餘額調高（引擎沒有直接給錢的 API，用存檔注入）。 */
function engineWithBalance(balance: number, now = T0): GameEngine {
  const state: GameState = { ...core.createInitialState(now), balance };
  const engine = createGameEngine(BALANCE_CONFIG);
  engine.init(now, core.serialize(state, now));
  return engine;
}

describe('init（GDD §6）', () => {
  it('沒有存檔 → 開新局、loadError 為 null、不跳彈窗', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    const frame = engine.init(T0, null);

    expect(frame.loadError).toBeNull();
    expect(frame.offline).toBeNull();
    expect(frame.snapshot.balance).toBe(BALANCE_CONFIG.startingBalance);
    expect(frame.snapshot.stalls[0]?.level).toBe(1);
    expect(frame.snapshot.lastSettledAt).toBe(T0);
  });

  it('有店員的舊存檔 → 冷啟動離線入帳並帶 offline', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    const frame = engine.init(T0 + 60_000, saveWithClerk(T0));

    expect(frame.loadError).toBeNull();
    expect(frame.offline).not.toBeNull();
    expect(frame.offline?.creditedMs).toBe(60_000);
    expect(frame.offline?.capped).toBe(false);
    expectClose(frame.offline?.gained ?? 0, chickenRate * 60);
    expectClose(frame.snapshot.balance, chickenRate * 60);
  });

  it('存檔損毀 → 開新局、loadError 為 corrupt、不丟例外', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    const frame = engine.init(T0, '{not json');

    expect(frame.loadError).toBe('corrupt');
    expect(frame.offline).toBeNull();
    expect(frame.snapshot.balance).toBe(BALANCE_CONFIG.startingBalance);
    expect(frame.snapshot.lastSettledAt).toBe(T0);
  });

  it('存檔沒有店員 → 離線入帳 0，offline 為 null', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    const frame = engine.init(T0 + 60_000, core.serialize(core.createInitialState(T0), T0));
    expect(frame.offline).toBeNull();
  });

  it('讀檔失敗的分類：unknown-version / unsupported-shape 都開新局', () => {
    const valid = JSON.parse(core.serialize(core.createInitialState(T0), T0)) as Record<string, unknown>;
    const futureVersion = { ...valid, version: BALANCE_CONFIG.save.currentVersion + 1 };
    const badShape = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>;
    delete (badShape['state'] as Record<string, unknown>)['balance'];

    for (const [raw, reason] of [
      [JSON.stringify(futureVersion), 'unknown-version'],
      [JSON.stringify(badShape), 'unsupported-shape'],
    ] as const) {
      const engine = createGameEngine(BALANCE_CONFIG);
      const frame = engine.init(T0, raw);
      expect(frame.loadError).toBe(reason);
      expect(frame.offline).toBeNull();
      expect(frame.snapshot.balance).toBe(BALANCE_CONFIG.startingBalance);
      expect(frame.snapshot.lastSettledAt).toBe(T0);
    }
  });

  it('存檔水位線在未來（時鐘倒退）→ 不給收益、水位線對齊 now', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    const frame = engine.init(T0, saveWithClerk(T0 + 60_000));

    expect(frame.loadError).toBeNull();
    expect(frame.offline).toBeNull();
    expect(frame.snapshot.lastSettledAt).toBe(T0);
    expect(frame.snapshot.balance).toBe(0);
  });
});

describe('tick / onHidden / onVisible（GDD §6）', () => {
  it('tick 累積前景收益（手動開賣）', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    engine.init(T0, null);
    expect(engine.toggleSell('chicken-steak', T0)).toBe(true);

    const frame = engine.tick(T0 + 10_000);
    expect(frame.offline).toBeNull();
    expectClose(frame.snapshot.balance, 10);
    expect(frame.snapshot.lastSettledAt).toBe(T0 + 10_000);
  });

  it('tick 時鐘倒退：不給收益、不扣錢、水位線對齊 now', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    engine.init(T0, null);
    engine.toggleSell('chicken-steak', T0);
    engine.tick(T0 + 10_000);
    const before = engine.state().balance;

    const frame = engine.tick(T0 + 5_000);
    expect(frame.offline).toBeNull();
    expect(frame.snapshot.balance).toBe(before);
    expect(frame.snapshot.lastSettledAt).toBe(T0 + 5_000);
  });

  it('onHidden 先結清前景，onHidden 之後的 tick 一律忽略', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    engine.init(T0, null);
    engine.toggleSell('chicken-steak', T0);

    engine.onHidden(T0 + 30_000);
    expectClose(engine.state().balance, 30);

    const ignored = engine.tick(T0 + 40_000);
    expectClose(ignored.snapshot.balance, 30);
    expect(ignored.snapshot.lastSettledAt).toBe(T0 + 30_000);
    expect(ignored.offline).toBeNull();
  });

  it('onVisible 以離線規則結算；手動開賣的攤位不計入', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    engine.init(T0, null);
    engine.toggleSell('chicken-steak', T0);
    engine.onHidden(T0 + 30_000);

    const frame = engine.onVisible(T0 + 90_000);
    expect(frame.offline).toBeNull();
    expectClose(frame.snapshot.balance, 30);
  });

  it('E1：背景回來不重複計算（前景 + 離線各算一次）', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    engine.init(T0, saveWithClerk(T0));

    engine.tick(T0 + 30_000);
    engine.onHidden(T0 + 30_000);
    const frame = engine.onVisible(T0 + 90_000);

    expect(frame.offline?.creditedMs).toBe(60_000);
    // 前景 30 秒 + 離線 60 秒，各 1.25/秒。
    expectClose(frame.snapshot.balance, chickenRate * 90);
    expectClose(frame.offline?.gained ?? 0, chickenRate * 60);
  });

  it('E2：連續兩次 onVisible，第二次入帳 0 且不跳彈窗', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    engine.init(T0, saveWithClerk(T0));
    engine.onHidden(T0);
    const first = engine.onVisible(T0 + 10_000);
    const second = engine.onVisible(T0 + 10_000);

    expect(first.offline).not.toBeNull();
    expect(second.offline).toBeNull();
    expectClose(second.snapshot.balance, first.snapshot.balance);
  });

  it('C6：前景長空檔的 tick 用離線規則入帳並帶 offline', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    engine.init(T0, saveWithClerk(T0));
    const capMs = BALANCE_CONFIG.offline.capSeconds * 1000;

    const frame = engine.tick(T0 + capMs + 1_000);
    expect(frame.offline).not.toBeNull();
    expect(frame.offline?.capped).toBe(true);
    expect(frame.offline?.creditedMs).toBe(capMs);
    expectClose(frame.offline?.gained ?? 0, (chickenRate * capMs) / 1000);
  });

  it('C6 邊界：長空檔但入帳 0（只有手動開賣）→ offline 為 null', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    engine.init(T0, null);
    engine.toggleSell('chicken-steak', T0);

    const frame = engine.tick(T0 + BALANCE_CONFIG.foreground.maxGapSeconds * 1000 + 60_000);
    expect(frame.offline).toBeNull();
    expect(frame.snapshot.balance).toBe(BALANCE_CONFIG.startingBalance);
  });

  it('重複 onHidden（visibilitychange + pagehide）不會把背景時間當前影入帳', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    engine.init(T0, null);
    engine.toggleSell('chicken-steak', T0);

    engine.onHidden(T0 + 10_000);
    expectClose(engine.state().balance, 10);

    engine.onHidden(T0 + 40_000);
    expectClose(engine.state().balance, 10);

    const frame = engine.onVisible(T0 + 40_000);
    expect(frame.offline).toBeNull();
    expectClose(frame.snapshot.balance, 10);
  });

  it('onHidden 長空檔改用離線規則（只計店員、套上限）', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    engine.init(T0, saveWithClerk(T0));
    const capMs = BALANCE_CONFIG.offline.capSeconds * 1000;

    engine.onHidden(T0 + capMs + 60_000);
    expectClose(engine.state().balance, (chickenRate * capMs) / 1000);
  });
});

describe('動作（GDD §5）', () => {
  it('動作前先結算：錢不夠時回 false，但結算仍入帳', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    engine.init(T0, null);
    engine.toggleSell('chicken-steak', T0);

    // 20 秒後餘額 20（>= 10）→ 升級成功，扣 10。
    expect(engine.upgrade('chicken-steak', T0 + 20_000)).toBe(true);
    expectClose(engine.state().balance, 10);
    expect(engine.state().stalls[0]?.level).toBe(2);

    // 同一個 now、餘額 10 < 12 → 失敗，狀態不變。
    expect(engine.upgrade('chicken-steak', T0 + 20_000)).toBe(false);
    expectClose(engine.state().balance, 10);
    expect(engine.state().stalls[0]?.level).toBe(2);
  });

  it('C7：動作前的長空檔結算用離線規則（手動開賣不套前景速率）', () => {
    const longGapMs = BALANCE_CONFIG.foreground.maxGapSeconds * 1000 + 60_000;

    // 只有手動開賣 → 長空檔期間視為離線，不入帳；動作本身照規則失敗。
    const openedOnly = createGameEngine(BALANCE_CONFIG);
    openedOnly.init(T0, null);
    openedOnly.toggleSell('chicken-steak', T0);
    expect(openedOnly.upgrade('chicken-steak', T0 + longGapMs)).toBe(false);
    expectClose(openedOnly.state().balance, 0);

    // 有店員 → 長空檔按離線速率入帳，動作照規則成功（升級只扣成本）。
    const withClerk = createGameEngine(BALANCE_CONFIG);
    withClerk.init(T0, saveWithClerk(T0, 1_000));
    expect(withClerk.upgrade('chicken-steak', T0 + longGapMs)).toBe(true);
    expectClose(withClerk.state().balance, 1_000 + (chickenRate * longGapMs) / 1000 - 10);
    expect(withClerk.state().stalls[0]?.level).toBe(2);
  });

  it('錢不夠的動作回 false，不丟例外', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    engine.init(T0, null);

    expect(engine.upgrade('chicken-steak', T0)).toBe(false);
    expect(engine.hire('chicken-steak', T0)).toBe(false);
    expect(engine.unlock('bubble-tea', T0)).toBe(false);
    expect(engine.upgrade('not-a-stall', T0)).toBe(false);
    expect(engine.state().balance).toBe(BALANCE_CONFIG.startingBalance);
  });

  it('雇用後不能再手動開賣；解鎖後回傳新攤位狀態', () => {
    const engine = engineWithBalance(1_000_000);
    expect(engine.hire('chicken-steak', T0)).toBe(true);
    expect(engine.toggleSell('chicken-steak', T0)).toBe(false);

    expect(engine.unlock('bubble-tea', T0)).toBe(true);
    const tea = engine.state().stalls[1];
    expect(tea?.unlocked).toBe(true);
    expect(tea?.level).toBe(1);
    expect(tea?.selling).toBe(false);
  });
});

describe('save（GDD §6.1、§8）', () => {
  it('存檔字串可被新引擎完整還原（D1）', () => {
    const engine = engineWithBalance(1_000_000);
    engine.toggleSell('chicken-steak', T0);
    engine.tick(T0 + 5_000);
    engine.upgrade('chicken-steak', T0 + 5_000);
    engine.hire('chicken-steak', T0 + 5_000);
    engine.unlock('bubble-tea', T0 + 5_000);

    const snapshotBefore = engine.state();
    const raw = engine.save(T0 + 5_000);

    const restored = createGameEngine(BALANCE_CONFIG);
    const frame = restored.init(T0 + 5_000, raw);

    expect(frame.loadError).toBeNull();
    expect(frame.snapshot).toEqual(snapshotBefore);
  });

  it('save 只序列化，不結算、不改狀態', () => {
    const engine = createGameEngine(BALANCE_CONFIG);
    engine.init(T0, null);
    engine.toggleSell('chicken-steak', T0);

    const before = engine.state();
    engine.save(T0 + 60_000);
    expect(engine.state()).toEqual(before);
  });
});
