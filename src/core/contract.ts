/**
 * src/core 公開 API 契約（型別草稿，M1 開工前定案）。
 *
 * 這支檔案只有型別，沒有任何執行期程式碼：
 * - UI（M2）與黑箱驗收（MiniMax31）可以先用這些型別寫程式，不必等引擎實作。
 * - 所有數值（成本、收入、里程碑、離線上限）都來自 `data/balance.json`，
 *   這裡不寫死任何遊戲數字；欄位由 GDD 定案。
 *
 * 硬規則（與 repo AGENTS.md 一致）：
 * 1. core 不碰 DOM / window / localStorage，也不呼叫 Date.now()；時間一律由參數注入。
 * 2. 引擎是唯一會改動遊戲狀態的地方；UI 只能呼叫這裡的動作並重畫回傳的快照。
 */

/** 攤位識別碼，對應 `data/balance.json` 的 `stalls[].id`。 */
export type StallId = string;

/** 毫秒時間戳（Unix epoch ms）。由呼叫端注入，core 不自己取現在時間。 */
export type TimestampMs = number;

/** 存檔格式版本；升級存檔結構時遞增。 */
export type SaveVersion = number;

/**
 * 里程碑定義，例如 25 / 50 / 100 級的速度倍率。
 * 門檻與倍率都是遊戲數值，只能來自 `data/balance.json`。
 */
export interface MilestoneDefinition {
  readonly level: number;
  readonly multiplier: number;
}

/** 單一攤位的靜態設定（`data/balance.json` 的 `stalls[]` 元素）。 */
export interface StallDefinition {
  readonly id: StallId;
  readonly name: string;
  /** MVP 美術用 emoji，例如 🍗。 */
  readonly emoji: string;
  /** 解鎖這個攤位需要的金額；首攤通常為 0（開局即解鎖）。 */
  readonly unlockCost: number;
  /** 等級 1（或 0？由 GDD 定義起算）的每秒收入。 */
  readonly baseIncomePerSec: number;
  /** 升級成本的起點。 */
  readonly upgradeCostBase: number;
  /** 每升一級的成本成長倍率（GDD 的曲線參數）。 */
  readonly upgradeCostGrowth: number;
  /** 雇用店員的成本；雇用後該攤位自動營業。 */
  readonly hireCost: number;
  /** 等級上限；null 表示無上限。 */
  readonly maxLevel: number | null;
}

/** `data/balance.json` 的完整結構（草案：欄位由 GDD 定案後凍結）。 */
export interface BalanceConfig {
  readonly version: number;
  readonly stalls: readonly StallDefinition[];
  /** 由小到大排序。 */
  readonly milestones: readonly MilestoneDefinition[];
  readonly offline: {
    /** 離線收益上限（秒）。計畫 v0.1 為 4 小時。 */
    readonly capSeconds: number;
  };
}

/** 單一攤位的存檔狀態（可變資料的最小單位）。 */
export interface StallState {
  readonly level: number;
  readonly unlocked: boolean;
  readonly clerkHired: boolean;
}

/**
 * 唯一可信的遊戲狀態。
 * `lastSettledAt` 是「收益已結算到哪個時間點」的水位線，用來避免重複計算。
 */
export interface GameState {
  readonly saveVersion: SaveVersion;
  readonly balance: number;
  readonly stalls: Readonly<Record<StallId, StallState>>;
  readonly lastSettledAt: TimestampMs;
}

/** 里程碑在畫面上的呈現（進度條用）。 */
export interface MilestoneView {
  readonly level: number;
  readonly multiplier: number;
  /** 目前等級往這個門檻的進度，0..1；已達成為 1。 */
  readonly progress: number;
}

/** 單一攤位的唯讀畫面資料（不可變，供 UI 直接渲染）。 */
export interface StallSnapshot {
  readonly id: StallId;
  readonly name: string;
  readonly emoji: string;
  readonly unlocked: boolean;
  readonly level: number;
  /** 該攤位目前每秒收入（已含里程碑倍率；未解鎖或無店員時由 GDD 定義）。 */
  readonly incomePerSec: number;
  readonly clerkHired: boolean;
  /** 解鎖所需金額；已解鎖為 null。 */
  readonly unlockCost: number | null;
  /** 升級所需金額；已達等級上限為 null。 */
  readonly upgradeCost: number | null;
  /** 雇用店員所需金額；已雇用或不可雇用為 null。 */
  readonly hireCost: number | null;
  /** 錢是否足夠做這件事（給按鈕 disabled 用，UI 不必自己比大小）。 */
  readonly canUnlock: boolean;
  readonly canUpgrade: boolean;
  readonly canHire: boolean;
  /** 下一個尚未達成的里程碑；全部達成或已達上限為 null。 */
  readonly nextMilestone: MilestoneView | null;
}

