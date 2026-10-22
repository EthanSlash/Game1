import { describe, expect, it } from 'vitest';

import { BALANCE } from './support/balance';
import { handBuiltState, snapStall, tickOver } from './support/fixtures';
import { HARNESS, freshEngine, requireCore } from './support/harness';
import { withinTolerance } from './support/oracle';

/**
 * 門面層（`GameEngine`）的流程行為 —— GDD v1.1 §5、§6。
 *
 * 門面與純函式層的差別只有三件事：
 * 1. 動作前會**先結算**（§5：「所有動作都是先 settle(now,'foreground')，再嘗試動作」）；
 * 2. 動作失敗回 `false`、不丟例外；
 * 3. 持有狀態，UI 只需要 `state()`。
 */
const CHICKEN = 'chicken-steak';
const TEA = 'bubble-tea';

/** 測試用起點（epoch 毫秒）。 */
const T0 = 1_700_000_000_000;

const describeCore = HARNESS.core === null ? describe.skip : describe;
const describeEngine = HARNESS.engine === null ? describe.skip : describe;

describeEngine('門面層流程（GDD §5、§6）', () => {
  it('動作前會先結算，再執行動作（GDD §5）', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    expect(engine.toggleSell(CHICKEN, T0)).toBe(true);

    // 10 秒後才動作：結算先入帳（1/秒 × 10 秒 = 10），再扣升級成本 10。
    expect(engine.upgrade(CHICKEN, T0 + 10_000)).toBe(true);

    const snapshot = engine.state();
    expect(snapshot.balance).toBe(0);
    expect(snapStall(snapshot, CHICKEN).level).toBe(2);
    expect(snapshot.lastSettledAt).toBe(T0 + 10_000);
  });

  it('動作失敗回 false、不丟例外（同一個 now 時狀態完全不變）', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    const before = engine.state();

    // 沒有開賣 → 沒有收益 → 餘額 0，買不起 10 元的升級。
    expect(() => engine.upgrade(CHICKEN, T0)).not.toThrow();
    expect(engine.upgrade(CHICKEN, T0)).toBe(false);
    expect(engine.state()).toEqual(before);
  });

  it('動作失敗但時間有推進時：只有結算的部分會變（GDD §5 的失敗語意）', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);

    // 10 秒後買不起（升級要 10 元，但結算後只有 10 元 → 其實買得起；
    // 這裡改成雇用店員（要 150 元）才會失敗）。
    expect(engine.hire(CHICKEN, T0 + 10_000)).toBe(false);

    const snapshot = engine.state();
    // 失敗不動狀態，但結算照常：10 秒 × 1/秒 = 10。
    expect(withinTolerance(snapshot.balance, 10)).toBe(true);
    expect(snapStall(snapshot, CHICKEN).clerkHired).toBe(false);
    expect(snapStall(snapshot, CHICKEN).level).toBe(1);
  });

  it('tick 前景進帳：速率 × 經過時間', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);

    engine.tick(T0 + 30_000);

    expect(withinTolerance(engine.state().balance, 30)).toBe(true);
    expect(withinTolerance(engine.state().incomePerSec, 1)).toBe(true);
  });

  it('save(now) 只序列化、不結算', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);
    engine.tick(T0 + 10_000);
    const before = engine.state();

    const raw = engine.save(T0 + 10_000);

    expect(typeof raw).toBe('string');
    expect(engine.state().balance).toBe(before.balance);
    expect(engine.state().lastSettledAt).toBe(before.lastSettledAt);
    // savedAt = 呼叫 save 的時間（GDD §8.1）。
    const envelope: unknown = JSON.parse(raw);
    expect((envelope as { savedAt: number }).savedAt).toBe(T0 + 10_000);
  });

  it('解鎖後新攤位要自己按開賣才會有收益（GDD §3 不變式 4）', () => {
    const engine = freshEngine();
    engine.init(T0, null);
    engine.toggleSell(CHICKEN, T0);
    tickOver(engine, T0, T0 + 400_000, BALANCE);
    expect(engine.state().balance).toBe(400);

    expect(engine.unlock(TEA, T0 + 400_000)).toBe(true);

    const tea = snapStall(engine.state(), TEA);
    expect(tea.unlocked).toBe(true);
    expect(tea.level).toBe(1);
    expect(tea.selling).toBe(false);
    expect(tea.clerkHired).toBe(false);
    // 新攤位沒開賣 → 沒有收益。
    expect(tea.incomePerSec).toBe(0);
    expect(engine.state().incomePerSec).toBe(1);
  });
});

