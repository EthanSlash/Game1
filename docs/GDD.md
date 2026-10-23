# 《夜市攤王》遊戲設計文件（GDD）v1.0

| 項目 | 內容 |
|---|---|
| 版本 | 1.1（2026-10-22 定案；v1.1 依 怪獸8號 01:50 審查補前景長空檔與存檔時機） |
| 對應存檔版本 | `saveVersion = 1` |
| 唯一數值來源 | `data/balance.json`（本文件只寫公式與規則，不重複列值） |
| 對應程式契約 | `src/core/api.ts`（`NightMarketCore` / `GameEngine`） |
| 擁有者 | DeepSeek41（原指派 MiMo26，2026-10-22 由怪獸8號改派） |
| 驗收依據 | MiniMax31 依本文件 + `data/balance.json` 寫 oracle，不讀實作 |

> 本文件是**唯一規格來源**。程式與本文件衝突時以本文件為準，並在 PR 修正程式或提案修 GDD。
> 任何沒寫在這裡的行為都視為未定案，實作前先在討論串問。

---

## 1. 名詞與單位

| 名詞 | 定義 |
|---|---|
| `now` | Unix epoch **毫秒**（`Date.now()` 的回傳值）。全 repo 的 `now` 參數一律毫秒。 |
| `elapsedMs` | `now - lastSettledAt`，毫秒。 |
| `creditedMs` | 實際計入收益的毫秒（離線時被上限截斷）。 |
| `capSeconds` | 離線收益上限秒數，`data/balance.json` 的 `offline.capSeconds`（現值 14400 = 4 小時）。 |
| `maxGapMs` | 前景長空檔門檻毫秒，`foreground.maxGapSeconds × 1000`（現值 60 秒）。超過此值的前景結算改用離線規則（§4.6）。 |
| 金額單位 | 新台幣「元」，型別 `number`。 |
| 水位線 | `GameState.lastSettledAt`，代表「收益已結算到哪個時間點」。**唯一**防止重複計算的依據。 |
| 攤位順序 | `data/balance.json` 的 `stalls[]` 陣列順序，UI 與解鎖鏈都照此順序。 |

**時間單位鐵則**：`capSeconds`、`foreground.maxGapSeconds`、`save.foregroundIntervalSeconds` 是秒（設定值），其餘執行期欄位（`now`、`elapsedMs`、`creditedMs`、`lastSettledAt`）都是毫秒。
PR 內出現 `* 1000` 或 `/ 1000` 只允許出現在「秒↔毫秒」轉換的單一位置（`capMs`、`maxGapMs`、存檔間隔換算各一處）。

**金額精度**：`balance` 與 `gained` 都是浮點數，**不做取整**。取整只發生在顯示層（見 §7）。
理由：若每 tick（約 250ms）都 floor，1/s 的攤位每 tick 只賺 0.25 元，會被 floor 成 0，收入直接消失。

---

## 2. 核心循環

```
開新局 / 讀檔
   └─ 第一攤「雞排車」已解鎖（Lv1、未雇店員、未開賣），balance = startingBalance
玩家點「開賣」(sell-<id>)
   └─ 該攤開始在前景累積收益（= tick 結算）
玩家升級 / 解鎖 / 雇用店員
   └─ 升級提高每級收入；解鎖新攤位；雇用店員 → 該攤自動營業（前景＋離線都算）
進背景（visibilitychange hidden）/ 關掉 App
   └─ 離線期間只有「已雇店員」的攤位累積，最多計入 capSeconds
回前景 / 重新開啟
   └─ 結算離線收益（> 0 才跳彈窗）
```

MVP 的五個攤位（順序固定，必須依序解鎖）：
雞排車 → 珍珠奶茶 → 蚵仔煎 → 臭豆腐 → 大腸包小腸。

---

## 3. 狀態

```ts
GameState = {
  saveVersion: 1,
  balance: number,
  lastSettledAt: number,            // 毫秒
  stalls: Record<StallId, {
    level: number,                  // 未解鎖 = 0；解鎖後從 1 起算
    unlocked: boolean,
    clerkHired: boolean,            // 該攤自己的店員（每攤一位）
    selling: boolean,               // 玩家手動開賣中
  }>
}
```

不變式（實作與測試都可以依賴）：

1. `unlocked === false` ⇒ `level === 0` 且 `clerkHired === false` 且 `selling === false`。
2. `unlocked === true` ⇒ `1 <= level <= maxLevel`（`maxLevel` 取 `balance.json` 的 `stalls[].maxLevel`）。
3. 第一攤（`stalls[0]`）在**全新遊戲**時 `unlocked = true, level = 1, selling = false, clerkHired = false`。
4. **解鎖新攤位時**：`unlocked = true`、`level = 1`、`selling = false`、`clerkHired = false`。
   （新攤位要玩家自己按開賣，除非直接雇用店員。）
