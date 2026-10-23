/**
 * src/core 公開 API 契約（唯一版本，M1 實作與 M2 UI 都以此為準）。
 *
 * 這支檔案只有型別，沒有任何執行期程式碼與遊戲數值：
 * - 數值全部來自 `data/balance.json`，公式來自 `docs/GDD.md`（v1.1，2026-10-22 定案）。
 * - UI（M2）與黑箱驗收（MiniMax31）可以直接 import，不必等引擎實作。
 *
 * 硬規則（與 repo AGENTS.md 一致）：
 * 1. core 不碰 DOM / window / localStorage，也不呼叫 Date.now()；時間一律由參數注入。
 * 2. 引擎是唯一改動遊戲狀態的地方；UI 只呼叫動作並重畫回傳的快照。
 *
 * 兩層介面：
 * - `NightMarketCore`：純函式層。吃 state 吐新 state，供 M1 實作與單元／驗收測試直接用。
 * - `GameEngine`：有狀態門面（facade）。持有目前 state、負責結算與存檔時機，
 *   是 UI **唯一**會碰到的介面；由 `createGameEngine` 產生。
 */

/** 攤位識別碼，對應 `data/balance.json` 的 `stalls[].id`。 */
export type StallId = string;

/**
 * 毫秒時間戳（Unix epoch ms），例如 `Date.now()` 的回傳值。
 *
 * ⚠️ 全 repo 的 `now` 參數都是毫秒，不是秒。契約裡的秒數欄位只有
 * `BalanceConfig.offline.capSeconds`（設定值），執行期一律用毫秒
 * （`elapsedMs` / `creditedMs`），兩者不要混用。
 */
export type TimestampMs = number;

/** 存檔格式版本；升級存檔結構時遞增。 */
export type SaveVersion = number;

/**
 * 里程碑定義，例如 25 / 50 / 100 級的收入倍率。
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
  /** Lv1 的每秒收入（解鎖即 Lv1，見 GDD §3）。 */
  readonly baseIncomePerSec: number;
  /** Lv1→Lv2 的升級成本基數（GDD §4.4 的成本公式起點）。 */
  readonly upgradeCostBase: number;
  /** 每升一級的成本成長倍率（GDD 的曲線參數）。 */
  readonly upgradeCostGrowth: number;
  /** 雇用店員的成本；雇用後該攤位自動營業。 */
  readonly hireCost: number;
  /** 等級上限；null 表示無上限。 */
  readonly maxLevel: number | null;
}

/**
 * `data/balance.json` 的完整結構（欄位已依 GDD v1.0 凍結，見 `docs/GDD.md` §13）。
 * 改欄位要同時改 `docs/GDD.md` §13 與 `src/core/API_CONTRACT.md`。
 */
export interface BalanceConfig {
  readonly version: number;
  /** 開新局時的起始餘額（全新遊戲、沒有存檔）。 */
  readonly startingBalance: number;
  /** 每升一級的收益成長倍率（全域；GDD §4.2）。 */
  readonly incomeGrowthPerLevel: number;
  /** 店員的效率加成倍率（每攤一位；GDD §4.2）。 */
  readonly clerkIncomeMultiplier: number;
  readonly stalls: readonly StallDefinition[];
  /** 由小到大排序；倍率累乘（GDD §4.1）。 */
  readonly milestones: readonly MilestoneDefinition[];
  readonly offline: {
    /** 離線收益上限（秒）。GDD v1.0 定案 14400（4 小時）。 */
    readonly capSeconds: number;
  };
  /** 前景長空檔防護（GDD v1.1 §4.6）。 */
  readonly foreground: {
    /**
     * 前景結算的最大合理間隔（秒）。`elapsedMs` 超過此值（分頁凍結、休眠、
     * 時鐘前跳）時，這次結算改用 `'offline'` 規則（只計店員、套 `offline.capSeconds`）。
     */
    readonly maxGapSeconds: number;
  };
  /** 存檔版本政策（GDD §8）。 */
  readonly save: {
    /** 本版程式寫出的存檔版本。 */
    readonly currentVersion: SaveVersion;
    /** 低於此版本的存檔視為 `unsupported-shape`。 */
    readonly minSupportedVersion: SaveVersion;
    /** 前景定期存檔間隔（秒）；UI 的存檔時機鐵則見 GDD §6.1。 */
    readonly foregroundIntervalSeconds: number;
  };
}

