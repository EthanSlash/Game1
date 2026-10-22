import { describe, expect, it } from 'vitest';

import { BALANCE, stallDef } from './support/balance';
import { handBuiltState, stallOf, tickOver } from './support/fixtures';
import { HARNESS, freshEngine, requireCore } from './support/harness';

/**
 * D. 存檔 / 讀檔（GDD v1.1 §8、§9 D1–D5）。
 *
 * 驗的是兩件事：
 * 1. **存檔能完整還原**（金錢、等級、解鎖、店員、開賣狀態、水位線）。
 * 2. **壞掉的存檔不會讓遊戲崩掉**（損毀／缺欄位／舊版／未知版本都有明確結果）。
 *
 * 存檔格式由 GDD §8.1 凍結（`{version, savedAt, state}`），所以測試可以直接
 * 解析字串、拿來改壞再讀回；這是規格，不是對實作內部格式的假設。
 */
const CHICKEN = 'chicken-steak';
const TEA = 'bubble-tea';

/** 測試用起點（epoch 毫秒）。 */
const T0 = 1_700_000_000_000;

const describeCore = HARNESS.core === null ? describe.skip : describe;
const describeEngine = HARNESS.engine === null ? describe.skip : describe;

/** 讀檔而且保證不會丟例外。 */
function loadSafely(raw: string | null): ReturnType<ReturnType<typeof requireCore>['load']> {
  const core = requireCore();
  let captured: ReturnType<typeof core.load> | null = null;
  expect(() => {
    captured = core.load(raw);
  }).not.toThrow();
  if (captured === null) throw new Error('load() 沒有回傳結果');
  return captured;
}

/** 解析存檔字串；不是合法 JSON 就直接讓測試紅掉（那本身就是 bug）。 */
function parseSave(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('存檔不是 JSON 物件');
  return parsed as Record<string, unknown>;
}

/** 存檔信封裡的 state。 */
function saveState(raw: string): Record<string, unknown> {
  const envelope = parseSave(raw);
  const state = envelope['state'];
  if (typeof state !== 'object' || state === null) throw new Error('存檔缺 state 欄位');
  return state as Record<string, unknown>;
}