5. 開局 `selling = false`：玩家必須先按一次 `sell-<id>` 才有收益（新手引導的第一個動作）。

---

## 4. 公式（全部以 `data/balance.json` 的參數表示）

### 4.1 里程碑倍率（累乘）

```ts
milestoneMultiplier(level) =
  milestones.filter(m => level >= m.level)
            .reduce((acc, m) => acc * m.multiplier, 1)
```

- `milestones` 由小到大，現值 `[{level:25,multiplier:2},{level:50,multiplier:2},{level:100,multiplier:2}]`。
- **累乘，不是取最高一檔**：Lv25 → ×2、Lv50 → ×4、Lv100 → ×8。
- 「達到即生效」：`level === 25` 當下就吃 ×2。
- Lv100 之後沒有新里程碑，維持 ×8。

### 4.2 單一攤位的每秒收益

```ts
clerkFactor = clerkHired ? clerkIncomeMultiplier : 1          // 現值 1.25
stallIncomePerSec(level, clerkHired) =
  baseIncomePerSec × incomeGrowthPerLevel^(level-1) × milestoneMultiplier(level) × clerkFactor
```

- **不取整**（浮點原值）。
- `level` 從 1 起算（Lv1 就是 `baseIncomePerSec × clerkFactor`）。
- `incomeGrowthPerLevel` 是全域參數（現值 1.1）。
- 店員**不會**改變營業方式以外的收入規則；`clerkIncomeMultiplier` 是店員的效率加成，已在公式內。

### 4.3 攤位是否計入收益（前景 vs 離線）

| 情境 | 計入條件 |
|---|---|
| 前景（`tick` / 門面動作前的結算 / `onHidden`） | `unlocked && (clerkHired || selling)` |
| 離線（`onVisible` / 冷啟動 `init`） | `unlocked && clerkHired` |

- **長空檔例外（v1.1）**：前景入口若 `elapsedMs > maxGapMs`，這次改用離線條件（只計店員）並套離線上限，見 §4.6。

- **沒有店員、又沒手動開賣 → 該攤收益為 0。**
- **離線只算有店員的攤位**：手動開賣是「人在顧攤」，背景期間不算。
- 玩家手動開賣的攤位在離線時段完全不計入；回到前景後 `selling` 狀態保留（不自動關閉）。

```ts
foregroundRate = Σ 符合前景條件的 stallIncomePerSec
offlineRate    = Σ 符合離線條件的 stallIncomePerSec
```

- `GameSnapshot.incomePerSec` = **前景**速率（畫面上正在跳的數字）。
- `GameSnapshot.anyClerkHired` = 至少一攤 `clerkHired`。

### 4.4 升級成本

```ts
upgradeCost(level) = Math.floor(upgradeCostBase × upgradeCostGrowth^(level-1))
```

- `level` 是**目前等級**（即將從 Lv → Lv+1 的價格）。
- **成本在 `<= Number.MAX_SAFE_INTEGER` 時保證是整數**（`Math.floor`）。理由：`餘額 == 價格` 的邊界案例要能精確斷言（驗收 A2，只在此範圍測）。
- 成本超過 `Number.MAX_SAFE_INTEGER` 後**不再保證整數**：Lv150 的大腸包小腸成本約 `14000 × 1.25^149 ≈ 3.8e18`，已超出精確整數範圍。MVP 7 天內可達的最大成本約 6e13（§10），碰不到這條界線；`maxLevel = 150` 只是防呆。
- `level >= maxLevel` → 沒有下一級，`upgradeCost = null`。

### 4.5 雇用與解鎖成本

- `hireCost`：固定值，不隨等級變動，**每攤只能雇一位**。
- `unlockCost`：固定值，**必須依序解鎖**：第 N 攤只有在第 N-1 攤 `unlocked` 後才能解鎖。
  `stalls[0].unlockCost = 0`（開局已解鎖）。

### 4.6 結算

```ts
settle(state, now, mode: 'foreground' | 'offline'): SettleResult
```

1. `elapsedMs = now - lastSettledAt`
2. **時鐘倒退**（`elapsedMs < 0`）：
   - `gained = 0`、`elapsedMs = 0`、`creditedMs = 0`、`capped = false`、`timeWentBackwards = true`
   - `balance` **不得變小**（不扣錢）
   - `lastSettledAt` **對齊到 `now`**（水位線跟著往回，避免時鐘設錯後長時間沒有收益）