/** 單一攤位的存檔狀態（可變資料的最小單位）。 */
export interface StallState {
  readonly level: number;
  readonly unlocked: boolean;
  /**
   * 該攤位自己的店員（**每攤一位**，怪獸8號 2026-10-22 定案）。
   * 雇用後該攤位自動營業。
   */
  readonly clerkHired: boolean;
  /** 玩家是否手動開賣中；與 `clerkHired` 分開，收益語意由 GDD 定義。 */
  readonly selling: boolean;
}

/**
 * 唯一可信的遊戲狀態。
 * `lastSettledAt` 是「收益已結算到哪個時間點」的水位線（毫秒），用來避免重複計算。
 */
export interface GameState {
  readonly saveVersion: SaveVersion;
  readonly balance: number;
  readonly stalls: Readonly<Record<StallId, StallState>>;
  readonly lastSettledAt: TimestampMs;
}

/**
 * 每個動作目前還差多少錢（GDD §5.1，UX 清單 #3）。
 *
 * 語意（怪獸8號 2026-10-23 定案）：
 * - `number`：這個動作目前可行，只差這些錢；**錢夠就是 `0`**，不是 `null`。
 * - `null`：這個動作目前不可行，而且原因**不是錢不夠**（解鎖鏈未開、已達
 *   `maxLevel`、已經雇用店員）。UI 不該顯示「還差多少」，因為錢再多也不能做。
 *
 * 差額不取整（`balance` 是浮點），顯示照舊走 `formatMoney`。
 */
export interface ActionShortfall {
  readonly unlock: number | null;
  readonly upgrade: number | null;
  readonly hire: number | null;
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
  /** 是否手動開賣中（`sell-<id>` 按鈕的狀態）。 */
  readonly selling: boolean;
  /** 解鎖所需金額；已解鎖為 null。 */
  readonly unlockCost: number | null;
  /**
   * 升級所需金額；未解鎖或已達等級上限為 null（GDD §5.1）。
   */
  readonly upgradeCost: number | null;
  /** 雇用店員所需金額；已雇用或不可雇用為 null。 */
  readonly hireCost: number | null;
  /** 錢是否足夠做這件事（給按鈕 disabled 用，UI 不必自己比大小）。 */
  readonly canUnlock: boolean;
  readonly canUpgrade: boolean;
  readonly canHire: boolean;
  /** 現在是否允許切換開賣／收攤。 */
  readonly canToggleSell: boolean;
  /**
   * 每個動作還差多少錢（GDD §5.1）：錢夠 → `0`，動作不可行且原因不是錢 → `null`。
   * 只給顯示用；能不能按仍以 `can*` 為準。
   */
  readonly shortfall: ActionShortfall;
  /**
   * 如果現在雇用店員，這攤的每秒收益（含里程碑與店員倍率）；未解鎖或已雇用 → `null`。
   * 給雇用前預覽用（UX 清單 #7），UI 不自己算。
   */
  readonly incomePerSecIfHired: number | null;
  /** 下一個尚未達成的里程碑；全部達成或已達上限為 null。 */
  readonly nextMilestone: MilestoneView | null;
}

