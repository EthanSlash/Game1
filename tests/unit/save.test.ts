/**
 * M1 存檔單元測試（oracle = docs/GDD.md §8）。
 *
 * 讀檔一律不得丟例外；損毀、缺欄位、版本錯都要回 `LoadResult` 的失敗分支。
 */

import { describe, expect, it } from 'vitest';

import { BALANCE_CONFIG, createCore } from '../../src/core';
import type { BalanceConfig, GameState, LoadResult, NightMarketCore } from '../../src/core';

const T0 = 1_700_000_000_000;
const core: NightMarketCore = createCore(BALANCE_CONFIG);

function parsedSave(state: GameState = core.createInitialState(T0)): Record<string, unknown> {
  return JSON.parse(core.serialize(state, T0)) as Record<string, unknown>;
}

function stateOf(save: Record<string, unknown>): Record<string, unknown> {
  return save['state'] as Record<string, unknown>;
}

function stallsOf(save: Record<string, unknown>): Record<string, unknown> {
  return stateOf(save)['stalls'] as Record<string, unknown>;
}

function expectLoadOk(result: LoadResult): Extract<LoadResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`預期讀檔成功，實際失敗：${result.reason} / ${result.detail}`);
  return result;
}

function expectLoadFailure(result: LoadResult, reason: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toBe(reason);
  expect(result.detail.length).toBeGreaterThan(0);
}

function richState(): GameState {
  const initial = core.createInitialState(T0);
  const opened = core.toggleSell({ ...initial, balance: 1_000_000 }, 'chicken-steak');
  if (!opened.ok) throw new Error('測試前置失敗：toggleSell');
  const unlocked = core.unlock(opened.state, 'bubble-tea');
  if (!unlocked.ok) throw new Error('測試前置失敗：unlock');
  const hired = core.hire({ ...unlocked.state, balance: 900_000 }, 'bubble-tea');
  if (!hired.ok) throw new Error('測試前置失敗：hire');
  const settled = core.settle(hired.state, T0 + 12_345, 'foreground');
  return settled.state;
}

describe('serialize / load v1（GDD §8.1）', () => {
  it('存檔再讀回：金額、等級、解鎖、店員、開賣、水位線完整還原', () => {
    const state = richState();
    const raw = core.serialize(state, T0 + 20_000);
    const envelope = JSON.parse(raw) as Record<string, unknown>;

    expect(envelope['version']).toBe(BALANCE_CONFIG.save.currentVersion);
    expect(envelope['savedAt']).toBe(T0 + 20_000);

    const loaded = expectLoadOk(core.load(raw));
    expect(loaded.migratedFrom).toBeNull();
    expect(loaded.state).toEqual(state);
    expect(loaded.state.lastSettledAt).toBe(T0 + 12_345);
    // 全部攤位都要寫進存檔（未解鎖也寫）。
    expect(Object.keys(loaded.state.stalls).sort()).toEqual(
      BALANCE_CONFIG.stalls.map((def) => def.id).sort(),
    );
  });

  it('缺少 balance.json 定義的攤位 → 補預設值，不算錯', () => {
    const save = parsedSave();
    delete stallsOf(save)['sausage'];

    const loaded = expectLoadOk(core.load(JSON.stringify(save)));
    expect(loaded.state.stalls['sausage']).toEqual({
      level: 0,
      unlocked: false,
      clerkHired: false,
      selling: false,
    });
  });

  it('出現 balance.json 沒有的攤位 id → 忽略該筆', () => {
    const save = parsedSave();
    stallsOf(save)['ghost-stall'] = { level: 9, unlocked: true, clerkHired: true, selling: true };

    const loaded = expectLoadOk(core.load(JSON.stringify(save)));
    expect(loaded.state.stalls['ghost-stall']).toBeUndefined();
  });

  it('level > maxLevel → 夾到 maxLevel，不算損毀', () => {
    const save = parsedSave();
    stallsOf(save)['chicken-steak'] = { level: 999, unlocked: true, clerkHired: false, selling: true };

    const loaded = expectLoadOk(core.load(JSON.stringify(save)));
    expect(loaded.state.stalls['chicken-steak']?.level).toBe(150);
  });

  it('未解鎖卻有等級 → 正規化成未解鎖預設值（GDD §3 不變式 1）', () => {
    const save = parsedSave();
    stallsOf(save)['bubble-tea'] = { level: 5, unlocked: false, clerkHired: true, selling: true };

    const loaded = expectLoadOk(core.load(JSON.stringify(save)));
    expect(loaded.state.stalls['bubble-tea']).toEqual({
      level: 0,
      unlocked: false,
      clerkHired: false,
      selling: false,
    });
  });
});

