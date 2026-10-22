/**
 * 存檔序列化與讀檔驗證（GDD §8）。
 *
 * 這裡只有純函式：字串進、字串出 / 結果物件出，不碰 localStorage。
 * 讀檔**不得丟例外**，損毀或缺欄位一律回 `LoadResult` 的失敗分支（GDD §8.2）。
 */

import type {
  BalanceConfig,
  GameState,
  LoadFailureReason,
  LoadResult,
  SaveEnvelope,
  StallId,
  StallState,
  TimestampMs,
} from './api';

/** 未解鎖攤位的預設狀態（GDD §3 不變式 1）。 */
function defaultStallState(): StallState {
  return { level: 0, unlocked: false, clerkHired: false, selling: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function fail(reason: LoadFailureReason, detail: string): LoadResult {
  return { ok: false, reason, detail };
}

/**
 * 把讀進來的攤位狀態整理成 GDD §3 的不變式：
 * - 未解鎖 → 等級 0、沒有店員、沒有開賣。
 * - 已解鎖 → 等級至少 1，超過 `maxLevel` 夾到上限（GDD §8.2，不算損毀）。
 */
function normalizeStall(
  level: number,
  unlocked: boolean,
  clerkHired: boolean,
  selling: boolean,
  maxLevel: number | null,
): StallState {
  if (!unlocked) return defaultStallState();
  let normalizedLevel = level < 1 ? 1 : level;
  if (maxLevel !== null && normalizedLevel > maxLevel) normalizedLevel = maxLevel;
  return { level: normalizedLevel, unlocked: true, clerkHired, selling };
}

/** v1 的單一攤位條目；欄位缺漏或型別錯誤回 `null`（GDD §8.2）。 */
function parseStallState(raw: unknown, maxLevel: number | null): StallState | null {
  if (!isRecord(raw)) return null;
  const level = raw['level'];
  const unlocked = raw['unlocked'];
  const clerkHired = raw['clerkHired'];
  const selling = raw['selling'];
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 0) return null;
  if (typeof unlocked !== 'boolean' || typeof clerkHired !== 'boolean' || typeof selling !== 'boolean') {
    return null;
  }
  return normalizeStall(level, unlocked, clerkHired, selling, maxLevel);
}

/** 產生存檔字串；`stalls` 一定寫滿 `balance.json` 的全部攤位（GDD §8.1）。 */
export function serializeSave(config: BalanceConfig, state: GameState, now: TimestampMs): string {
  const stalls: Record<StallId, StallState> = {};
  for (const def of config.stalls) {
    const stall = state.stalls[def.id] ?? defaultStallState();
    stalls[def.id] = {
      level: stall.level,
      unlocked: stall.unlocked,
      clerkHired: stall.clerkHired,
      selling: stall.selling,
    };
  }

  const envelope: SaveEnvelope = {
    version: config.save.currentVersion,
    savedAt: now,
    state: {
      saveVersion: config.save.currentVersion,
      balance: state.balance,
      lastSettledAt: state.lastSettledAt,
      stalls,
    },
  };

  return JSON.stringify(envelope);
}

/** v1（現行版本）的讀檔驗證。 */
function parseVersion1(config: BalanceConfig, envelope: Record<string, unknown>): LoadResult {
  const savedAt = envelope['savedAt'];
  if (!isFiniteNumber(savedAt)) return fail('unsupported-shape', '信封缺少有效的 savedAt');

  const state = envelope['state'];
  if (!isRecord(state)) return fail('unsupported-shape', '信封缺少 state 物件');

  const balance = state['balance'];
  if (!isFiniteNumber(balance) || balance < 0) {
    return fail('unsupported-shape', 'state.balance 必須是 >= 0 的有限數');
  }

  const lastSettledAt = state['lastSettledAt'];
  if (!isFiniteNumber(lastSettledAt)) {
    return fail('unsupported-shape', 'state.lastSettledAt 必須是有限數');
  }

  const rawStalls = state['stalls'];
  if (!isRecord(rawStalls)) return fail('unsupported-shape', 'state.stalls 必須是物件');

  const stalls: Record<StallId, StallState> = {};
  for (const def of config.stalls) {
    const raw = rawStalls[def.id];
    if (raw === undefined) {
      // 存檔缺少某個攤位不算錯：補預設值（GDD §8.2）。
      stalls[def.id] = defaultStallState();
      continue;
    }
    const parsed = parseStallState(raw, def.maxLevel);
    if (parsed === null) {
      return fail('unsupported-shape', `攤位 ${def.id} 的欄位缺漏或型別錯誤`);
    }
    stalls[def.id] = parsed;
  }

  return {
    ok: true,
    state: { saveVersion: config.save.currentVersion, balance, lastSettledAt, stalls },
    migratedFrom: null,
  };
}

/** v0（M0 假資料期扁平形狀）→ v1（GDD §8.3）。 */
function migrateVersion0(config: BalanceConfig, envelope: Record<string, unknown>): LoadResult {
  const savedAt = envelope['savedAt'];
  if (!isFiniteNumber(savedAt)) return fail('unsupported-shape', 'v0 存檔缺少有效的 savedAt');

  const balance = envelope['balance'];
  if (!isFiniteNumber(balance) || balance < 0) {
    return fail('unsupported-shape', 'v0 存檔的 balance 必須是 >= 0 的有限數');
  }

  const lastSavedAt = envelope['lastSavedAt'];
  if (lastSavedAt !== undefined && !isFiniteNumber(lastSavedAt)) {
    return fail('unsupported-shape', 'v0 存檔的 lastSavedAt 型別錯誤');
  }
  const lastSettledAt = isFiniteNumber(lastSavedAt) ? lastSavedAt : savedAt;

  const rawStalls = envelope['stalls'];
  if (!Array.isArray(rawStalls)) return fail('unsupported-shape', 'v0 存檔的 stalls 必須是陣列');

  const savedById = new Map<StallId, StallState>();
  for (const entry of rawStalls) {
    if (!isRecord(entry)) return fail('unsupported-shape', 'v0 存檔的攤位條目型別錯誤');
    const id = entry['id'];
    const level = entry['level'];
    const unlocked = entry['unlocked'];
    const clerkHired = entry['clerkHired'];
    if (typeof id !== 'string') return fail('unsupported-shape', 'v0 存檔的攤位缺少 id');
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 0) {
      return fail('unsupported-shape', `v0 存檔的攤位 ${id} 等級不合法`);
    }
    if (typeof unlocked !== 'boolean' || typeof clerkHired !== 'boolean') {
      return fail('unsupported-shape', `v0 存檔的攤位 ${id} 欄位型別錯誤`);
    }
    // v0 沒有 selling 欄位，一律視為未開賣（GDD §8.3）。
    savedById.set(id, { level, unlocked, clerkHired, selling: false });
  }

  const stalls: Record<StallId, StallState> = {};
  for (const def of config.stalls) {
    const saved = savedById.get(def.id);
    // v0 沒有的攤位補預設值；balance.json 沒有的 id 直接忽略（GDD §8.2、§8.3）。
    stalls[def.id] =
      saved === undefined
        ? defaultStallState()
        : normalizeStall(saved.level, saved.unlocked, saved.clerkHired, false, def.maxLevel);
  }

  return {
    ok: true,
    state: { saveVersion: config.save.currentVersion, balance, lastSettledAt, stalls },
    migratedFrom: 0,
  };
}

/** 讀檔；任何輸入都不得丟例外。 */
export function loadSave(config: BalanceConfig, raw: string | null): LoadResult {
  if (raw === null) return fail('unsupported-shape', 'no-save');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail('corrupt', `JSON 解析失敗：${message}`);
  }

  if (!isRecord(parsed)) return fail('unsupported-shape', '存檔最外層必須是 JSON 物件');

  const version = parsed['version'];
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return fail('unsupported-shape', '存檔缺少整數 version');
  }
  if (version > config.save.currentVersion) {
    return fail('unknown-version', `存檔版本 ${version} 高於本程式支援的 ${config.save.currentVersion}`);
  }
  if (version < config.save.minSupportedVersion) {
    return fail('unsupported-shape', `存檔版本 ${version} 低於最低支援的 ${config.save.minSupportedVersion}`);
  }

  if (version === 0) return migrateVersion0(config, parsed);
  if (version === config.save.currentVersion) return parseVersion1(config, parsed);

  return fail('unsupported-shape', `不支援的存檔版本 ${version}`);
}
