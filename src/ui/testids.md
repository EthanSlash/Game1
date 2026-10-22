# data-testid 命名表（M2）

M2 UI 全部互動元素使用 `data-testid`，命名與 `src/core/api.ts` 契約的 `StallOps.id` 同源。
MiniMax31 的 E2E 一律以 testid 定位（既有 smoke 測試依賴的 3 個 class 除外，見尾節）。

| testid | 元素 | 出現條件／狀態 | 備註 |
|---|---|---|---|
| `balance` | 頂欄金額 | 恆常 | 文字一律走 `src/core/formatMoney` |
| `income-per-sec` | 頂欄每秒收益 | 恆常 | 同上 |
| `stall-<id>` | 攤位卡容器 | 恆常 | 鎖住時另加 `data-locked="true"` |
| `name-<id>` | 攤位名稱 | 恆常 | |
| `level-<id>` | 等級顯示 `Lv.N` | 解鎖後 | |
| `income-stall-<id>` | 該攤每秒收益 | 解鎖後 | |
| `progress-<id>` | 里程碑進度條 | 解鎖後 | 相對下一個 25/50/100 |
| `upgrade-<id>` | 升級鈕 | 解鎖後 | 錢不夠 → disabled，仍顯示成本 |
| `hire-<id>` | 雇店員鈕 | 解鎖後、未雇用（每攤一位） | 已雇用 → 隱藏或顯示已雇狀態 |
| `unlock-<id>` | 解鎖鈕 | 鎖住時 | 錢不夠 → disabled |
| `sell-<id>` | 開賣鈕 | 解鎖後 | 語意待 GDD（契約 `toggleSell`） |
| `offline-modal` | 離線收益彈窗容器 | 收益 > 0 才顯示（含冷啟動）；收益 0 不跳 | 靜態骨架期永遠 `hidden` |
| `offline-amount` | 離線實得金額 | 彈窗內 | 只顯示 engine 結果，UI 不重算 |
| `offline-duration` | 離線計入時長 | 彈窗內 | 已套上限的秒數 |
| `offline-cap-hint` | 「已達 4 小時上限」提示 | `capped = true` 才顯示 | 上限值以 GDD 為準 |
| `offline-close` | 彈窗關閉鈕 | 彈窗內 | |

`<id>` 一律使用攤位英文 id（如 `chicken-steak`），kebab-case，與 `PLACEHOLDER_SNAPSHOT.stalls[].id` 一致。

## smoke 測試依賴的 class（保留不動）

MiniMax31 既有 `tests/e2e/smoke.spec.ts` 依賴下列 M0 選擇器；M2 改版時保留，不新選中它們以外的新 class 定位：

- `.top__balance`（文字須正好 `1.23萬`：假資料餘額 12345）
- `.stall`（數量 5）
- `.stall--locked`（數量 3）