3. `elapsedMs >= 0`：
   - **前景長空檔自動轉離線（v1.1 新增）**：
     `maxGapMs = foreground.maxGapSeconds × 1000`（現值 60 秒）。
     當呼叫端要求 `'foreground'`、但 `elapsedMs > maxGapMs` 時，**這次一律改用 `'offline'` 規則結算**（只計店員、套 4h 上限）。
     理由：分頁凍結、電腦睡眠時 `visibilitychange` 不一定會觸發；玩家手動把時鐘往前調時，下一次 `tick` 會用前景速率（含手動開賣、無上限）一次補上全部時間，等於直接繞過「離線上限 4h」。
     形式化：`effectiveMode = (requested === 'foreground' && elapsedMs > maxGapMs) ? 'offline' : requested`。
     這條規則適用於**所有**前景入口：`tick`、`onHidden`、以及動作前的結算；`init` / `onVisible` 本來就是 `'offline'`。
   - `effectiveMode === 'offline'`：
     `capMs = capSeconds × 1000`
     `creditedMs = min(elapsedMs, capMs)`
     `capped = elapsedMs > capMs`
   - `effectiveMode === 'foreground'`：
     `creditedMs = elapsedMs`、`capped = false`
   - `gained = ratePerSec(effectiveMode) × creditedMs / 1000`（rate 用**結算當下**的等級與店員狀態，不追溯歷史等級）
   - `balance += gained`
4. `lastSettledAt = now`（往前對齊）

**幂等**：同一個 `now` 連續呼叫兩次 → 第二次 `elapsedMs = 0`、`gained = 0`。

**不重複計算**：任何結算都只從 `lastSettledAt` 起算。UI／store 不得自己累加 delta。

---

## 5. 動作規則

所有動作都是「先 `settle(now, 'foreground')`，再嘗試動作」。
長空檔時這次結算會自動改用離線規則（§4.6），但**不影響動作本身的成敗判定**——動作照表中的前置條件與成本執行。
動作失敗時**狀態完全不變**（含 `lastSettledAt` 已因結算前進的情況——結算本身照常，動作部分不動）。

> 純函式層 `NightMarketCore` 的動作**不結算**（方法沒有 `now` 參數）：呼叫端要自己先 `settle`。
> 只有門面層 `GameEngine` 會自動先結算。驗收若要斷言「失敗不動狀態」，用純函式層最乾淨。

| 動作 | 前置條件 | 成本 | 成功後 |
|---|---|---|---|
| `unlock(id)` | 未解鎖、前一攤已解鎖、`balance >= unlockCost` | `unlockCost` | `unlocked=true, level=1, selling=false, clerkHired=false`，`balance -= unlockCost` |
| `upgrade(id)` | 已解鎖、`level < maxLevel`、`balance >= upgradeCost(level)` | `upgradeCost(level)` | `level += 1`，`balance -= cost` |
| `hire(id)` | 已解鎖、`!clerkHired`、`balance >= hireCost` | `hireCost` | `clerkHired = true`（該攤自動營業），`balance -= hireCost` |
| `toggleSell(id)` | 已解鎖、`!clerkHired` | 免費 | `selling = !selling` |

- **`toggleSell` 語意定案**：「開賣／收攤」是手動營業開關，只影響前景收益，離線不計入（§4.3）。
  已經雇用店員的攤位不再需要手動開賣 → `toggleSell` 回 `false`、狀態不變（`canToggleSell = false`）。
- 失敗語意：門面層回 `false`、不丟例外；純函式層回 `{ok:false, reason, state}`，`state` 必須是**傳入的同一個物件參考**。
- 失敗原因 `ActionFailure`：
  `no-such-stall`（id 不在 balance.json）、`stall-locked`（未解鎖；解鎖鏈前提未滿足也用它）、
  `already-unlocked`（重複解鎖）、`max-level`、`clerk-already-hired`（重複雇用／已雇還想切換開賣）、
  `insufficient-funds`。

### 5.1 快照欄位規則（`StallSnapshot`）

| 欄位 | 規則 |
|---|---|
| `incomePerSec` | `unlocked && (clerkHired || selling)` ? `stallIncomePerSec(level, clerkHired)` : 0 |
| `unlockCost` | 已解鎖 → `null`，否則 `balance.json` 的值（**不看**解鎖鏈前提） |
| `upgradeCost` | 未解鎖或 `level >= maxLevel` → `null`，否則 `upgradeCost(level)` |
| `hireCost` | 未解鎖或已雇用 → `null`，否則 `hireCost` |
| `canUnlock` | `!unlocked && 前一攤已解鎖 && balance >= unlockCost` |
| `canUpgrade` | `unlocked && level < maxLevel && balance >= upgradeCost(level)` |
| `canHire` | `unlocked && !clerkHired && balance >= hireCost` |
| `canToggleSell` | `unlocked && !clerkHired` |
| `nextMilestone` | 第一個 `level > 目前等級` 的里程碑；沒有 → `null` |
| `nextMilestone.progress` | `clamp((level - prev) / (next.level - prev), 0, 1)`；`prev` = 前一個已達成的里程碑等級，第一段用 0 |

進度條例子（里程碑 25/50/100）：Lv1 → 1/25 = 0.04；Lv25 → 0（往 50 重新起算）；Lv50 → 0（往 100，區間寬 50）；
Lv75 → (75-50)/50 = 0.5；Lv100 → `nextMilestone = null`、UI 顯示滿格。

