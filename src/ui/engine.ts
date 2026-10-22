/**
 * M2 假引擎 — `GameEngine` 門面（契約定案 `3458165`，2026-10-22 merge）的假資料期實作。
 *
 * - 型別一律 import 自 `src/core` 公開入口，本檔不再自定任何介面。
 * - 行為照 `docs/GDD.md` v1.1：§4 公式（§4.6 前景長空檔自動轉離線）、§5 動作、
 *   §6 事件流程、§6.1 存檔時機（UI 主責，在 `src/ui/store.ts`）、§8 存檔。
 *   數值只來自 `data/balance.json`，本檔不寫死任何遊戲數值（硬規則 2）。
 * - M1 的 `createGameEngine` 上線後，store 改接真引擎、本檔刪除；UI 不需改動。
 * - 黑箱驗收（A1–G8 等）以 M1 的純函式層為準，不測這個假引擎。
 */
import balanceJson from '../../data/balance.json';
import type {
  ActionResult,
  BalanceConfig,
  EngineFrame,
  GameEngine,
  GameSnapshot,
  GameState,
  LoadResult,
  MilestoneDefinition,
  SettleMode,
  SettleResult,
  StallDefinition,
  StallId,
  StallSnapshot,
  StallState,
  TimestampMs,
} from '../core';

/** 唯一數值來源（GDD §13：不得把數值寫死在程式碼裡）。 */
const CONFIG: BalanceConfig = balanceJson;
const STALL_DEFS = CONFIG.stalls;
const OFFLINE_CAP_MS = CONFIG.offline.capSeconds * 1000;

/* ===== 狀態建構 ===== */

function emptyStall(): StallState {
  return { level: 0, unlocked: false, clerkHired: false, selling: false };
}

/** 全新遊戲：第一攤解鎖 Lv1、未雇店員、未開賣（GDD §3）。 */
function createInitialState(now: TimestampMs): GameState {
  const stalls: Record<StallId, StallState> = {};
  STALL_DEFS.forEach((def, index) => {
    stalls[def.id] =
      index === 0
        ? { level: 1, unlocked: true, clerkHired: false, selling: false }
        : emptyStall();
  });
  return {
    saveVersion: CONFIG.save.currentVersion,
    balance: CONFIG.startingBalance,
    stalls,
    lastSettledAt: now,
  };
}

/* ===== 公式（GDD §4） ===== */

/** 里程碑倍率（累乘，GDD §4.1）。 */
function milestoneMultiplier(level: number): number {
  let acc = 1;
  for (const m of CONFIG.milestones) {
    if (level >= m.level) acc *= m.multiplier;
  }
  return acc;
}

/** 單攤每秒收益（浮點，不取整，GDD §4.2；level < 1 防呆回 0）。 */
function stallRate(def: StallDefinition, level: number, clerkHired: boolean): number {
  if (level < 1) return 0;
  const growth = CONFIG.incomeGrowthPerLevel ** (level - 1);
  const clerkFactor = clerkHired ? CONFIG.clerkIncomeMultiplier : 1;
  return def.baseIncomePerSec * growth * milestoneMultiplier(level) * clerkFactor;
}

function maxLevelOf(def: StallDefinition): number {
  return def.maxLevel ?? Number.POSITIVE_INFINITY;
}

/** 升級成本（整數 floor，GDD §4.4）。 */
function upgradeCostOf(def: StallDefinition, level: number): number | null {
  if (level >= maxLevelOf(def)) return null;
  return Math.floor(def.upgradeCostBase * def.upgradeCostGrowth ** (level - 1));
}

/** 該模式下的總速率（GDD §4.3：前景含手動開賣，離線只算有店員的攤位）。 */
function rateFor(state: GameState, mode: SettleMode): number {
  let rate = 0;
  for (const def of STALL_DEFS) {
    const s = state.stalls[def.id];
    if (s === undefined) continue;
    if (mode === 'offline' ? s.unlocked && s.clerkHired : s.unlocked && (s.clerkHired || s.selling)) {
      rate += stallRate(def, s.level, s.clerkHired);
    }
  }
  return rate;
}