/** 整頁畫面資料。UI 只讀這個結構，不讀 GameState。 */
export interface GameSnapshot {
  readonly balance: number;
  /** 全部攤位加總的每秒收入。 */
  readonly incomePerSec: number;
  /** 是否至少有一個攤位雇用店員（顯示「店員顧攤中 / 自己顧攤」）。 */
  readonly anyClerkHired: boolean;
  /** 依 `BalanceConfig.stalls` 的順序排列。 */
  readonly stalls: readonly StallSnapshot[];
  readonly lastSettledAt: TimestampMs;
}

/** 動作失敗的原因。失敗時 `state` 必須是傳入的同一個物件（狀態完全不變）。 */
export type ActionFailure =
  | 'no-such-stall'
  | 'stall-locked'
  | 'already-unlocked'
  | 'max-level'
  | 'clerk-already-hired'
  | 'insufficient-funds';

/** 動作結果：成功帶新狀態，失敗帶原因與原狀態。 */
export type ActionResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      /** 這次實際扣掉的金額。 */
      readonly spent: number;
    }
  | {
      readonly ok: false;
      readonly reason: ActionFailure;
      /** 與傳入的 state 同一個參考，保證狀態未變。 */
      readonly state: GameState;
    };

/**
 * 結算模式：
 * - `foreground`：前景計時（不套離線上限）。
 * - `offline`：回到前景或冷啟動讀檔後結算（套 `BalanceConfig.offline.capSeconds`）。
 */
export type SettleMode = 'foreground' | 'offline';

/** 一次結算的結果。 */
export interface SettleResult {
  readonly state: GameState;
  /** 這次實際入帳的金額。 */
  readonly gained: number;
  /** 距上次結算經過的毫秒（已把時鐘倒退視為 0）。 */
  readonly elapsedMs: number;
  /** 實際計入收益的毫秒（offline 模式會被上限截斷）。 */
  readonly creditedMs: number;
  /** 是否被離線上限截斷。 */
  readonly capped: boolean;
  /** 是否偵測到時鐘倒退（不給收益）。 */
  readonly timeWentBackwards: boolean;
}

/** 存檔信封；`serialize` 產出的內容，`load` 的輸入。 */
export interface SaveEnvelope {
  readonly version: SaveVersion;
  readonly savedAt: TimestampMs;
  /** 實際遊戲狀態；結構由 M1 定義，舊版由 migration 轉換。 */
  readonly state: GameState;
}

/** 讀檔結果。 */
export type LoadResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      /** 從哪個舊版本遷移過來；沒遷移為 null。 */
      readonly migratedFrom: SaveVersion | null;
    }
  | {
      readonly ok: false;
      readonly reason: 'corrupt' | 'unknown-version' | 'unsupported-shape';
      /** 給人看的說明，例如缺少哪個欄位。 */
      readonly detail: string;
    };

/**
 * 引擎介面。M1 會提供 `createCore(config: BalanceConfig): NightMarketCore`。
 *
 * 純函式語意：每個方法都不得修改傳入的 state，只回傳新狀態。
 */
export interface NightMarketCore {
  readonly config: BalanceConfig;

  /** 全新遊戲（例如首刷、存檔不存在）。 */
  createInitialState(now: TimestampMs): GameState;

  /** 把 GameState 轉成 UI 可渲染的快照。 */
  snapshot(state: GameState): GameSnapshot;

  /** 升級單一攤位。 */
  upgrade(state: GameState, stallId: StallId): ActionResult;

  /** 雇用店員；雇用後該攤位自動營業。 */
  hire(state: GameState, stallId: StallId): ActionResult;

  /** 解鎖新攤位。 */
  unlock(state: GameState, stallId: StallId): ActionResult;

  /**
   * 結算收益到 `now`。
   * 必須是幂等的：同一個 `now` 呼叫兩次，第二次 `gained` 為 0。
   * 時鐘倒退時 `gained` 為 0、`timeWentBackwards` 為 true。
   */
  settle(state: GameState, now: TimestampMs, mode: SettleMode): SettleResult;

  /** 產生可寫入本機的存檔。 */
  serialize(state: GameState, now: TimestampMs): SaveEnvelope;

  /** 讀檔；損毀或未知版本要回報原因，不可丟例外讓 UI 崩掉。 */
  load(raw: unknown): LoadResult;
}