describeCore('D 存檔 / 讀檔（純函式層，GDD §8）', () => {
  it('D1 serialize → load：金錢、等級、解鎖、店員、開賣狀態、水位線都回來', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 12_345.5,
      lastSettledAt: T0,
      stalls: {
        [CHICKEN]: { level: 7, unlocked: true, clerkHired: true, selling: false },
        [TEA]: { level: 3, unlocked: true, clerkHired: false, selling: true },
      },
    });

    const raw = core.serialize(state, T0 + 5_000);
    const loaded = loadSafely(raw);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error('讀檔應該成功');
    expect(loaded.state.balance).toBe(12_345.5);
    expect(loaded.state.lastSettledAt).toBe(T0);
    expect(loaded.migratedFrom).toBeNull();

    const chicken = stallOf(loaded.state, CHICKEN);
    expect(chicken.level).toBe(7);
    expect(chicken.unlocked).toBe(true);
    expect(chicken.clerkHired).toBe(true);
    expect(chicken.selling).toBe(false);

    const tea = stallOf(loaded.state, TEA);
    expect(tea.level).toBe(3);
    expect(tea.unlocked).toBe(true);
    expect(tea.clerkHired).toBe(false);
    expect(tea.selling).toBe(true);
  });

  it('D1 存檔格式符合 GDD §8.1：version / savedAt / state，且含全部攤位', () => {
    const core = requireCore();
    const state = core.createInitialState(T0);
    const raw = core.serialize(state, T0 + 5_000);

    const envelope = parseSave(raw);
    expect(envelope['version']).toBe(BALANCE.save.currentVersion);
    expect(envelope['savedAt']).toBe(T0 + 5_000);

    const stateObj = saveState(raw);
    expect(stateObj['saveVersion']).toBe(BALANCE.save.currentVersion);
    const stalls = stateObj['stalls'];
    expect(typeof stalls).toBe('object');
    const stallMap = stalls as Record<string, unknown>;
    // 未解鎖的攤位也要寫（值為 0 / false）。
    for (const def of BALANCE.stalls) {
      expect(stallMap[def.id], `存檔少了攤位 ${def.id}`).toBeTypeOf('object');
    }
  });

  it('D2 存檔損毀（不是 JSON）：回 corrupt，不丟例外', () => {
    const result = loadSafely('<<<這不是 JSON>>>');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('讀檔應該失敗');
    expect(result.reason).toBe('corrupt');
  });

  it('D3 缺必要欄位：回 unsupported-shape，不丟例外', () => {
    const missingEnvelope = loadSafely('{"version":1}');
    expect(missingEnvelope.ok).toBe(false);
    if (missingEnvelope.ok) throw new Error('讀檔應該失敗');
    expect(missingEnvelope.reason).toBe('unsupported-shape');

    const missingStateFields = loadSafely(
      JSON.stringify({ version: 1, savedAt: T0, state: { balance: 10 } }),
    );
    expect(missingStateFields.ok).toBe(false);
    if (missingStateFields.ok) throw new Error('讀檔應該失敗');
    expect(missingStateFields.reason).toBe('unsupported-shape');
  });

  it('D3 版本不是 0 或 1（負數、非整數）：回 unsupported-shape', () => {
    for (const version of [-1, 1.5]) {
      const result = loadSafely(
        JSON.stringify({ version, savedAt: T0, state: { saveVersion: version, balance: 0, lastSettledAt: T0, stalls: {} } }),
      );
      expect(result.ok, `version = ${version} 應該被拒絕`).toBe(false);
      if (result.ok) throw new Error('讀檔應該失敗');
      expect(result.reason).toBe('unsupported-shape');
    }
  });

  it('D4 版本 0 存檔：依 GDD §8.3 遷移，migratedFrom = 0，數值正確', () => {
    const v0 = {
      version: 0,
      savedAt: T0,
      balance: 500,
      lastSavedAt: T0 - 30_000,
      stalls: [{ id: CHICKEN, level: 4, unlocked: true, clerkHired: true }],
    };

    const result = loadSafely(JSON.stringify(v0));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('讀檔應該成功');
    expect(result.migratedFrom).toBe(0);
    expect(result.state.balance).toBe(500);
    // lastSettledAt = lastSavedAt（沒有就用 savedAt）。
    expect(result.state.lastSettledAt).toBe(T0 - 30_000);
    expect(result.state.saveVersion).toBe(BALANCE.save.currentVersion);

    // 攤位陣列 → Record，selling 補 false，其他欄位照抄。
    const chicken = stallOf(result.state, CHICKEN);
    expect(chicken.level).toBe(4);
    expect(chicken.unlocked).toBe(true);
    expect(chicken.clerkHired).toBe(true);
    expect(chicken.selling).toBe(false);

    // balance.json 有、v0 存檔沒有的攤位 → 補預設（未解鎖 Lv0）。
    const tea = stallOf(result.state, TEA);
    expect(tea.level).toBe(0);
    expect(tea.unlocked).toBe(false);
    expect(tea.clerkHired).toBe(false);
    expect(tea.selling).toBe(false);
  });

  it('D4 v0 存檔缺 lastSavedAt 時用 savedAt 當水位線', () => {
    const v0 = {
      version: 0,
      savedAt: T0,
      balance: 10,
      stalls: [{ id: CHICKEN, level: 1, unlocked: true, clerkHired: false }],
    };

    const result = loadSafely(JSON.stringify(v0));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('讀檔應該成功');
    expect(result.migratedFrom).toBe(0);
    expect(result.state.lastSettledAt).toBe(T0);
  });

  it('D5 未知更高版本：回 unknown-version，不丟例外', () => {
    const core = requireCore();
    const raw = core.serialize(core.createInitialState(T0), T0);
    const envelope = parseSave(raw);
    envelope['version'] = 999_999;
    const stateObj = envelope['state'];
    if (typeof stateObj === 'object' && stateObj !== null) {
      (stateObj as Record<string, unknown>)['saveVersion'] = 999_999;
    }

    const result = loadSafely(JSON.stringify(envelope));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('讀檔應該失敗');
    expect(result.reason).toBe('unknown-version');
  });

  it('load(null) 回 unsupported-shape（門面不走這條）', () => {
    const result = loadSafely(null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('讀檔應該失敗');
    expect(result.reason).toBe('unsupported-shape');
  });

  it('存檔少了某個攤位不算錯：補預設值', () => {
    const core = requireCore();
    const raw = core.serialize(core.createInitialState(T0), T0);
    const stateObj = saveState(raw);
    const stalls = stateObj['stalls'] as Record<string, unknown>;
    delete stalls[TEA];

    const result = loadSafely(JSON.stringify({ version: 1, savedAt: T0, state: stateObj }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('讀檔應該成功');
    const tea = stallOf(result.state, TEA);
    expect(tea.level).toBe(0);
    expect(tea.unlocked).toBe(false);
    expect(tea.clerkHired).toBe(false);
    expect(tea.selling).toBe(false);
  });

  it('存檔出現 balance.json 沒有的攤位 id 不算錯：忽略那一筆', () => {
    const core = requireCore();
    const raw = core.serialize(core.createInitialState(T0), T0);
    const stateObj = saveState(raw);
    const stalls = stateObj['stalls'] as Record<string, unknown>;
    stalls['ghost-stall'] = { level: 9, unlocked: true, clerkHired: true, selling: true };

    const result = loadSafely(JSON.stringify({ version: 1, savedAt: T0, state: stateObj }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('讀檔應該成功');
    expect(result.state.stalls['ghost-stall']).toBeUndefined();
  });

  it('讀檔時 level 超過 maxLevel 會夾到 maxLevel（不算損毀）', () => {
    const core = requireCore();
    const raw = core.serialize(core.createInitialState(T0), T0);
    const stateObj = saveState(raw);
    const stalls = stateObj['stalls'] as Record<string, unknown>;
    const chicken = stalls[CHICKEN] as Record<string, unknown>;
    chicken['level'] = 9999;

    const result = loadSafely(JSON.stringify({ version: 1, savedAt: T0, state: stateObj }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('讀檔應該成功');
    const def = stallDef(BALANCE, CHICKEN);
    expect(def.maxLevel).not.toBeNull();
    expect(stallOf(result.state, CHICKEN).level).toBe(def.maxLevel);
  });

  /**
   * D6（規格空白 #2，怪獸8號 2026-10-22 核准；GDD v1.2 待補文字）：
   * **已解鎖但 `level = 0` 的存檔，讀檔時正規化成 Lv1，不算損毀。**
   *
   * 為什麼要驗：GDD §3 不變式 2 說「已解鎖的攤位 level >= 1」，
   * 但 §8.2 的損毀表只列「非整數或 < 0」。這種存檔要嘛正規化、要嘛擋掉，
   * 規格原本沒寫 —— 核准後採正規化（守住 §3 不變式 2）。
   */
  it('D6 已解鎖但 level = 0：讀檔時正規化成 Lv1，不算損毀', () => {
    const core = requireCore();
    const raw = core.serialize(core.createInitialState(T0), T0);
    const stateObj = saveState(raw);
    const stalls = stateObj['stalls'] as Record<string, unknown>;
    const chicken = stalls[CHICKEN] as Record<string, unknown>;
    chicken['unlocked'] = true;
    chicken['level'] = 0;

    const result = loadSafely(
      JSON.stringify({ version: BALANCE.save.currentVersion, savedAt: T0, state: stateObj }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('讀檔應該成功');
    expect(stallOf(result.state, CHICKEN).unlocked).toBe(true);
    expect(stallOf(result.state, CHICKEN).level).toBe(1);
  });

  /**
   * D7（規格空白 #3，怪獸8號 2026-10-22 核准；GDD v1.2 待補文字）：
   * **版本以外層信封的 `version` 為準，內層的 `saveVersion` 不檢查，
   * 讀檔後一律改寫成 `currentVersion`。**
   *
   * GDD §8.1 目前寫「`state.saveVersion` 必須與 `version` 相同」，
   * 但 §8.2 的失敗表沒有這一列 —— 規格空白。核准後採「以信封為準」。
   */
  it('D7 版本以信封為準：內層 saveVersion 不一致不擋讀檔，讀完改寫成 currentVersion', () => {
    const core = requireCore();
    const raw = core.serialize(core.createInitialState(T0), T0);
    const stateObj = saveState(raw);
    stateObj['saveVersion'] = 999;

    const result = loadSafely(
      JSON.stringify({ version: BALANCE.save.currentVersion, savedAt: T0, state: stateObj }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('讀檔應該成功');
    expect(result.state.saveVersion).toBe(BALANCE.save.currentVersion);
  });
});

describeEngine('D 存檔 / 讀檔（門面層，GDD §6）', () => {
  it('D1 門面：動作 → save → init（讀檔）→ 進度保留', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);
    tickOver(engine, T0, T0 + 150_000, BALANCE);
    expect(engine.state().balance).toBe(150);
    expect(engine.hire(CHICKEN, T0 + 150_000)).toBe(true);

    const raw = engine.save(T0 + 150_000);
    const before = engine.state();

    // 新的引擎讀同一份存檔：狀態必須完全一致。
    const restored = freshEngine();
    restored.init(T0 + 150_000, raw);

    const after = restored.state();
    expect(after.balance).toBe(before.balance);
    expect(after.lastSettledAt).toBe(before.lastSettledAt);
    const chicken = after.stalls.find((s) => s.id === CHICKEN);
    expect(chicken?.level).toBe(before.stalls.find((s) => s.id === CHICKEN)?.level);
    expect(chicken?.clerkHired).toBe(true);
    expect(chicken?.selling).toBe(true);
  });

  it('D2 門面讀到損毀存檔：開新局並回報 loadError，不丟例外', () => {
    const engine = freshEngine();

    const frame = engine.init(T0, '<<<壞掉的存檔>>>');

    expect(frame.loadError).toBe('corrupt');
    expect(engine.state().balance).toBe(BALANCE.startingBalance);
    // 新局：第一攤已解鎖 Lv1，其餘未解鎖。
    const first = engine.state().stalls[0];
    expect(first?.unlocked).toBe(true);
    expect(first?.level).toBe(1);
  });

  it('init(now, null) 不是錯誤：loadError 為 null', () => {
    const engine = freshEngine();

    const frame = engine.init(T0, null);

    expect(frame.loadError).toBeNull();
    expect(engine.state().balance).toBe(BALANCE.startingBalance);
  });

  it('init(now, null) 開新局：只有第一攤解鎖 Lv1、其餘 Lv0 未解鎖（GDD §3）', () => {
    const engine = freshEngine();
    engine.init(T0, null);

    const stalls = engine.state().stalls;
    expect(stalls).toHaveLength(BALANCE.stalls.length);
    const first = stalls[0];
    expect(first?.id).toBe(BALANCE.stalls[0]?.id);
    expect(first?.unlocked).toBe(true);
    expect(first?.level).toBe(1);
    expect(first?.selling).toBe(false);
    expect(first?.clerkHired).toBe(false);
    for (const stall of stalls.slice(1)) {
      expect(stall.unlocked).toBe(false);
      expect(stall.level).toBe(0);
    }
  });
});
