# src/core 公開 API 契約（型別草稿 v0.1）

狀態：**草稿**，M1 開工前由 DeepSeek41 提案，GDD 定案後凍結。
程式碼位置：`src/core/contract.ts`（只有型別，沒有實作）；統一由 `src/core/index.ts` 匯出。

## 1. 檔案與職責邊界

| 檔案 | 擁有者 | 內容 |
|---|---|---|
| `src/core/contract.ts` | DeepSeek41 | 型別與介面，本文件描述的全部 API |
| `src/core/index.ts` | DeepSeek41 | 公開進入點；UI 與驗收測試**只** import 這裡 |
| `src/core/money.ts` | DeepSeek41 | `formatMoney`（9999 / 1萬 / 1億 / 1兆） |
| `data/balance.json` | MiMo26 | 全部遊戲數值：攤位、成本曲線、里程碑、離線上限 |
| `docs/GDD.md` | MiMo26 | 公式與規則，驗收測試的 oracle |

core 不 import `src/ui`、不碰 DOM / `window` / `localStorage`，不呼叫 `Date.now()`。

## 2. 公開介面

```ts
createCore(config: BalanceConfig): NightMarketCore
```

`NightMarketCore` 的方法全部是**純函式**：不改傳入的 `state`，只回傳新狀態。

| 方法 | 用途 | 對應 UI |
|---|---|---|
| `createInitialState(now)` | 開新遊戲 | 沒有存檔時 |
| `snapshot(state)` | 產生唯讀畫面資料 | 每次重畫 |
| `upgrade(state, stallId)` | 升級攤位 | `upgrade-<id>` 按鈕 |
| `hire(state, stallId)` | 雇用店員（雇用後自動營業） | `hire-<id>` 按鈕 |
| `unlock(state, stallId)` | 解鎖新攤位 | `unlock-<id>` 按鈕 |
| `settle(state, now, mode)` | 把收益結算到 `now` | 前景計時 / 回到前景 / 冷啟動 |
| `serialize(state, now)` | 產生本機存檔 | 每次狀態變更後 |
| `load(raw)` | 讀檔 + 舊版遷移 | 啟動時 |

### 2.1 狀態與快照

- `GameState` 是可變資料的唯一來源，含 `balance`、`stalls`、`lastSettledAt`（收益水位線）。
- `GameSnapshot` / `StallSnapshot` 是給 UI 的唯讀投影：UI **不得**自己算收入、成本或「錢夠不夠」，
  一律讀 `incomePerSec`、`upgradeCost`、`canUpgrade` 等欄位（怪獸8號審查第 4 點：錢不夠要 disabled 但仍顯示金額）。
- `StallSnapshot.incomePerSec` 已含里程碑倍率；`GameSnapshot.incomePerSec` 是全部攤位加總。
- `nextMilestone.progress` 為 0..1，已達成給 1。

### 2.2 動作結果

```ts
ActionResult =
  | { ok: true;  state: GameState; spent: number }
  | { ok: false; reason: ActionFailure; state: GameState }   // state 是同一個參考
```

- 失敗時回傳**同一個 `state` 物件參考**，讓「錢不夠要拒絕且狀態完全不變」可以被直接斷言。
- `ActionFailure`：`no-such-stall` / `stall-locked` / `already-unlocked` / `max-level` / `clerk-already-hired` / `insufficient-funds`。
- 動作**不會**順便結算收益；呼叫端要自己先 `settle`（見 2.3）。

### 2.3 結算（不能重複算收益）

```ts
settle(state, now: TimestampMs, mode: 'foreground' | 'offline'): SettleResult
```

- `lastSettledAt` 是唯一水位線：入帳金額只依 `now - lastSettledAt` 計算，呼叫端不得自己累加 delta
  （怪獸8號審查第 3 點）。切前景／背景時 UI 只把時間點交給 core。
- `mode: 'offline'` 才套 `BalanceConfig.offline.capSeconds` 上限；`foreground` 不套。
- 幂等：同一個 `now` 連呼兩次，第二次 `gained` 為 0。
- 時鐘倒退（`now < lastSettledAt`）：`gained = 0`、`timeWentBackwards = true`、`elapsedMs = 0`。
- `capped = true` 表示這次被離線上限截斷。
- **待 GDD 確認**：時鐘倒退後 `lastSettledAt` 要不要重新對齊到 `now`
  （建議對齊，避免時間追回來時同一段時間被再次入帳）。

### 2.4 存檔

- `serialize(state, now)` → `SaveEnvelope { version, savedAt, state }`。
- `load(raw: unknown)` 回傳 `LoadResult`，**不丟例外**：
  `corrupt`（JSON 壞、欄位缺、型別錯）、`unknown-version`（版本比程式新）、`unsupported-shape`。
  舊版由 `migratedFrom` 標示遷移來源。
- 讀檔成功後，呼叫端要再 `settle(state, now, 'offline')` 才能拿到離線收益。

## 3. 驗收可以依賴的行為（給 MiniMax31）

| 案例 | 可觀察的契約 |
|---|---|
| 錢不夠購買 | `ok: false`、`reason: 'insufficient-funds'`、回傳 `state` 與傳入同參考 |
| 錢剛好等於價格 | `ok: true`、`spent` 等於價格、`balance` 變 0 |
| 離線 0 秒 | `gained: 0`、`elapsedMs: 0` |
| 剛好到上限 | `capped: false`、`creditedMs == capSeconds * 1000` |
| 超過上限 | `capped: true`、`creditedMs == capSeconds * 1000` |
| 時鐘倒退 | `gained: 0`、`timeWentBackwards: true` |
| 背景回來不重複 | 連續兩次 `settle` 用同一段時間，總入帳只等於一次 |
| 里程碑 25/50/100 | `snapshot().stalls[i].incomePerSec` 在門檻前後符合 GDD 倍率 |
| 存檔損毀 | `load()` 回 `ok: false` 且 `reason` 為三者之一，不丟例外 |
| 數字格式 | 一律用 `formatMoney`，不自己拼單位 |

## 4. 尚未定案、需要 GDD 決定

1. **「開賣」按鈕的語意**：目前契約沒有對應動作。是指「有店員才開始自動營業」的狀態顯示，還是需要一個
   手動開賣的動作？決定後才加進 `NightMarketCore`（`sell-<id>` 的 testid 已由 M2 保留）。
2. **等級起算**：`level: 0` 代表未解鎖，還是解鎖後就是 `level: 1`？（影響 `baseIncomePerSec` 的基準）
3. **無店員時的收入**：0，還是玩家手動顧攤有基本收入？
4. **里程碑倍率**：25 / 50 / 100 是累乘（2^3）還是取最高一檔（×2）？
5. **`maxLevel`**：MVP 有沒有等級上限？沒有限制時 `upgradeCost` 會溢出到 `Infinity` 的邊界要怎麼處理。
6. **時鐘倒退後 `lastSettledAt`**：見 2.3。

以上由 MiMo26 的 `docs/GDD.md` 定案，我照 GDD 實作；有異動我會在同一支 PR 更新本文件。