/** 結算（GDD §4.6；幂等、時鐘倒退不扣錢、長空檔自動轉離線、水位線對齊 now）。 */
function settle(state: GameState, now: TimestampMs, requested: SettleMode): SettleResult {
  const elapsedMs = now - state.lastSettledAt;
  if (elapsedMs < 0) {
    return {
      state: { ...state, lastSettledAt: now },
      gained: 0,
      elapsedMs: 0,
      creditedMs: 0,
      capped: false,
      timeWentBackwards: true,
    };
  }
  // GDD §4.6：要求前景但超過長空檔門檻 → 這次改用離線規則（只計店員、套上限）。
  const maxGapMs = CONFIG.foreground.maxGapSeconds * 1000;
  const mode: SettleMode =
    requested === 'foreground' && elapsedMs > maxGapMs ? 'offline' : requested;
  const creditedMs = mode === 'offline' ? Math.min(elapsedMs, OFFLINE_CAP_MS) : elapsedMs;
  const capped = mode === 'offline' && elapsedMs > OFFLINE_CAP_MS;
  const gained = (rateFor(state, mode) * creditedMs) / 1000;
  return {
    state: { ...state, balance: state.balance + gained, lastSettledAt: now },
    gained,
    elapsedMs,
    creditedMs,
    capped,
    timeWentBackwards: false,
  };
}

/* ===== 快照（GDD §5.1） ===== */

function prevMilestoneLevelOf(level: number): number {
  let prev = 0;
  for (const m of CONFIG.milestones) {
    if (level >= m.level) prev = Math.max(prev, m.level);
  }
  return prev;
}

function nextMilestoneOf(level: number): MilestoneDefinition | null {
  for (const m of CONFIG.milestones) {
    if (m.level > level) return m;
  }
  return null;
}

function snapshotOf(state: GameState): GameSnapshot {
  let anyClerk = false;
  let incomePerSec = 0;
  const stalls: StallSnapshot[] = STALL_DEFS.map((def, index) => {
    const s = state.stalls[def.id] ?? emptyStall();
    if (s.clerkHired) anyClerk = true;
    const active = s.unlocked && (s.clerkHired || s.selling);
    const income = active ? stallRate(def, s.level, s.clerkHired) : 0;
    incomePerSec += income;

    const max = maxLevelOf(def);
    const cost = s.unlocked ? upgradeCostOf(def, s.level) : null;

    const prev =
      index === 0 ? true : (state.stalls[STALL_DEFS[index - 1]?.id ?? '']?.unlocked ?? false);

    const nextM = nextMilestoneOf(s.level);
    const prevM = prevMilestoneLevelOf(s.level);
    const progress =
      nextM === null ? 0 : Math.min(1, Math.max(0, (s.level - prevM) / (nextM.level - prevM)));

    return {
      id: def.id,
      name: def.name,
      emoji: def.emoji,
      unlocked: s.unlocked,
      level: s.level,
      incomePerSec: income,
      clerkHired: s.clerkHired,
      selling: s.selling,
      unlockCost: s.unlocked ? null : def.unlockCost,
      upgradeCost: cost,
      hireCost: !s.unlocked || s.clerkHired ? null : def.hireCost,
      canUnlock: !s.unlocked && prev && state.balance >= def.unlockCost,
      canUpgrade: s.unlocked && s.level < max && cost !== null && state.balance >= cost,
      canHire: s.unlocked && !s.clerkHired && state.balance >= def.hireCost,
      canToggleSell: s.unlocked && !s.clerkHired,
      nextMilestone: nextM === null ? null : { level: nextM.level, multiplier: nextM.multiplier, progress },
    };
  });

  return {
    balance: state.balance,
    incomePerSec,
    anyClerkHired: anyClerk,
    stalls,
    lastSettledAt: state.lastSettledAt,
  };
}

/* ===== 動作（純函式，GDD §5；不含結算） ===== */

