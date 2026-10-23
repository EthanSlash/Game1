# data-testid 命名表（M2）

M2 UI 全部互動元素使用 `data-testid`，命名與攤位英文 id 同源（契約 `StallSnapshot.id`，
`data/balance.json` 的 `stalls[].id`，kebab-case）。MiniMax31 的 E2E 一律以 testid 定位
（既有 smoke 測試依賴的 3 個 class 除外，見尾節）。

按鈕一律以**快照的 `can*` 欄位**決定 disabled，與 `formatMoney` 金額文字並列顯示成本；
動作以 `data-action`（`upgrade` / `hire` / `unlock` / `toggleSell` / `close-modal`）+
`data-stall` 屬性觸發（E2E 不需要知道這兩個屬性，照 testid 點擊即可）。

| testid | 元素 | 出現條件／狀態 | 備註 |
|---|---|---|---|
| `balance` | 頂欄金額 | 恆常 | 文字一律走 `src/core/formatMoney` |
| `income-per-sec` | 頂欄每秒收益 | 恆常 | 前景速率（GDD §4.3），同上 |
| `stall-<id>` | 攤位卡容器 | 恆常 | 鎖住時另加 `data-locked="true"` |
| `name-<id>` | 攤位名稱 | 恆常 | |
| `status-<id>` | 營業狀態標籤（營業中／休息中／店員顧攤中） | 解鎖後 | 另有 `data-state`（`selling`／`idle`／`clerk`）供樣式上色；鎖住卡沿用「尚未解鎖」（無 testid） |
| `level-<id>` | 等級顯示 `Lv.N` | 解鎖後 | |
| `income-stall-<id>` | 該攤每秒收益 | 解鎖後 | `+0/秒` 未開賣且無店員時也顯示（GDD §5.1） |
| `progress-<id>` | 里程碑進度條 | 解鎖後 | 依快照 `nextMilestone.progress`（Lv25 後歸 0 往 50 算）；`nextMilestone = null` 時滿格 |
| `progress-label-<id>` | 里程碑標籤 `→ Lv25 收益 ×2` | 解鎖後、`nextMilestone != null` | 數值直接讀 `snapshot.nextMilestone`，`null` 時隱藏 |
| `upgrade-<id>` | 升級鈕 | 解鎖後 | 文案 `升級 <成本>`；達上限後改「已達上限」、`upgradeCost = null` |
| `hire-<id>` | 雇店員鈕 | 解鎖後、`!clerkHired` | 文案 `雇店員 <成本>`；雇用後**隱藏**（每攤一位） |
| `hire-hint-<id>` | 雇店員說明小字（`hire-<id>` 下方） | 解鎖後、`!clerkHired` | 固定文案「雇店員後自動營業、離線也會賺，開賣鈕會移除」；後接「，雇用後 +X/秒」（讀快照 `incomePerSecIfHired`，`null` 時不顯示該段） |
| `shortfall-unlock-<id>` | 解鎖鈕下方的還差金額 | `shortfall.unlock > 0` | 文案 `還差 X`（同 `formatMoney`，UX #3）；`0`（錢夠）或 `null`（鏈上前提未滿）時 hidden |
| `shortfall-upgrade-<id>` | 升級鈕下方的還差金額 | `shortfall.upgrade > 0` | 同上；`null` 含「未解鎖／已達上限」 |
| `shortfall-hire-<id>` | 雇店員鈕下方的還差金額 | `shortfall.hire > 0` | 同上；`null` 含「未解鎖／已雇用」；已雇用的卡不含此元素 |
| `unlock-<id>` | 解鎖鈕 | 鎖住時 | 文案 `解鎖 <成本>`；錢不夠或鏈上前提未滿 → disabled；`canUnlock = true` 時加 `btn--ready` 強調 |
| `sell-<id>` | 開賣／收攤鈕 | 解鎖後、`!clerkHired` | 文案依 `selling`：`開賣` / `收攤`；雇用店員後**隱藏**（`canToggleSell = false`，GDD §5）；開局引導成立時加 `btn--glow` 發光 |
| `onboarding-hint` | 開局引導提示行（頂欄下方） | `balance === 0` 且無任何攤位開賣、無店員 | 文案「按『開賣』開始賺錢」；條件不成立自動隱藏 |
| `offline-modal` | 離線收益彈窗容器 | 引擎 `frame.offline` 有值才顯示（冷啟動 `init`、`onVisible`、長空檔 `tick`；GDD §6） | `gained = 0`（含 0 秒、時鐘倒退）不跳 |
| `offline-amount` | 離線實得金額 | 彈窗內 | 只顯示引擎結算值，UI 不重算 |
| `offline-duration` | 離線計入時長 | 彈窗內 | 已套上限的 `creditedMs` |
| `offline-cap-hint` | 「離線最多累積 4 小時，記得回來收錢」提示 | `capped = true` 才顯示 | 小時數由 `balance.json` 的 `offline.capSeconds` 組出（UX 審查 #12 改寫） |
| `offline-close` | 彈窗關閉鈕 | 彈窗內 | 關閉後不重複彈同一筆 |

## smoke 測試依賴的 class（相容用，M0 遺留）

MiniMax31 既有 `tests/e2e/smoke.spec.ts` 依賴下列 M0 選擇器；保留**僅供相容**（MiniMax31 提案，2026-10-22 核准沿用）——`src/ui` 渲染這些 class 只是為了不讓 smoke 改版，不算公開樣式契約：

- `.top__balance`（相容用；文字為實際餘額 `startingBalance = 0` → `0`）
- `.stall`（相容用；數量 5）
- `.stall--locked`（相容用；開局第一攤解鎖 → 數量 4）

> **新測試（含改寫 smoke）一律走上表 `data-testid`，不要新增任何 class 依賴**；這三個 M0 class 未來可在 smoke 改用 testid 後移除。