/** 整頁畫面資料。UI 只讀這個結構，不讀 GameState。 */
export interface GameSnapshot {
  readonly balance: number;
  /** 全部攤位加總的**前景**每秒收入（畫面上正在跳的數字，GDD §4.3）。 */
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

/** 動作結果（純函式層）：成功帶新狀態，失敗帶原因與原狀態。 */
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
 * - `foreground`：前景計時。計入「已雇店員**或**手動開賣中」的攤位（GDD §4.3）。
 *   若 `elapsedMs > BalanceConfig.foreground.maxGapSeconds × 1000`，實作必須改用
 *   `'offline'` 規則結算（只計店員、套 `offline.capSeconds`），見 GDD §4.6。
 * - `offline`：回到前景或冷啟動讀檔後結算（套 `BalanceConfig.offline.capSeconds`）。
 *   只計入「已雇店員」的攤位，手動開賣不計（GDD §4.3）。
 */
export type SettleMode = 'foreground' | 'offline';

/** 一次結算的結果。 */
export interface SettleResult {
  readonly state: GameState;
  /** 這次實際入帳的金額。取整規則與上限由 GDD 決定，契約不承諾整數。 */
  readonly gained: number;
  /** 距上次結算經過的毫秒（已把時鐘倒退視為 0）。 */
  readonly elapsedMs: number;
  /** 實際計入收益的毫秒（offline 模式會被上限截斷）。 */
  readonly creditedMs: number;
  /** 是否被離線上限截斷。 */
  readonly capped: boolean;
  /** 是否偵測到時鐘倒退（不給收益，也不會扣錢）。 */
  readonly timeWentBackwards: boolean;
}

/** 存檔信封；`serialize` 產出的 JSON 形狀（`save()` 回傳的字串內容）。 */
export interface SaveEnvelope {
  readonly version: SaveVersion;
  readonly savedAt: TimestampMs;
  /** 實際遊戲狀態；結構由 M1 定義，舊版由 migration 轉換。 */
  readonly state: GameState;
}

/** 讀檔失敗的原因。 */
export type LoadFailureReason = 'corrupt' | 'unknown-version' | 'unsupported-shape';

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
      readonly reason: LoadFailureReason;
      /** 給人看的說明，例如缺少哪個欄位。 */
      readonly detail: string;
    };

/**
 * 純函式層。M1 提供 `createCore(config: BalanceConfig): NightMarketCore`。
 *
 * 每個方法都不得修改傳入的 state，只回傳新狀態。
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
   * 切換開賣／收攤（`sell-<id>`）。語意見 GDD §5：手動營業開關，只影響前景收益，
   * 離線不計入；已雇用店員時回 `false`、狀態不變。失敗時 `state` 與傳入同參考。
   */
  toggleSell(state: GameState, stallId: StallId): ActionResult;

  /**
   * 結算收益到 `now`。
   * 必須是幂等的：同一個 `now` 呼叫兩次，第二次 `gained` 為 0。
   * 時鐘倒退（`now < lastSettledAt`）時 `gained` 為 0、`elapsedMs` 為 0，
   * 且**不得扣錢**（怪獸8號 2026-10-22 補充：前景也要處理）；
   * `lastSettledAt` 對齊到 `now`（GDD §4.6）。
   * `mode === 'foreground'` 且 `elapsedMs > foreground.maxGapSeconds × 1000` 時，
   * **必須**改用 `'offline'` 規則結算（只計店員、套離線上限），GDD v1.1 §4.6。
   * 收益不取整，`balance` 為浮點（GDD §1）。
   */
  settle(state: GameState, now: TimestampMs, mode: SettleMode): SettleResult;

  /** 產生可直接寫入本機的存檔字串（字串進、字串出，怪獸8號定案）。 */
  serialize(state: GameState, now: TimestampMs): string;

  /**
   * 讀檔；損毀或未知版本要回報原因，**不可丟例外**讓 UI 崩掉。
   * `raw` 為 `null` 代表沒有存檔。
   */
  load(raw: string | null): LoadResult;
}

/** 一次結算給 UI 看的離線收益（離線彈窗的唯一資料來源）。 */
export interface OfflineSettlement {
  /** 這次入帳金額；`> 0` 才跳彈窗。取整規則由 GDD 決定，契約不承諾整數。 */
  readonly gained: number;
  /** 實際計入的毫秒（已套上限；時鐘倒退時為 0）。 */
  readonly creditedMs: number;
  /** 是否被離線上限截斷。 */
  readonly capped: boolean;
  /** 是否偵測到時鐘倒退（此時不給收益）。 */
  readonly timeWentBackwards: boolean;
}

/** 引擎每次推進回給 UI 的一格：新快照 + 這次是否要跳離線彈窗。 */
export interface EngineFrame {
  readonly snapshot: GameSnapshot;
  /** 只有真的入帳（`gained > 0`）的離線結算才有值，其餘為 null。 */
  readonly offline: OfflineSettlement | null;
  /**
   * 只有 `init` 會填：讀檔失敗時的原因（引擎已改開新局）。
   * 其餘情況為 null。
   */
  readonly loadError: LoadFailureReason | null;
}