---

## 6. 事件流程（門面 `GameEngine`）

| 呼叫 | 行為 |
|---|---|
| `init(now, savedState)` | `savedState === null` → 直接開新局（`lastSettledAt = now`、`loadError = null`）。有字串 → `load(savedState)`：成功就用存檔開局；失敗則開新局並把原因放 `loadError`（`corrupt` / `unknown-version` / `unsupported-shape`），**不彈錯誤、不崩**。之後立刻 `settle(now, 'offline')`：`gained > 0` 才把 `offline` 填進 `EngineFrame`。 |
| `tick(now)` | 前景推進：`settle(now, 'foreground')`。若 `elapsedMs > maxGapMs`（§4.6 長空檔），這次自動改用離線規則結算，`gained > 0` 時填入 `frame.offline` 讓 UI 跳彈窗；其餘情況 `offline = null`。**在 `onHidden` 之後、`onVisible` 之前呼叫 `tick` 一律忽略**（不結算、不改狀態），避免背景 timer 與離線結算重複計入。 |
| `onHidden(now)` | 先 `settle(now, 'foreground')` 把前景收益結清（長空檔同樣走 §4.6 自動轉離線），再標記 `hidden = true`。回傳 `void`，這種入帳**不跳彈窗**（見下方邊界說明）。**重複呼叫（v1.2）**：已在 `hidden` 狀態時再呼叫一律忽略——不結算、不改狀態，直到 `onVisible` 為止。`visibilitychange` 與 `pagehide` 常同時觸發；第二次若又走前景規則，會把手動開賣的攤位當成「人在顧攤」入帳，違反 §2／§4.3。 |
| `onVisible(now)` | 標記 `hidden = false`，`settle(now, 'offline')`；`gained > 0` 才回 `offline`（含 `creditedMs`、`capped`、`timeWentBackwards`）。 |
| `save(now)` | **只序列化**（`savedAt = now`），不結算。回傳字串，UI 原樣寫 `localStorage`。 |
| `state()` | 回目前 `GameSnapshot`。 |

離線彈窗規則：`offline !== null`（即 `gained > 0`）才顯示；`gained === 0`（含 0 秒、時鐘倒退、全部攤位都沒有店員）**不跳**。
`capped === true` 時 UI 顯示「已達 4 小時上限」提示。

**長空檔的彈窗邊界（v1.1）**：只有會回傳 `EngineFrame` 的入口（`init` / `tick` / `onVisible`）才會帶 `offline`。`onHidden` 與動作前的自動離線結算只入帳、不跳彈窗：這兩個入口的回傳型別是 `void` / `boolean`，沒有 frame 可帶。實務上 UI 每 250ms `tick`，長空檔幾乎都由 `tick` 先偵測到；漏掉的只影響提示，不影響金額與上限（金額已按離線規則入帳）。

### 6.1 存檔時機（UI 硬規則，v1.1 新增）

`save()` 只做序列化（不結算），**什麼時候存是 UI 的責任**。沒有這些規則，App 在背景被系統直接殺掉時會遺失最後一次存檔之後的進度。

| 時機 | 規則 |
|---|---|
| `onHidden(now)` 之後 | **立刻** `save(now)`（同一個 `now`）。這是「被系統殺掉」前最重要的一次。 |
| 每次動作成功後 | `upgrade` / `hire` / `unlock` / `toggleSell` 回 `true` 後**立刻** `save(now)`（用該動作傳入的 `now`）。回 `false` 不必存。 |
| 前景定期 | 每 `save.foregroundIntervalSeconds` 秒（現值 10 秒）`save(Date.now())`；可與 `tick` 的 timer 共用，累積滿 N 秒做一次。 |
| `init` 之後 | 不強制存檔（下一次動作或定期存檔會寫）。 |

- UI 只把字串原樣寫進**單一** `localStorage` key，不解析、不改寫；key 名稱由 UI 決定（GDD 不指定）。
- 寫入失敗（quota、隱私模式）不得影響遊戲進行：吞掉例外、最多 console 警告，下一次時機再試。
- 存檔字串裡的 `lastSettledAt` 是最後一次**結算**的時間，而結算每 tick 都在推進；因此重載後會用離線規則補算「最後一次存檔到重載」之間的時間（只計店員、上限 4h）。代價是手動開賣的攤位最多損失一個存檔間隔（10 秒）的收益，MVP 接受。
- 驗收（MiniMax31）：做一個動作 → 重新整理頁面 → 進度必須保留到該動作（對應 §9 D1 與 E2E G 系列）。

---

## 7. 數字格式

顯示**一律**走 `src/core/money.ts` 的 `formatMoney`（UI 不得自己拼字串）。規則（與現行實作一致，改規則必須同步改本節與 `tests/unit/money.test.ts`）：