function ok(state: GameState, mutate: (s: GameState) => GameState, spent: number): Extract<ActionResult, { ok: true }> {
  return { ok: true, state: mutate(state), spent };
}

function fai(state: GameState, reason: 'no-such-stall' | 'stall-locked' | 'already-unlocked' | 'max-level' | 'clerk-already-hired' | 'insufficient-funds'): Extract<ActionResult, { ok: false }> {
  return { ok: false, reason, state };
}

function findDef(id: StallId): StallDefinition | undefined {
  return STALL_DEFS.find((d) => d.id === id);
}

function actUpgrade(state: GameState, id: StallId): ActionResult {
  const def = findDef(id);
  const s = def === undefined ? undefined : state.stalls[def.id];
  if (def === undefined || s === undefined) return fai(state, 'no-such-stall');
  if (!s.unlocked) return fai(state, 'stall-locked');
  if (s.level >= maxLevelOf(def)) return fai(state, 'max-level');
  const cost = upgradeCostOf(def, s.level);
  if (cost === null || state.balance < cost) return fai(state, 'insufficient-funds');
  return ok(state, (st) => ({
    ...st,
    balance: st.balance - cost,
    stalls: { ...st.stalls, [id]: { ...s, level: s.level + 1 } },
  }), cost);
}

function actHire(state: GameState, id: StallId): ActionResult {
  const def = findDef(id);
  const s = def === undefined ? undefined : state.stalls[def.id];
  if (def === undefined || s === undefined) return fai(state, 'no-such-stall');
  if (!s.unlocked) return fai(state, 'stall-locked');
  if (s.clerkHired) return fai(state, 'clerk-already-hired');
  if (state.balance < def.hireCost) return fai(state, 'insufficient-funds');
  return ok(state, (st) => ({
    ...st,
    balance: st.balance - def.hireCost,
    stalls: { ...st.stalls, [id]: { ...s, clerkHired: true } },
  }), def.hireCost);
}

function actUnlock(state: GameState, id: StallId): ActionResult {
  const def = findDef(id);
  const s = def === undefined ? undefined : state.stalls[def.id];
  if (def === undefined || s === undefined) return fai(state, 'no-such-stall');
  if (s.unlocked) return fai(state, 'already-unlocked');
  const index = STALL_DEFS.findIndex((d) => d.id === id);
  const prevOk = index === 0 || (state.stalls[STALL_DEFS[index - 1]?.id ?? '']?.unlocked ?? false);
  if (!prevOk) return fai(state, 'stall-locked');
  if (state.balance < def.unlockCost) return fai(state, 'insufficient-funds');
  return ok(state, (st) => ({
    ...st,
    balance: st.balance - def.unlockCost,
    stalls: { ...st.stalls, [id]: { level: 1, unlocked: true, clerkHired: false, selling: false } },
  }), def.unlockCost);
}

function actToggleSell(state: GameState, id: StallId): ActionResult {
  const def = findDef(id);
  const s = def === undefined ? undefined : state.stalls[def.id];
  if (def === undefined || s === undefined) return fai(state, 'no-such-stall');
  if (!s.unlocked) return fai(state, 'stall-locked');
  if (s.clerkHired) return fai(state, 'clerk-already-hired');
  return ok(state, (st) => ({
    ...st,
    stalls: { ...st.stalls, [id]: { ...s, selling: !s.selling } },
  }), 0);
}

/* ===== 存檔（GDD §8） ===== */

type JsonRecord = Record<string, unknown>;

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function badShape(detail: string): LoadResult {
  return { ok: false, reason: 'unsupported-shape', detail };
}