describe('load 失敗分支（GDD §8.2）', () => {
  it('沒有存檔 → unsupported-shape / no-save，不是例外', () => {
    const result = core.load(null);
    expectLoadFailure(result, 'unsupported-shape');
    if (!result.ok) expect(result.detail).toBe('no-save');
  });

  it('JSON 壞掉 → corrupt', () => {
    expectLoadFailure(core.load('{"version":1,'), 'corrupt');
    expectLoadFailure(core.load('not json at all'), 'corrupt');
  });

  it('最外層不是物件 → unsupported-shape', () => {
    for (const raw of ['[]', '42', 'null', '"text"']) {
      expectLoadFailure(core.load(raw), 'unsupported-shape');
    }
  });

  it('version 缺漏、非整數或非數字 → unsupported-shape', () => {
    for (const version of [undefined, 1.5, '1', null]) {
      const save = parsedSave();
      save['version'] = version;
      expectLoadFailure(core.load(JSON.stringify(save)), 'unsupported-shape');
    }
  });

  it('版本比程式新 → unknown-version', () => {
    const save = parsedSave();
    save['version'] = BALANCE_CONFIG.save.currentVersion + 1;
    expectLoadFailure(core.load(JSON.stringify(save)), 'unknown-version');
  });

  it('版本低於 minSupportedVersion → unsupported-shape', () => {
    const save = parsedSave();
    save['version'] = BALANCE_CONFIG.save.minSupportedVersion - 1;
    expectLoadFailure(core.load(JSON.stringify(save)), 'unsupported-shape');
  });

  it('介於 minSupportedVersion 與 currentVersion 之間、又沒有遷移函式 → unsupported-shape', () => {
    // currentVersion = 2 的設定下，version 1 沒有對應的遷移（本版只有 v0 → v1）。
    const futureConfig: BalanceConfig = {
      ...BALANCE_CONFIG,
      save: { ...BALANCE_CONFIG.save, currentVersion: 2, minSupportedVersion: 1 },
    };
    const futureCore = createCore(futureConfig);
    const save = parsedSave();
    save['version'] = 1;
    expectLoadFailure(futureCore.load(JSON.stringify(save)), 'unsupported-shape');
  });

  it('state 是陣列 → unsupported-shape', () => {
    const save = parsedSave();
    save['state'] = [];
    expectLoadFailure(core.load(JSON.stringify(save)), 'unsupported-shape');
  });

  it('信封缺 savedAt / state → unsupported-shape', () => {
    const noSavedAt = parsedSave();
    delete noSavedAt['savedAt'];
    expectLoadFailure(core.load(JSON.stringify(noSavedAt)), 'unsupported-shape');

    const noState = parsedSave();
    delete noState['state'];
    expectLoadFailure(core.load(JSON.stringify(noState)), 'unsupported-shape');
  });

  it('state 缺 balance / lastSettledAt / stalls → unsupported-shape', () => {
    for (const field of ['balance', 'lastSettledAt', 'stalls'] as const) {
      const save = parsedSave();
      delete stateOf(save)[field];
      expectLoadFailure(core.load(JSON.stringify(save)), 'unsupported-shape');
    }
  });

  it('balance 是負數或非有限數 → unsupported-shape', () => {
    for (const balance of [-1, '123', null]) {
      const save = parsedSave();
      stateOf(save)['balance'] = balance;
      expectLoadFailure(core.load(JSON.stringify(save)), 'unsupported-shape');
    }
  });

  it('攤位欄位缺漏或型別錯誤 → unsupported-shape', () => {
    const missingField = parsedSave();
    stallsOf(missingField)['chicken-steak'] = { level: 1, unlocked: true, clerkHired: false };
    expectLoadFailure(core.load(JSON.stringify(missingField)), 'unsupported-shape');

    const badLevel = parsedSave();
    stallsOf(badLevel)['chicken-steak'] = { level: 1.5, unlocked: true, clerkHired: false, selling: false };
    expectLoadFailure(core.load(JSON.stringify(badLevel)), 'unsupported-shape');

    const negativeLevel = parsedSave();
    stallsOf(negativeLevel)['chicken-steak'] = { level: -2, unlocked: true, clerkHired: false, selling: false };
    expectLoadFailure(core.load(JSON.stringify(negativeLevel)), 'unsupported-shape');

    const badSelling = parsedSave();
    stallsOf(badSelling)['chicken-steak'] = { level: 1, unlocked: true, clerkHired: false, selling: 'yes' };
    expectLoadFailure(core.load(JSON.stringify(badSelling)), 'unsupported-shape');
  });
});