1. 絕對值 `< 10000`：**向下取整**顯示整數，`9999.99 → "9999"`。
2. `>= 1e4`：除以 `1e4`，單位「萬」；`>= 1e8`：「億」；`>= 1e12`：「兆」（取最大的適用單位）。
3. 縮寫後最多保留 **2 位小數，向下取**（不誇大持有金額），並去掉尾端 0：`1.23000萬 → "1.23萬"`、`1.50000萬 → "1.5萬"`、`2.00000萬 → "2萬"`。
4. 負數保留 `-` 前綴（理論上不會出現，防禦用）。
5. `NaN` / `Infinity` → 丟 `RangeError`（顯示層不得傳入非有限值）。

邊界實例（驗收 F1–F5 直接引用）：

| 輸入 | 輸出 |
|---|---|
| `0` / `999` / `9999` / `9999.99` | `0` / `999` / `9999` / `9999` |
| `10000` | `1萬` |
| `12345` | `1.23萬` |
| `15000` | `1.5萬` |
| `99999999` | `9999.99萬` |
| `100000000` | `1億` |
| `123456789` | `1.23億` |
| `999999999999` | `9999.99億` |
| `1e12` | `1兆` |

- 頂欄「收益/秒」也是 `formatMoney(incomePerSec)`；`incomePerSec` 為 0 時顯示 `0`。
- 成本、離線收益金額同樣走 `formatMoney`。

---

## 8. 存檔

### 8.1 格式（`saveVersion = 1`）

`save(now)` 回傳的字串是下列 JSON：

```json
{
  "version": 1,
  "savedAt": 1792632636000,
  "state": {
    "saveVersion": 1,
    "balance": 1234.5,
    "lastSettledAt": 1792632636000,
    "stalls": {
      "chicken-steak": { "level": 3, "unlocked": true, "clerkHired": false, "selling": true },
      "bubble-tea":    { "level": 0, "unlocked": false, "clerkHired": false, "selling": false }
    }
  }
}
```

- `version` = 信封版本（v1.2：**驗證與遷移只認這一層**）。`state.saveVersion` 只是序列化時寫下的冗餘欄位：讀檔不檢查，缺失或與信封 `version` 不一致都不算損毀；讀檔成功後一律改寫成 `currentVersion`。
- 上面範例只列 2 個攤位示意；實際序列化要寫 `balance.json` 的**全部**攤位（未解鎖也寫，值為 0/false）。
- `savedAt` 只是「最後一次存檔時間」的顯示用資訊，**不是**收益水位線；收益只認 `state.lastSettledAt`。
- 序列化時 `stalls` 必須包含 `balance.json` 的全部攤位（未解鎖也要寫，值為 0/false）。
- 不寫任何非必要的額外欄位（避免存檔膨脹）；讀檔時未知欄位忽略。

### 8.2 讀檔驗證（`load`，不得丟例外）

| 情況 | 結果 |
|---|---|
| `raw === null` | 只有測試會直接呼叫。回 `{ok:false, reason:'unsupported-shape', detail:'no-save'}`。**門面不走這條**：`init(now, null)` 直接開新局、`loadError = null`（正常首次啟動，不算錯誤）。 |
| JSON 解析失敗 | `reason: 'corrupt'` |
| 信封缺 `version` / `savedAt` / `state`，或 `state` 缺 `balance` / `lastSettledAt` / `stalls` | `reason: 'unsupported-shape'` |
| `version` 比程式支援的新（> 1） | `reason: 'unknown-version'` |
| `version` 不是 0 或 1（含負數、非整數） | `reason: 'unsupported-shape'` |
| 攤位條目缺欄位、型別錯、`level` 非整數或 < 0 | `reason: 'unsupported-shape'` |
| 攤位已解鎖（`unlocked = true`）但 `level = 0`（v1.2） | **不算錯**：讀檔正規化成 Lv1（守住 §3 不變式 2）。未解鎖的攤位則一律正規化成 `level 0, clerkHired false, selling false`。 |
| `state.saveVersion` 缺失、或與信封 `version` 不一致（v1.2） | **不算損毀**：內層 `saveVersion` 不檢查，一律以信封 `version` 為準；讀檔成功後改寫成 `currentVersion`。 |
| `balance` 非有限數或 < 0 | `reason: 'unsupported-shape'` |
| 存檔缺少 `balance.json` 定義的某個攤位 | **不算錯**：補預設值（`level 0, unlocked false, clerkHired false, selling false`） |
| 存檔出現 `balance.json` 沒有的攤位 id | **不算錯**：忽略該筆 |

補充：
- 讀檔成功但 `level > maxLevel` → 夾到 `maxLevel`（不視為損毀）。
- 讀檔失敗時門面**不得覆寫或刪除**既有存檔；下一次 `save()` 才會覆寫（MVP 只有單一存檔槽）。
- `migratedFrom` 只在真的做過遷移時有值。

### 8.3 版本 0 → 1 遷移（MVP 唯一的舊版）