/** v1 完整驗證（GDD §8.2）。 */
function loadV1(env: JsonRecord): LoadResult {
  const st = env['state'];
  if (typeof st !== 'object' || st === null) return badShape('缺 state');
  const s = st as JsonRecord;
  if (!isFiniteNum(s['balance']) || (s['balance'] as number) < 0) return badShape('balance 非有限數或負值');
  if (!isFiniteNum(s['lastSettledAt'])) return badShape('缺 lastSettledAt');
  const raw = s['stalls'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return badShape('stalls 非物件');

  const src = raw as JsonRecord;
  const stalls: Record<StallId, StallState> = {};
  for (const def of STALL_DEFS) {
    const entry = src[def.id];
    if (entry === undefined || entry === null) {
      stalls[def.id] = emptyStall();  // 缺攤位不算錯（GDD §8.2）
      continue;
    }
    if (typeof entry !== 'object') return badShape(`攤位 ${def.id} 型別錯誤`);
    const e = entry as JsonRecord;
    if (!isNonNegInt(e['level']) || typeof e['unlocked'] !== 'boolean' ||
        typeof e['clerkHired'] !== 'boolean' || typeof e['selling'] !== 'boolean') {
      return badShape(`攤位 ${def.id} 缺欄位或型別錯誤`);
    }
    const level = Math.min(e['level'] as number, maxLevelOf(def));
    stalls[def.id] = { level, unlocked: e['unlocked'] as boolean, clerkHired: e['clerkHired'] as boolean, selling: e['selling'] as boolean };
  }
  return {
    ok: true,
    state: {
      saveVersion: CONFIG.save.currentVersion,
      balance: s['balance'] as number,
      stalls,
      lastSettledAt: s['lastSettledAt'] as number,
    },
    migratedFrom: null,
  };
}

/** v0（M0 扁平形狀）→ v1 遷移（GDD §8.3）。 */
function migrateV0(env: JsonRecord): LoadResult {
  if (!isFiniteNum(env['balance']) || (env['balance'] as number) < 0) return badShape('v0 balance 非有限數或負值');
  const lastSavedAt = isFiniteNum(env['lastSavedAt']) ? env['lastSavedAt'] : env['savedAt'];
  if (!isFiniteNum(lastSavedAt)) return badShape('v0 缺 savedAt / lastSavedAt');
  if (!Array.isArray(env['stalls'])) return badShape('v0 stalls 非陣列');

  const stalls: Record<StallId, StallState> = {};
  for (const def of STALL_DEFS) stalls[def.id] = emptyStall();
  for (const item of env['stalls'] as unknown[]) {
    if (typeof item !== 'object' || item === null) return badShape('v0 stalls 條目型別錯誤');
    const it = item as JsonRecord;
    const id = typeof it['id'] === 'string' ? it['id'] : null;
    const def = id === null ? undefined : findDef(id);
    if (def === undefined) continue;  // balance.json 沒有的攤位：忽略
    if (!isNonNegInt(it['level']) || typeof it['unlocked'] !== 'boolean') {
      return badShape(`v0 攤位 ${id} 缺欄位或型別錯誤`);
    }
    const clerk = typeof it['clerkHired'] === 'boolean' ? it['clerkHired'] : false;
    const level = Math.min(it['level'] as number, maxLevelOf(def));
    stalls[def.id] = { level, unlocked: it['unlocked'] as boolean, clerkHired: clerk, selling: false };
  }
  return {
    ok: true,
    state: {
      saveVersion: CONFIG.save.currentVersion,
      balance: env['balance'] as number,
      stalls,
      lastSettledAt: lastSavedAt,
    },
    migratedFrom: 0,
  };
}

function load(raw: string | null): LoadResult {
  if (raw === null) return badShape('no-save');
  let env: unknown;
  try {
    env = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt', detail: 'JSON 解析失敗' };
  }
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    return { ok: false, reason: 'corrupt', detail: '根節點不是物件' };
  }
  const e = env as JsonRecord;
  const version = e['version'];
  if (typeof version !== 'number' || !Number.isInteger(version)) return badShape('version 非整數');
  if (version > CONFIG.save.currentVersion) {
    return { ok: false, reason: 'unknown-version', detail: `存檔版本 ${version} 大於現行程式支援 ${CONFIG.save.currentVersion}` };
  }
  if (version < CONFIG.save.minSupportedVersion) return badShape(`版本 ${version} 不在支援範圍`);
  return version === 0 ? migrateV0(e) : loadV1(e);
}

