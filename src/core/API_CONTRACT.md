# src/core 公開 API 契約（v1.0 — 型別定案）

狀態：**型別定案**（2026-10-22，怪獸8號核可 `src/core/api.ts` 即為定案版）。
數值與公式已由 `docs/GDD.md` v1.0（2026-10-22 定案，原 MiMo26 改派 DeepSeek41）與
`data/balance.json` 寫死；本文件與 GDD 衝突時以 GDD 為準。

程式碼位置：`src/core/api.ts`（只有型別，沒有實作、沒有寫死任何遊戲數值），統一由 `src/core/index.ts` 匯出。
UI 與測試**只** import `src/core`，不得自己再定義一份介面。

## 1. 檔案與職責邊界

| 檔案 | 擁有者 | 內容 |
|---|---|---|
| `src/core/api.ts` | DeepSeek41 | 本文件描述的全部型別 |
| `src/core/index.ts` | DeepSeek41 | 公開進入點；UI 與驗收測試只 import 這裡 |
| `src/core/money.ts` | DeepSeek41 | `formatMoney`（9999 / 1萬 / 1億 / 1兆） |
| `data/balance.json` | DeepSeek41（原 MiMo26，2026-10-22 改派） | 全部遊戲數值：攤位、成本曲線、里程碑、離線上限 |
| `docs/GDD.md` | DeepSeek41（原 MiMo26，2026-10-22 改派） | 公式與規則，驗收測試的 oracle（v1.0 定案） |

core 不 import `src/ui`、不碰 DOM / `window` / `localStorage`，不呼叫 `Date.now()`。

**時間單位**：型別 `TimestampMs` 就是毫秒（`Date.now()`）。契約裡只有
`BalanceConfig.offline.capSeconds` 是秒（設定值），執行期欄位一律毫秒
（`elapsedMs`、`creditedMs`、`lastSettledAt`）。

## 2. 兩層介面

```ts
// 純函式層（M1 實作、單元／驗收測試直接用）
createCore(config: BalanceConfig): NightMarketCore

// 有狀態門面（UI 唯一會碰的介面，M1 實作）
createGameEngine(config: BalanceConfig): GameEngine
```

- **`NightMarketCore`（純函式）**：每個方法吃 `state` 吐新 `state`，不改傳入物件，也不碰時間以外的環境。
  動作方法**不帶 `now`**，要結算請呼叫端自己先 `settle`。
- **`GameEngine`（門面）**：持有目前 state、決定何時結算與存檔，動作內部先 `settle(now, 'foreground')` 再執行。
  UI 只呼叫門面，因此「UI 不得自己累加 delta」是結構上保證的（怪獸8號審查第 3 點）。
- **存檔是字串進、字串出**：`init(now, savedState: string | null)` / `save(now): string`。
  localStorage 讀寫留在 UI，格式／版本／遷移／損毀判定全部在 core，core 不碰瀏覽器 API。

### 2.1 純函式層

| 方法 | 用途 | 對應 UI |
|---|---|---|
| `createInitialState(now)` | 開新遊戲 | 沒有存檔時 |
| `snapshot(state)` | 產生唯讀畫面資料 | 每次重畫 |
| `upgrade(state, stallId)` | 升級攤位 | `upgrade-<id>` |
| `hire(state, stallId)` | 雇用店員（雇用後自動營業） | `hire-<id>` |
| `unlock(state, stallId)` | 解鎖新攤位 | `unlock-<id>` |
| `toggleSell(state, stallId)` | 開賣／收攤 | `sell-<id>` |
| `settle(state, now, mode)` | 把收益結算到 `now` | 前景計時 / 回前景 / 冷啟動 |
| `serialize(state, now)` | 產生存檔字串 | 每次狀態變更後 |
| `load(raw)` | 讀檔（字串）+ 舊版遷移 | 啟動時 |

### 2.2 門面層 `GameEngine`

| 方法 | 回傳 | 說明 |
|---|---|---|
| `init(now, savedState)` | `EngineFrame` | 讀檔（`null` 或損毀就開新局）+ 冷啟動離線結算；`offline` 有值才跳彈窗 |
| `tick(now)` | `EngineFrame` | 前景推進，`offline` 恆為 `null`；時鐘倒退不給收益也不扣錢 |
| `onHidden(now)` | `void` | 進背景，只記錄時間點 |
| `onVisible(now)` | `EngineFrame` | 回前景離線結算；`gained > 0` 才有 `offline` |
| `upgrade/hire/unlock/toggleSell(id, now)` | `boolean` | 先結算到 `now` 再執行；失敗回 `false`、狀態不變、不丟例外 |
| `save(now)` | `string` | 存檔字串，UI 原樣寫 localStorage（純序列化，沒有失敗態） |
| `state()` | `GameSnapshot` | 目前快照 |

```ts
EngineFrame = { snapshot: GameSnapshot; offline: OfflineSettlement | null; loadError: LoadFailureReason | null }
OfflineSettlement = { gained; creditedMs; capped; timeWentBackwards }
```

## 3. 狀態與快照