describe('v0 → v1 遷移（GDD §8.3）', () => {
  const v0Save = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
      version: 0,
      savedAt: T0 + 5_000,
      balance: 500,
      lastSavedAt: T0 + 4_000,
      stalls: [
        { id: 'chicken-steak', level: 4, unlocked: true, clerkHired: false },
        { id: 'bubble-tea', level: 2, unlocked: true, clerkHired: true },
        { id: 'unknown-stall', level: 7, unlocked: true, clerkHired: true },
      ],
      ...overrides,
    });

  it('遷移欄位照 §8.3：selling 一律 false、水位線用 lastSavedAt', () => {
    const loaded = expectLoadOk(core.load(v0Save()));

    expect(loaded.migratedFrom).toBe(0);
    expect(loaded.state.saveVersion).toBe(BALANCE_CONFIG.save.currentVersion);
    expect(loaded.state.balance).toBe(500);
    expect(loaded.state.lastSettledAt).toBe(T0 + 4_000);
    expect(loaded.state.stalls['chicken-steak']).toEqual({
      level: 4,
      unlocked: true,
      clerkHired: false,
      selling: false,
    });
    expect(loaded.state.stalls['bubble-tea']).toEqual({
      level: 2,
      unlocked: true,
      clerkHired: true,
      selling: false,
    });
    // v0 沒有的攤位補預設、未知 id 忽略。
    expect(loaded.state.stalls['sausage']?.unlocked).toBe(false);
    expect(loaded.state.stalls['unknown-stall']).toBeUndefined();
  });

  it('缺 lastSavedAt → 用 savedAt 當水位線', () => {
    const save = JSON.parse(v0Save()) as Record<string, unknown>;
    delete save['lastSavedAt'];

    const loaded = expectLoadOk(core.load(JSON.stringify(save)));
    expect(loaded.state.lastSettledAt).toBe(T0 + 5_000);
  });

  it('lastSavedAt 型別錯誤 → unsupported-shape', () => {
    expectLoadFailure(core.load(v0Save({ lastSavedAt: 'yesterday' })), 'unsupported-shape');
  });

  it('v0 格式錯誤 → unsupported-shape，不丟例外', () => {
    expectLoadFailure(core.load(v0Save({ stalls: 'nope' })), 'unsupported-shape');
    expectLoadFailure(core.load(v0Save({ balance: -5 })), 'unsupported-shape');
    expectLoadFailure(core.load(v0Save({ stalls: [{ id: 'chicken-steak', level: '1', unlocked: true, clerkHired: false }] })), 'unsupported-shape');
    expectLoadFailure(core.load(v0Save({ stalls: [{ id: 'chicken-steak', level: 1, unlocked: true }] })), 'unsupported-shape');
    expectLoadFailure(core.load(v0Save({ stalls: ['nope'] })), 'unsupported-shape');
    expectLoadFailure(core.load(v0Save({ savedAt: 'now' })), 'unsupported-shape');
  });

  it('v0 的 level > maxLevel 一樣夾到上限', () => {
    const save = v0Save({
      stalls: [{ id: 'chicken-steak', level: 999, unlocked: true, clerkHired: false }],
    });
    const loaded = expectLoadOk(core.load(save));
    expect(loaded.state.stalls['chicken-steak']?.level).toBe(150);
  });
});