/**
 * 有狀態門面。UI 只依賴這一個介面：
 * - 所有 `now` 參數都是**毫秒**（`Date.now()`）。
 * - 動作（upgrade／hire／unlock／toggleSell）內部先結算到 `now` 再執行，
 *   UI 不需要也不可以先自己算 delta（怪獸8號審查第 3 點）。
 * - 動作失敗一律回 `false`、不丟例外。**動作本身不改任何狀態**；但動作前的
 *   結算照常入帳（GDD §5：同一個 `now` 時 delta 為 0，`lastSettledAt` 已因結算前進），
 *   所以「狀態完全不變」只保證動作部分，不保證 `balance` / `lastSettledAt` 沒動
 *   （怪獸8號 2026-10-22 定案；要斷言「失敗不動狀態」請用純函式層的 `ActionResult`）。
 */
export interface GameEngine {
  /**
   * 冷啟動：讀檔（無檔就開新局）並結算離線收益。
   * `frame.offline` 有值就跳離線彈窗（含冷啟動，怪獸8號審查第 2 點）。
   * `savedState` 是 `save()` 產出的字串或 `null`；格式、遷移、損毀判定全在 core。
   */
  init(now: TimestampMs, savedState: string | null): EngineFrame;

  /**
   * 前景週期推進（結算到 `now`）。
   * `now` 比上次結算小時（時鐘倒退）→ 不給收益、也不扣錢
   * （怪獸8號 2026-10-22 補充；MiniMax31 可當邊界測試）。
   * 距上次結算超過 `config.foreground.maxGapSeconds × 1000`（分頁凍結、休眠、
   * 時鐘前跳）→ 這次改用 `'offline'` 規則結算（只計店員、套離線上限），
   * `gained > 0` 時 `frame.offline` 有值，UI 據此跳彈窗（GDD v1.1 §4.6、§6）。
   * `onHidden` 之後、`onVisible` 之前的呼叫一律忽略（GDD §6，避免與離線結算重複計入）。
   */
  tick(now: TimestampMs): EngineFrame;

  /**
   * 進背景：先 `settle(now, 'foreground')` 把前景收益結清（長空檔依 GDD §4.6
   * 自動改用離線規則），再標記 hidden。回傳 `void`，這種入帳只入帳、不帶 frame
   * （不跳彈窗；彈窗只由 `init` / `tick` / `onVisible` 帶出）。見 GDD §6。
   */
  onHidden(now: TimestampMs): void;

  /** 回前景：結算離線收益（含 4h 上限與時鐘倒退規則）；入帳為 0 時 `offline` 為 null。 */
  onVisible(now: TimestampMs): EngineFrame;

  /** 升級單一攤位。成功回 `true`；失敗時回 `false`，動作本身不改任何狀態（動作前結算照常，GDD §5）。 */
  upgrade(stallId: StallId, now: TimestampMs): boolean;

  /** 雇用店員（每攤一位）。成功回 `true`；失敗時回 `false`，動作本身不改任何狀態（動作前結算照常，GDD §5）。 */
  hire(stallId: StallId, now: TimestampMs): boolean;

  /** 解鎖新攤位。成功回 `true`；失敗時回 `false`，動作本身不改任何狀態（動作前結算照常，GDD §5）。 */
  unlock(stallId: StallId, now: TimestampMs): boolean;

  /**
   * 開賣／收攤。語意依 GDD §5：手動營業開關，**只影響前景收益**，離線不計入；
   * 已雇用店員的攤位不再需要手動開賣 → 回 `false`、動作本身不改狀態
   * （`canToggleSell = false`）。動作前的結算照常。
   */
  toggleSell(stallId: StallId, now: TimestampMs): boolean;

  /**
   * 序列化存檔字串；UI 原樣寫進 localStorage，不解析內容。
   * **呼叫時機是 UI 的硬規則**（`onHidden` 後立刻、動作成功後立刻、前景每
   * `config.save.foregroundIntervalSeconds` 秒一次），見 GDD §6.1；
   * core 只提供字串，不排程、不碰 I/O，所以沒有失敗態（寫入失敗由 UI 自己處理）。
   */
  save(now: TimestampMs): string;

  /** 目前快照（唯讀，UI 重畫的唯一依據）。 */
  state(): GameSnapshot;
}

/** M1 會提供的門面工廠。`localStorage` 由 UI 自己讀寫，core 不碰。 */
export type CreateGameEngine = (config: BalanceConfig) => GameEngine;