- `GameState` 是可變資料的唯一來源：`balance`、`stalls`（含 `level` / `unlocked` / `clerkHired` / `selling`）、
  `lastSettledAt`（收益水位線）。
- `clerkHired` 是**每個攤位各自一位**（怪獸8號 2026-10-22 定案），不是全域開關。
- `GameSnapshot` / `StallSnapshot` 是給 UI 的唯讀投影。UI **不得**自己算收入、成本或「錢夠不夠」，
  一律讀 `incomePerSec`、`upgradeCost`、`canUpgrade`、`canHire`、`canToggleSell`
  （怪獸8號審查第 4 點：錢不夠要 disabled 但仍顯示金額）。
- `StallSnapshot.incomePerSec` 已含里程碑倍率；`GameSnapshot.incomePerSec` 是**前景**速率
  （畫面上正在跳的數字，GDD §4.3／§5.1）。
- `nextMilestone.progress` 為 0..1，已達成給 1。

## 4. 動作結果

兩層語意一致（不丟例外；**動作本身**不改任何狀態），但回傳形狀不同：

- **門面層 `GameEngine`：`boolean`。** 成功 `true`；錢不夠／不允許 `false`，動作本身不改狀態。
  ⚠️ 門面動作會**先結算到 `now`**（GDD §5），所以失敗後 `state()` 的 `balance` / `lastSettledAt`
  可能已因結算前進——這是 GDD 規定的正常行為，不是「狀態完全不變」的反例。
  UI 收到 `false` 後照舊呼叫 `state()` 重畫（英雄所見即所測）。
- **純函式層 `NightMarketCore`：`ActionResult`。** 帶失敗原因，供單元測試與工具除錯：

```ts
ActionResult = { ok: true; state; spent } | { ok: false; reason; state }   // 失敗時 state 是同一個參考
```

- 失敗回傳**同一個 `state` 物件參考**，「錢不夠要拒絕且狀態完全不變」可以直接斷言。
- `ActionFailure`：`no-such-stall` / `stall-locked` / `already-unlocked` / `max-level` /
  `clerk-already-hired` / `insufficient-funds`。

## 5. 結算（不能重複算收益）

```ts
settle(state, now, mode: 'foreground' | 'offline'): SettleResult
```

- `lastSettledAt` 是唯一水位線：入帳只依 `now - lastSettledAt` 計算，呼叫端不得自己累加 delta。
- 只有 `mode: 'offline'` 套 `BalanceConfig.offline.capSeconds` 上限；`foreground` 不套，
  但**前景長空檔例外**：`elapsedMs > foreground.maxGapSeconds × 1000` 時改用離線規則（GDD v1.1 §4.6）。
- 幂等：同一個 `now` 連呼兩次，第二次 `gained` 為 0。
- **時鐘倒退**（`now < lastSettledAt`）：`gained = 0`、`elapsedMs = 0`、`timeWentBackwards = true`，
  **不得扣錢**。前景 `tick` 與離線 `onVisible` 都適用（怪獸8號 2026-10-22 補充）。
- `capped = true` 表示這次被離線上限截斷。
- 時鐘倒退後 `lastSettledAt` **對齊到 `now`**（GDD §4.6 定案）。

## 6. 存檔

- `serialize(state, now)` → **字串**（內容是 `SaveEnvelope { version, savedAt, state }` 的 JSON）。
- `load(raw: string | null)` 回 `LoadResult`，**不丟例外**：`corrupt`（JSON 壞、欄位缺、型別錯）、
  `unknown-version`（版本比程式新）、`unsupported-shape`；舊版以 `migratedFrom` 標示。
- 門面對應：`save(now)` 回字串、`init(now, savedState)` 收字串；`init` 讀檔失敗時改開新局，
  並在 `EngineFrame.loadError` 回報原因（不擋遊戲、不彈錯誤對話框）。

## 7. 驗收可以依賴的行為（給 MiniMax31）

| 案例 | 可觀察的契約 |
|---|---|
| 錢不夠購買 | 門面回 `false`，`state()` 快照完全不變；純函式層 `ok: false`、`reason: 'insufficient-funds'`、`state` 同參考 |
| 錢剛好等於價格 | 門面回 `true`、`balance` 變 0；純函式層 `spent` 等於價格 |
| 離線 0 秒 | `gained: 0`、`elapsedMs: 0`、`offline` 為 null（不跳彈窗） |
| 剛好到上限 | `capped: false`、`creditedMs == capSeconds * 1000` |
| 超過上限 | `capped: true`、`creditedMs == capSeconds * 1000` |
| 時鐘倒退（前景 `tick`） | `gained: 0`、`timeWentBackwards: true`、`balance` 不得變小、`lastSettledAt` 對齊 `now` |
| 時鐘倒退（回前景） | 同上，且不跳離線彈窗 |
| 背景回來不重複 | 同一段時間連續兩次 `settle`，總入帳只等於一次；`onHidden` 後的 `tick` 一律忽略 |
| 手動開賣 vs 離線 | 只有 `selling`、沒有店員的攤位：前景有收益、離線結算為 0（GDD §4.3） |
| 里程碑 25/50/100 | `snapshot().stalls[i].incomePerSec` 在門檻前後符合 GDD 倍率（累乘，Lv100 = ×8） |
| 存檔損毀 | `load()` 回 `ok: false` 且 `reason` 為三者之一，不丟例外；`init` 開新局且 `loadError` 有值 |
| 沒有存檔（`init(now, null)`） | 開新局、`loadError` 為 `null`（正常首啟，不算錯誤） |
| 版本 0 存檔 | `load()` 回 `ok: true`、`migratedFrom: 0`（GDD §8.3） |
| 數字格式 | 一律用 `formatMoney`，不自己拼單位（GDD §7） |
| 金額比較 | 浮點容差 `|actual-expected| <= max(1e-6, |expected|*1e-9)`；成本與 `creditedMs` 用 `===` |