版本 0 是 M0 假資料期的扁平形狀：

```json
{ "version": 0, "savedAt": 1792632636000, "balance": 500,
  "lastSavedAt": 1792632636000,
  "stalls": [ { "id": "chicken-steak", "level": 4, "unlocked": true, "clerkHired": false } ] }
```

遷移規則：

1. `balance` 照抄。
2. `stalls` 陣列 → `Record<id, StallState>`：`selling = false`，其他欄位照抄。
3. `balance.json` 有、v0 存檔沒有的攤位 → 補預設（未解鎖 Lv0）。
4. `lastSettledAt = lastSavedAt`（缺 `lastSavedAt` 時用 `savedAt`）。
5. `saveVersion = 1`，`migratedFrom = 0`。

### 8.4 存檔版本政策

- 現行版本 1；未來改結構時：`version` +1，並在 `src/core` 加一支遷移函式（v(n) → v(n+1)），逐版升上來。
- 讀到 `version > currentVersion` → `unknown-version`，不猜、不 downgrade。
- `minSupportedVersion`（`balance.json` 的 `save.minSupportedVersion`，現值 0）以下的版本視為 `unsupported-shape`。

---

## 9. 驗收可以依賴的行為（給 MiniMax31）

| # | 案例 | 可觀察的期望 |
|---|---|---|
| A1 | 餘額 < 價格 | 門面回 `false`；`state()` 各欄位不變（除結算外）；純函式層 `{ok:false, reason:'insufficient-funds'}` 且 `state` 同參考 |
| A2 | 餘額 == 價格 | 成功，`balance === 0`（成本 ≤ `Number.MAX_SAFE_INTEGER` 時保證整數、可用 `===`；**只在低等級測**，建議 Lv1–Lv10） |
| A3 | 餘額 > 價格 | 成功，`balance === 舊值 - cost`（浮點容差見下） |
| A4 | 升級成本 | `floor(upgradeCostBase × upgradeCostGrowth^(level-1))` |
| A5 | 升級後 | `level + 1`，收益同步變為新等級的公式值 |
| A6 | 雇用店員 | 錢不夠 → `false` 且狀態不變；成功後 `clerkHired = true`，`incomePerSec` 套 `clerkIncomeMultiplier`，離線結算開始計入該攤 |
| A7 | 解鎖順序 | 前一攤未解鎖 → `false` / `stall-locked`；依序解鎖成功後 `level = 1, selling = false` |
| B1 | 每秒收益 | §4.2 公式（前景條件見 §4.3） |
| B2 | 里程碑 | Lv24→25、49→50、99→100 倍率各 ×2（累乘） |
| B3 | 里程碑前後 | 同一攤 Lv24 與 Lv25 的收益比 = `2 × incomeGrowthPerLevel` |
| B4 | 無店員、未開賣 | 該攤 `incomePerSec === 0`，`tick` 不產生收益 |
| B5 | 手動開賣 | `selling = true` 後前景有收益；進背景後該攤**不計入**離線收益 |
| C1 | 離線 0 秒 | `gained 0`、`elapsedMs 0`、`offline === null`（不跳彈窗） |
| C2 | 剛好 4h | `creditedMs === capSeconds × 1000`、`capped === false` |
| C3 | 超過 4h | `creditedMs === capSeconds × 1000`、`capped === true`、`gained` 只算 4h |
| C4 | 時鐘倒退 | `gained 0`、`timeWentBackwards true`、`balance` 不變小、`lastSettledAt` 對齊到 `now`；不跳彈窗 |
| C5 | 負時間差（多往前倒退幾次） | 同上，且不會累積負收益 |
| C6 | 前景長空檔（`tick` 路徑） | `tick(t2)` 且 `t2 - lastSettledAt > maxGapMs` → 這次按**離線**規則入帳（只算店員、套 `capSeconds` 上限），`frame.offline` 有值且 `gained > 0`；`capped` 依是否超過 `capSeconds` |
| C7 | 前景長空檔（動作前結算） | 同樣按離線規則入帳（**不因手動開賣而套前景速率**）；動作本身照規則成功／失敗；此入口不跳彈窗（回 `boolean`） |
| D1 | save → load | 金錢、等級、解鎖、店員、開賣狀態完整還原，`lastSettledAt` 一致 |
| D2 | JSON 損毀 | 不丟例外；`reason = 'corrupt'`；門面開新局 |
| D3 | 缺必要欄位 | 不丟例外；`reason = 'unsupported-shape'`；門面開新局 |
| D4 | 版本 0 存檔 | 依 §8.3 遷移，`migratedFrom = 0`，數值正確 |
| D5 | 未知更高版本 | `reason = 'unknown-version'`，不崩、不覆寫 |
| D6 | 已解鎖但 `level = 0`（v1.2） | 讀檔正規化成 Lv1，不算損毀 |
| D7 | 信封與內層版本不一致（v1.2） | 以信封 `version` 為準、不檢查 `state.saveVersion`；讀檔後改寫成 `currentVersion` |
| E1 | 背景不重複算 | `tick(t1)` → `onHidden(t1)` → `onVisible(t2)`：總收益只等於 `[t0, t1]` 前景 + `[t1, t2]` 離線 |
| E2 | 連續兩次 `onVisible` | 第二次 `gained === 0` |
| E3 | 重複 `onHidden`（v1.2） | 已在 hidden 時再呼叫 `onHidden` 不結算、不改狀態；回到 `onVisible` 後仍結算完整背景區間，不被截短 |
| F1–F5 | 數字格式 | 依 §7 表 |
| G1–G10 | 玩法 E2E | 依 `src/ui/testids.md`，金額一律 `formatMoney`；案例定義見 `tests/e2e/README.md`：G1 開局畫面、G2 開賣入帳、G3 升級、G4 雇店員、G5 解鎖、G6 解鎖鏈、G7 動作後存檔重載、G8 離線收益彈窗、G9 前景定期存檔、G10 前景長空檔改用離線規則 |

