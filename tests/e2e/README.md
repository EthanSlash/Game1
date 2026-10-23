# tests/e2e — 瀏覽器端玩法測試

| 檔案 | 內容 |
|---|---|
| `smoke.spec.ts` | M0 留下的骨架測試。**保留、不要刪也不要改**（怪獸8號 2026-10-22 指示）。等 G1 穩定後，另開一支 PR 把 smoke 改成 testid 並移除那三個 M0 class。 |
| `gameplay.spec.ts` | 玩法 E2E：G1–G10。 |
| `helpers.ts` | 共用工具（假時鐘、金額公式、localStorage 讀取、背景/前景切換）。 |

跑法：

```bash
npm run e2e                      # 兩個裝置（iPhone 13 / Pixel 7）都跑
npx playwright test tests/e2e/gameplay.spec.ts --project=iphone-13
```

---

## 1. 時間怎麼推進：用 Playwright 假時鐘，不靠真實等待

`src/ui` 每 250ms `tick` 一次，引擎是**連續時間制**（結算看的是經過多久，不是 tick 幾次）。
要測「開賣 → 賺錢 → 升級 → 解鎖 → 雇店員 → 重載」這條路徑，必須真的讓時間走過去，
所以這支 spec 用 `page.clock` 假時鐘，**完全不塞存檔、不改程式狀態**。

### 用到的事實（都在本機實測過，Playwright 1.64.1）

| 事實 | 結論 |
|---|---|
| `clock.install({ time })` 之後時鐘仍跟著真實時間走 | 要用 `clock.pauseAt()` 凍住，否則金額不可重現 |
| `clock.pauseAt(t)` | 會把「待觸發的 timer」推到 `t` 並觸發一次 → **tick 格線被對齊到 `t`** |
| `clock.fastForward(ms)` | 跳時間，只觸發**一次**待觸發的 timer（等於「使用者離開一段時間再回來」） |
| `clock.runFor(ms)` | 真的逐格觸發 timer（每 250ms 一次），用來量測「持續前景」 |
| `clock.pauseAt()` / `fastForward()` / `runFor()` 之後仍然維持 paused | 每次操作後時間不會偷偷漂移 |
| **`page.reload()` 之後假時鐘還在** | 假時刻會被記錄成一串操作、reload 後重播，所以 reload 前後時間是連續的、時間軸沒有斷層 → G7（重載後繼續推進時間）做得到 |
| reload 後 tick 格線會重來 | reload 後要重新對齊（見下） |

### 為什麼要「對齊格線」

UI 的前景 loop 是 `setInterval(250ms)`，觸發點落在「安裝假時刻 + 250ms」的格線上，
跟我們操作的時點不一定對齊。格線沒對齊時，最後一次 tick 會落在量測窗口結束前最多
250ms 的地方，金額就少一截（畫面金額又是向下取整，差 1 就看得出來）。

`bootGame()` 因此固定做三件事：

1. `clock.install({ time: 固定起始時間 })` → 起始時間不依賴真實時鐘；
2. `clock.pauseAt(now + 1000)` → 凍住時鐘（要多給 1 秒：`install` 之後時鐘還在走，
   直接餵當下的時間會變成 "Cannot fast-forward to the past"）；順帶把 tick 格線對齊到現在；
3. `clock.fastForward(250)` → 再次確認格線對齊（重載後、或頁面載入較慢時需要）。

對齊之後，每次 `runFor(N)`（N 是 250 的倍數）的最後一次 tick 都剛好落在窗口結尾，
金額可以**精確斷言**（例：Lv1 每秒 1 元、`runFor(10_000)` 之後餘額就是 10）。

### 前進兩種方式、差在哪

| 方式 | 用途 | 說明 |
|---|---|---|
| `tickForeground(page, ms)` | `runFor`，真的每 250ms tick | 測「持續前景」的收益、存檔時機。`ms` 必須是 250 的倍數 |
| `advanceForeground(page, ms)` | `fastForward`，每段最多 `maxGapSeconds - 1` 秒 | 累積長時間（賺到解鎖費）。分段是為了**不要**觸發 §4.6 的長空檔規則；引擎是連續時間制，一段 59 秒與每 250ms 連續 tick 59 秒的金額完全相同 |

長空檔（超過 `foreground.maxGapSeconds`）是 G10 專門測的，那裡刻意讓 `fastForward`
一次跳超過門檻。

### 金額期望值

- 期望值一律由 `data/balance.json` + GDD §4.1／§4.2／§4.4 公式算出（`helpers.ts` 的
  `stallIncomePerSec` / `upgradeCost` / `milestoneMultiplier`），**spec 裡不寫死任何金額**。
- 要比對畫面文字時，期望值也走 `formatMoney`（GDD §7），所以調 `balance.json` 時測試
  不需要跟著改。
- 畫面金額是**向下取整的整數**，所以要證明「速率真的變了」，要看足夠長的窗口：
  例：Lv1 → Lv2 是 1.1 倍，10 秒的話 10 vs 11（差 1，但畫面取整後剛好差 1，可辨）；
  25 秒的話 25 vs 27.5（顯示 27），差得更明顯。

### 一個 import 的取捨