/* ===== 門面（GDD §6） ===== */

class FakeEngine implements GameEngine {
  private gameState: GameState;
  private hidden = false;

  constructor(now: TimestampMs) {
    this.gameState = createInitialState(now);
  }

  init(now: TimestampMs, savedState: string | null): EngineFrame {
    let loadError: EngineFrame['loadError'] = null;
    if (savedState !== null) {
      const result = load(savedState);
      if (result.ok) {
        this.gameState = result.state;
      } else {
        loadError = result.reason;
        this.gameState = createInitialState(now);
      }
    } else {
      this.gameState = createInitialState(now);
    }
    const r = settle(this.gameState, now, 'offline');
    this.gameState = r.state;
    return {
      snapshot: snapshotOf(this.gameState),
      offline: r.gained > 0 ? offlineOf(r) : null,
      loadError,
    };
  }

  tick(now: TimestampMs): EngineFrame {
    if (this.hidden) {
      // GDD §6：onHidden 之後、onVisible 之前一律忽略，避免與離線結算重複
      return { snapshot: snapshotOf(this.gameState), offline: null, loadError: null };
    }
    // GDD §6 / §4.6：前景長空檔改用離線規則結算，gained > 0 時 frame.offline 帶值
    // 讓 UI 跳彈窗（C6）。
    const maxGapMs = CONFIG.foreground.maxGapSeconds * 1000;
    const longGap = now - this.gameState.lastSettledAt > maxGapMs;
    const r = settle(this.gameState, now, longGap ? 'offline' : 'foreground');
    this.gameState = r.state;
    return {
      snapshot: snapshotOf(this.gameState),
      offline: r.gained > 0 ? offlineOf(r) : null,
      loadError: null,
    };
  }

  onHidden(now: TimestampMs): void {
    // GDD §6：先結清前景收益（長空檔由 settle 自動轉離線規則），再標記 hidden；
    // 只入帳、不帶 frame（不跳彈窗）。存檔由 UI 接手（§6.1）。
    const r = settle(this.gameState, now, 'foreground');
    this.gameState = r.state;
    this.hidden = true;
  }

  onVisible(now: TimestampMs): EngineFrame {
    this.hidden = false;
    const r = settle(this.gameState, now, 'offline');
    this.gameState = r.state;
    return {
      snapshot: snapshotOf(this.gameState),
      offline: r.gained > 0 ? offlineOf(r) : null,
      loadError: null,
    };
  }

  upgrade(id: StallId, now: TimestampMs): boolean {
    return this.act(id, now, actUpgrade);
  }

  hire(id: StallId, now: TimestampMs): boolean {
    return this.act(id, now, actHire);
  }

  unlock(id: StallId, now: TimestampMs): boolean {
    return this.act(id, now, actUnlock);
  }

  toggleSell(id: StallId, now: TimestampMs): boolean {
    return this.act(id, now, actToggleSell);
  }

  save(now: TimestampMs): string {
    return JSON.stringify({ version: CONFIG.save.currentVersion, savedAt: now, state: this.gameState });
  }

  state(): GameSnapshot {
    return snapshotOf(this.gameState);
  }

  /** 門面動作：先結算（失敗時結算照常進行，動作不動；GDD §5）。 */
  private act(id: StallId, now: TimestampMs, fn: (state: GameState, id: StallId) => ActionResult): boolean {
    const settled = settle(this.gameState, now, 'foreground');
    const result = fn(settled.state, id);
    this.gameState = result.ok ? result.state : settled.state;
    return result.ok;
  }
}

function offlineOf(r: SettleResult) {
  return {
    gained: r.gained,
    creditedMs: r.creditedMs,
    capped: r.capped,
    timeWentBackwards: r.timeWentBackwards,
  };
}

/** 假引擎工廠；M1 的 `createGameEngine` 上線後由 store 改呼叫真引擎。 */
export function createFakeEngine(): GameEngine {
  return new FakeEngine(Date.now());
}