**A1「狀態完全不變」怎麼測**：門面動作會先結算，時間有推進時 `balance` 本來就會變。要斷言
「失敗不動狀態」，請用純函式層（`upgrade(state, id)` 不帶 `now`，失敗回同一個 `state` 參考），
或用相同的 `now` 呼叫門面（結算 delta = 0），否則深比對會誤判。

**浮點比較容差**（驗收比金額時一律照這個，避免為浮點誤差改期望值）：

```
|actual - expected| <= max(1e-6, |expected| × 1e-9)
```

成本（整數）與 `creditedMs`（整數）用 `===`。

---

## 10. 平衡目標與現況模擬

> ✅ **可由 `npm run sim` 重現（v1.2）**：下表的「現值模擬」欄由 `tools/sim/run.ts` 產出，指令為 `npm run sim`（預設跑到第一攤 Lv100 或 7 天為止，可用 `--hours` / `--seconds` 縮短）。數字是純函式層 `src/core` 的實測值；v1.1 草案的數字與本版差異 ≤ 12%，全部落在 ±30% 容許範圍內。

`data/balance.json` 現值下的模擬結果。**模擬假設**（`tools/sim` 必須能重現）：

- 全程前景、每 1 秒結算一次（等於每 tick 結算，浮點誤差在此量級可忽略）。
- 開局 1 秒內手動開賣雞排車（`selling = true`）。
- 策略：能解鎖就依序解鎖 → 能雇用就雇用（每攤一位）→ 其餘把錢花在「收益增幅 ÷ 成本」最大的攤位上，買到買不起為止。

| 檢查點 | 目標 | 現值模擬 |
|---|---|---|
| 第二次升級（雞排 Lv3） | ≤ 1 分鐘 | 21 秒 |
| 解鎖珍珠奶茶 | 5–15 分鐘 | 10.4 分鐘 |
| 解鎖蚵仔煎 | 30–60 分鐘 | 34.1 分鐘 |
| 解鎖臭豆腐 | 1–2 小時 | 1.32 小時（79.2 分鐘） |
| 解鎖大腸包小腸 | 2–4 小時 | 2.88 小時（172.8 分鐘） |
| 1 小時 | 3 攤、雞排 Lv30+ | 3 攤、Lv38 / Lv30 / Lv22，前景速率約 429/秒 |
| 6 小時 | 5 攤全開 | 5 攤全開，Lv66 / 58 / 50 / 41 / 33，速率約 5.5e4/秒 |
| 24 小時 | 雞排 Lv75+ | 雞排 Lv81，速率約 3.0e5/秒 |
| 7 天 | 雞排達 Lv100 里程碑 | 156.30 小時（6.5 天）達 Lv100 |
| 里程碑時間 | 第一個 Lv25 在 1 小時內 | 雞排 0.38h（22.6 分）、珍奶 0.74h（44.3 分） |

- 目標欄位是**設計意圖**（給 MiMo26 平衡模擬對照）；模擬欄位是現值的實測值。偏差超過 ±30% 時提 issue 討論調值，不要直接改 `balance.json`。
- 數值安全邊界：MVP 7 天內可達的最大升級成本約 6e13 元（Lv100 的大腸包小腸），遠低於 `Number.MAX_SAFE_INTEGER`（9.007e15），所以 A2 的 `===` 斷言在這個範圍成立。`maxLevel = 150` 只是防呆上限，正常 7 天內到不了；Lv150 的大腸包小腸成本約 3.8e18 已超過 `MAX_SAFE_INTEGER`、**不保證整數**（§4.4），不在驗收範圍。
- 若之後要延長遊戲壽命，優先調 `incomeGrowthPerLevel`／`upgradeCostGrowth`，不要動公式。

---

## 11. 不在 MVP 範圍