describeCore('快照欄位規則（GDD §5.1）', () => {
  it('incomePerSec：未解鎖或沒店員又沒開賣 → 0', () => {
    const core = requireCore();
    const state = core.createInitialState(T0);
    const snapshot = core.snapshot(state);

    expect(snapStall(snapshot, CHICKEN).incomePerSec).toBe(0);
    expect(snapStall(snapshot, TEA).incomePerSec).toBe(0);
    expect(snapshot.incomePerSec).toBe(0);
    expect(snapshot.anyClerkHired).toBe(false);
  });

  it('成本欄位：已解鎖 / 未解鎖 / 已雇用 / 達等級上限 的 null 條件', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: {
        [CHICKEN]: { level: 1, unlocked: true, clerkHired: true },
        [TEA]: { level: 1, unlocked: false },
      },
    });
    const snapshot = core.snapshot(state);

    // 已解鎖 → unlockCost 為 null。
    expect(snapStall(snapshot, CHICKEN).unlockCost).toBeNull();
    // 未解鎖 → unlockCost 顯示 balance.json 的值（不看解鎖鏈前提）。
    expect(snapStall(snapshot, TEA).unlockCost).toBe(
      BALANCE.stalls.find((s) => s.id === TEA)?.unlockCost,
    );
    // 已雇用店員 → hireCost 為 null。
    expect(snapStall(snapshot, CHICKEN).hireCost).toBeNull();
    // 未解鎖 → hireCost 為 null。
    expect(snapStall(snapshot, TEA).hireCost).toBeNull();
    // 已解鎖、未達上限 → upgradeCost 有值。
    expect(snapStall(snapshot, CHICKEN).upgradeCost).toBe(10);
    // 未解鎖 → upgradeCost 為 null。
    expect(snapStall(snapshot, TEA).upgradeCost).toBeNull();
  });

  it('canUnlock / canUpgrade / canHire / canToggleSell 的條件', () => {
    const core = requireCore();
    // 餘額 0：買得起 0 元的第一攤（但它已解鎖），買不起後面的攤位。
    const poor = core.createInitialState(T0);
    const poorSnapshot = core.snapshot(poor);
    expect(snapStall(poorSnapshot, TEA).canUnlock).toBe(false);
    expect(snapStall(poorSnapshot, CHICKEN).canUpgrade).toBe(false);
    expect(snapStall(poorSnapshot, CHICKEN).canHire).toBe(false);
    // 沒店員 → 可以切換開賣。
    expect(snapStall(poorSnapshot, CHICKEN).canToggleSell).toBe(true);

    // 餘額很多：可以解鎖、升級、雇用。
    const rich = handBuiltState(BALANCE, {
      balance: 1_000_000,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true } },
    });
    const richSnapshot = core.snapshot(rich);
    expect(snapStall(richSnapshot, TEA).canUnlock).toBe(true); // 前一攤已解鎖且錢夠
    expect(snapStall(richSnapshot, CHICKEN).canUpgrade).toBe(true);
    expect(snapStall(richSnapshot, CHICKEN).canHire).toBe(true);

    // 前一攤還沒解鎖 → 即使錢很多也不能解鎖後面的攤位。
    const chainBroken = handBuiltState(BALANCE, {
      balance: 1_000_000,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 0, unlocked: false } },
    });
    expect(snapStall(core.snapshot(chainBroken), TEA).canUnlock).toBe(false);

    // 已有店員 → 不能切換開賣。
    const hired = handBuiltState(BALANCE, {
      balance: 1_000_000,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });
    expect(snapStall(core.snapshot(hired), CHICKEN).canToggleSell).toBe(false);
  });

  it('anyClerkHired：至少一攤有店員就是 true', () => {
    const core = requireCore();
    const state = handBuiltState(BALANCE, {
      balance: 0,
      lastSettledAt: T0,
      stalls: { [CHICKEN]: { level: 1, unlocked: true, clerkHired: true } },
    });
    const snapshot = core.snapshot(state);
    expect(snapshot.anyClerkHired).toBe(true);
    expect(snapStall(snapshot, CHICKEN).clerkHired).toBe(true);
  });
});