`formatMoney` 從 `src/core/money` 匯入，**不是** `src/core/index.ts`：Playwright 的 ESM
loader 要求 JSON import 帶 import attribute（`with { type: 'json' }`），而
`src/core/index.ts` 裡的 `import balanceData from '../../data/balance.json'` 沒帶，
從 index 匯入會在載入階段直接炸掉。`src/core/money.ts` 本身不 import JSON，所以單獨
從它匯入同一支 `formatMoney`（同一份實作、同一套格式化規則）。

`data/balance.json` 則直接用 `import balanceJson from '../../data/balance.json' with { type: 'json' }`
匯入（JSON 的 import attribute 在測試檔裡可以加）。

---

## 2. G1–G10 的定義

> 這份定義屬於「測試作者」，規格（`docs/GDD.md`）的擁有者是 DeepSeek41。
> 建議放進 GDD §9 的文字在本文最後一節，由 DeepSeek41 在本 PR merge 後收進去。

| # | 案例 | 對應 GDD | 可觀察的期望 |
|---|---|---|---|
| G1 | 開局畫面 | §3 | 5 張攤位卡、4 張鎖住；第一攤 `Lv.1`、未開賣（收益 0/秒）；餘額 = `startingBalance`；`雇店員` / `解鎖` 因餘額不足而 disabled；鎖住的攤位沒有等級；離線彈窗不出現 |
| G2 | 開賣 → 前景收益入帳 | §4.3、§5 | 點 `sell-<id>` 後按鈕變「收攤」、頂欄與攤位卡都顯示每秒 = `baseIncomePerSec`；前景 10 秒後餘額 = 10 秒 × 每秒速率 |
| G3 | 升級 → 等級 +1、收益同步上升 | §5、§4.2、§4.4 | 餘額剛好等於升級成本時升級成功（餘額 == 價格）；等級 `Lv.2`、餘額扣掉成本；25 秒後餘額 = 25 秒 × `incomeGrowthPerLevel` 成長後的速率（Lv1 與 Lv2 的差異看得出來） |
| G4 | 雇店員 → 收益套店員倍率 | §5、§4.2 | 雇用後 `hire-<id>` 與 `sell-<id>` 都不再渲染；10 秒收益是「有店員」的速率（無店員的 10 元 vs 有店員的 12.5 元，顯示 12） |
| G5 | 解鎖 → 攤位解鎖、Lv1 | §3 不變式 4、§5 | 解鎖鈕在錢夠時 enabled；解鎖後卡片不再是 locked、出現 `Lv.1`、收益 0/秒（沒開賣）、出現「開賣」鈕；餘額扣掉 `unlockCost` |
| G6 | 解鎖鏈 | §4.5、§5 | 錢夠但前一攤沒解鎖時，該攤的 `unlock-<id>` 仍是 disabled；前一攤解鎖後變成 enabled，解鎖後為 `Lv.1` |
| G7 | 動作後存檔 → 重載後進度保留 | §6.1、§9 D1 | 動作成功後 localStorage 的存檔立刻是「動作後」的狀態（等級、餘額）；重載後等級與「收攤」狀態都還在，餘額不得倒退（§6.1 允許手動開賣攤最多損失一個存檔間隔的收益）；離線收益 0 時不跳彈窗 |
| G8 | 離線收益彈窗 | §6、§4.3 | 進背景 1 小時再回前景：彈窗出現、金額 = 只有店員攤的每秒速率 × 離線時長、時長 = 實際計入的毫秒、未達上限時不顯示上限提示、餘額加上該金額；關掉彈窗後不會再跳同一筆 |
| G9 | 前景定期存檔 | §6.1 第 3 條 | 前景超過 `save.foregroundIntervalSeconds` 後，存檔的 `savedAt` 與 `state.lastSettledAt` 都會往前進 |
| G10 | 前景長空檔 | §4.6、§9 C6 | 前景一次跳過超過 `foreground.maxGapSeconds` → 這次結算改用**離線**規則（只算店員、套離線上限），彈窗出現且金額只含店員攤 |

G8 / G10 之所以要「一攤自己顧攤、另一攤雇店員」，是因為那樣前景速率與離線速率才會不同，
才分辨得出引擎這一次到底用了哪一套規則。

### 沒有涵蓋到的

- 離線上限（4 小時）截斷、時鐘倒退：屬於引擎層的邊界，`tests/acceptance` 已有黑箱案例
  （C1–C5），這裡不重複。
- 里程碑倍率（Lv25／50／100）：同樣由 `tests/acceptance` 涵蓋（B2、B3）。
- 數字格式（F1–F5）：由 `tests/unit/money.test.ts` 涵蓋；這裡只用 `formatMoney` 產生
  期望值，不重測格式規則本身。

---

## 3. 建議放進 GDD §9 的文字（給 DeepSeek41）

`docs/GDD.md` 第 401 行目前是：

```
| G1–G8 | E2E | 依 `src/ui/testids.md`，金額一律 `formatMoney` |
```

建議改成：

```
| G1–G10 | 玩法 E2E | 依 `src/ui/testids.md`，金額一律 `formatMoney`；案例定義見 `tests/e2e/README.md`：G1 開局畫面、G2 開賣入帳、G3 升級、G4 雇店員、G5 解鎖、G6 解鎖鏈、G7 動作後存檔重載、G8 離線收益彈窗、G9 前景定期存檔、G10 前景長空檔改用離線規則 |
```