廣告、內購、轉生／ prestige、雲端存檔、多存檔槽、音效、動畫、排行榜、
店員升級、攤位外觀解鎖、離線加速道具。

> v1.1 起「前景長空檔」不再列為已知風險：超過 `maxGapMs` 的前景結算改用離線規則（§4.6）。這不是一般性的前景收益上限（60 秒內的正常連續結算完全不受影響）。

---

## 12. 待辦與變更紀錄

| 日期 | 版本 | 變更 |
|---|---|---|
| 2026-10-22 | 1.0 | 初版定案：公式、動作、離線、存檔 v1 + v0 遷移、數字格式、平衡目標。解決 `src/core/API_CONTRACT.md` §9 的 8 個待定項。 |
| 2026-10-22 | 1.1 | 依 怪獸8號 01:50 審查修訂：①前景長空檔（> `foreground.maxGapSeconds`）自動改用離線規則結算並在 `tick` 帶出彈窗（§4.6、§6、§9 C6/C7）；②補存檔時機 UI 硬規則（§6.1）；③升級成本整數保證限定在 ≤ `MAX_SAFE_INTEGER`、A2 限定低等級（§4.4、§9）；④§10 模擬結果標示待 `tools/sim` 重現。`balance.json` 新增 `foreground.maxGapSeconds` 與 `save.foregroundIntervalSeconds`。 |
| 2026-10-22 | 1.2 | `tools/sim` 落地（`npm run sim`）：§10「現值模擬」欄改用實測值並移除待重現標示。與 v1.1 草案差異 ≤ 12%（1 小時速率 383 → 429/秒、蚵仔煎 38.0 → 34.1 分、臭豆腐 84.1 分 → 1.32 小時），全部在 ±30% 容許範圍內，`balance.json` 未調整。同時補三個規格空白（怪獸8號 2026-10-22 裁決）：①§6 重複 `onHidden` 只結算第一次，`onVisible` 之前再呼叫一律忽略；②§8.2 已解鎖但 `level = 0` 讀檔正規化成 Lv1，不算損毀；③§8.1／§8.2 版本以外層信封 `version` 為準、內層 `state.saveVersion` 不檢查、讀檔後改寫成 `currentVersion`。§9 補對應驗收列 E3／D6／D7。 |

已解決的待定項（原 `API_CONTRACT.md` §9）：

1. **開賣語意** → 手動營業開關，只算前景；離線只算店員（§4.3、§5）。
2. **等級起算** → 解鎖即 Lv1，未解鎖 Lv0（§3）。
3. **無店員時收入** → 未開賣 0；手動開賣等於同公式（不套店員加成）。
4. **里程碑倍率** → 累乘，25/50/100 各 ×2（§4.1）。
5. **`maxLevel`** → 每攤 150，成本上限約 6e13，無精度風險（§10）。
6. **時鐘倒退後 `lastSettledAt`** → 對齊到 `now`（§4.6）。
7. **`BalanceConfig` 額外參數** → `startingBalance`、`incomeGrowthPerLevel`、`clerkIncomeMultiplier`、`save.{currentVersion,minSupportedVersion}`（§13）。
8. **金額取整** → 結算不取整，只在顯示層 floor（§1、§7）。

---

## 13. `data/balance.json` 結構

```jsonc
{
  "version": 1,
  "startingBalance": 0,
  "incomeGrowthPerLevel": 1.1,
  "clerkIncomeMultiplier": 1.25,
  "milestones": [ { "level": 25, "multiplier": 2 }, ... ],
  "offline": { "capSeconds": 14400 },
  "foreground": { "maxGapSeconds": 60 },
  "save": { "currentVersion": 1, "minSupportedVersion": 0, "foregroundIntervalSeconds": 10 },
  "stalls": [
    {
      "id": "chicken-steak",
      "name": "雞排車",
      "emoji": "🍗",
      "unlockCost": 0,
      "baseIncomePerSec": 1,
      "upgradeCostBase": 10,
      "upgradeCostGrowth": 1.25,
      "hireCost": 150,
      "maxLevel": 150
    }
  ]
}
```

- 這份結構與 `src/core/api.ts` 的 `BalanceConfig` 一一對應；改欄位要同時改型別與本節。
- `stalls` 的順序就是解鎖順序與畫面順序，不得重排。
- 讀取方式：`import balance from '../../data/balance.json'`（`tsconfig.json` 已開 `resolveJsonModule`），
  型別以 `BalanceConfig` 標註。程式**不得**把任何數值寫死在程式碼裡（`AGENTS.md` 硬規則 2）。
- `foreground.maxGapSeconds`：前景長空檔門檻（§4.6）。`save.foregroundIntervalSeconds`：UI 定期存檔間隔（§6.1）。兩者都只是設定值，程式不得寫死。
- 目前完整內容就是 `data/balance.json`（5 攤、里程碑 25/50/100、離線 14400 秒、前景門檻 60 秒、存檔間隔 10 秒）。