## 8. 對 GLM53幫手 契約提案（v1 → v2 → 定案版）的裁決

GLM53幫手 v2 已完整收下怪獸8號的 3 項拍板與 4 項必改（`now` 標毫秒、`amount` 不承諾整數、
`tick` 時鐘倒退、`toggleSell` 語意待 GDD），定案版全部保留，以下只列**結構性**差異。

沿用：時間全部注入、唯讀快照、動作本身不改狀態（動作前結算照常，GDD §5）、離線結算由 core 決定、`sell-<id>` 走 core、
存檔字串進字串出。

改掉的部分：

1. **介面搬到 core**：`GameEngine` 定案在 `src/core/api.ts`。`src/ui/engine.ts` 只留
   `class FakeEngine implements GameEngine`，不要 `import type { Snapshot } from '../core'`
   再包一層 `UiEngineState`。
2. **`UiEngineState` / `StallOps` 取消**：攤位卡需要的欄位全部併進 `GameSnapshot`。一個畫面只讀一份結構，
   不必同時維護 `snapshot` 與 `ops` 兩份排序一致的問題。另 v2 的 `UiEngineState.snapshot` 型別是
   `Snapshot`（M0 佔位，已於 M1 刪除），定案版改成 `GameSnapshot`，佔位型別不用進契約。
3. **`amount` 不承諾整數**：改名 `gained: number`，取整規則與上限交 GDD；放置類金額會超過
   `Number.MAX_SAFE_INTEGER` 的量級，契約先不綁死。
4. **`elapsedSec` 改 `creditedMs`**：全 repo 執行期時間單位統一毫秒（`TimestampMs`），避免秒／毫秒混用。
5. **`init` 收存檔字串**：`init(now, savedState: string | null)`，回 `EngineFrame`；
   冷啟動離線收益與 `onVisible` 同一種形狀，彈窗邏輯只寫一次。
6. **`tick` / `onVisible` 回 `EngineFrame`**：附帶最新快照，UI 不必再 `state()` 取一次。
7. **動作回 `boolean`**（怪獸8號定案）：失敗原因 `ActionFailure` 留在純函式層給測試用，門面只回真假。
8. **`save` 回字串**：UI 原樣寫 localStorage，寫入失敗由 UI 處理；core 不碰 I/O。
9. **`Snapshot` / `StallView` / `PLACEHOLDER_SNAPSHOT`（M0 佔位）已刪除（M1 `26c7777`）**：
   `src/ui/app.ts` 早已改用 `GameSnapshot`，M2 落地後全樹再無引用，DeepSeek41 在 M1 移除這三個型別。本契約不再提供這三個型別，新程式碼請用 `GameSnapshot` / `StallSnapshot`。

## 9. 待 GDD 決定的事項 → 已由 GDD v1.0 定案（2026-10-22）

`docs/GDD.md` v1.0 已把下列 8 項全部寫死，本契約的描述與之一致：

| 原本的待定項 | GDD 定案 | 契約／型別影響 |
|---|---|---|
| 開賣語意 | 手動營業開關，只算前景；離線只算有店員的攤位 | 無（`selling` / `toggleSell` 已預留） |
| 等級起算 | 解鎖即 Lv1，未解鎖 Lv0 | 無 |
| 無店員時收入 | 未開賣 0；手動開賣走同一條公式但不套 `clerkIncomeMultiplier` | 無 |
| 里程碑倍率 | 累乘，25/50/100 各 ×2（Lv100 = ×8） | 無 |
| `maxLevel` | 每攤 150；可達成本 ≤ 約 6e13，無精度風險 | `StallDefinition.maxLevel` 保留可為 null（未來無上限用） |
| 時鐘倒退後 `lastSettledAt` | 對齊到 `now` | 已寫進 `settle` 註解 |
| `BalanceConfig` 額外參數 | 新增 `startingBalance`、`incomeGrowthPerLevel`、`clerkIncomeMultiplier`、`save.{currentVersion,minSupportedVersion}` | 已補進 `api.ts` |
| 金額取整 | 結算不取整（浮點）；只在顯示層 floor 後縮寫 | `gained` 維持「不承諾整數」 |

GDD 另外定義了（本契約未涵蓋、實作照 GDD）：快照各 `can*` 欄位的判定、里程碑進度公式、
存檔 v1 驗證表、v0 → v1 遷移、數字格式精確規則、平衡目標與模擬結果。
