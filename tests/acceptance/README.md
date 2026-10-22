# tests/acceptance — 黑箱驗收

這裡的測試由 **MiniMax31** 維護：只照 `docs/GDD.md` v1.1 的公式與規則寫，**不看 `src/core` 的實作**。

## 規則

- 期望值必須寫成「GDD 公式算出來的數字」，不要在測試裡重算實作邏輯。
- 數值只來自 `data/balance.json`（AGENTS.md 硬規則 2），測試裡不寫死遊戲數值。
- 不為了讓測試通過而改期望值；先確認是 GDD 寫錯還是實作錯，再回報給該工單負責人。
- **實作者不驗收自己的成果**（AGENTS.md 硬規則 5）。這份測試是 M1（DeepSeek41）的對面。

## 兩層期望值

驗收測試的期望值有兩個**互相獨立**的來源：

1. **字面值** —— 直接算出來、寫死在測試檔裡的數字（例如雞排 Lv1→Lv2 成本 `10`、Lv25 收益 `19.69946535161526`）。
2. **oracle**（`support/oracle.ts`）—— 依 GDD 公式實作的期望值產生器。

`spec-consistency.test.ts` 專門檢查這兩層彼此一致。只有兩邊都對，驗收才有意義 ——
只有 oracle 對、字面值不對，代表 oracle 跟規格**都**理解錯了。

## 型別來源（單一真相）

`support/types.ts` **直接 re-export `src/core/api.ts`**（`export type *`，零執行期依賴）。

- 契約 PR（`3458165`）已 merge 進 `main`，`src/core/api.ts` 是唯一的介面定義。
- 手抄一份等於在 repo 裡放第二份定義，介面一改就會漂移 → 驗收開始測「自己的假設」而不是實作的行為，那是假綠。
- 漂移現在由 **TypeScript 編譯期**（`tsc --noEmit`）直接擋下。

## 目錄

| 檔案 | 內容 |
|---|---|
| `support/types.ts` | re-export `src/core/api.ts` 的全部型別 |
| `support/balance.ts` | 讀 `data/balance.json` 與 `docs/GDD.md`；依 id 找攤位設定 |
| `support/oracle.ts` | GDD 公式 oracle：里程碑倍率、每秒收益、升級成本、結算期望值、里程碑進度、浮點容差 |
| `support/fixtures.ts` | 狀態建構輔助：能用公開 API 走出來的就不要手刻 |
| `support/harness.ts` | **執行期**尋找 M1 的 `createCore` / `createGameEngine` |
| `economy.test.ts` | A1–A7 購買／解鎖／雇用、B1–B5 收益公式與里程碑 |
| `offline.test.ts` | C1–C5 離線：0 秒／剛好上限／超限截斷／時鐘倒退／冪等 |
| `longgap.test.ts` | C6–C7 前景長空檔自動轉離線（GDD v1.1 §4.6） |
| `save.test.ts` | D1–D5 存檔：還原、損毀、缺欄位、v0 遷移、未知版本 |
| `tick.test.ts` | E0–E2 水位線、冪等、背景回來不重複計算 |
| `engine.test.ts` | 門面層（UI 視角）：冷啟動、動作失敗回 `false`、`can*` 旗標、`save` |
| `format.test.ts` | F1–F5 數字格式（9999 / 1萬 / 1億 / 1兆） |
| `spec-consistency.test.ts` | 字面值 ↔ oracle ↔ `balance.json` 三方交叉檢查（**不依賴 M1**） |
| `harness.test.ts` | 驗收環境自檢 + 契約方法齊全性（**不依賴 M1**） |

## 為什麼 M1 沒交也能綠

驗收檔在**執行期**從 `src/core` 底下動態尋找 `createCore` / `createGameEngine`
（`import.meta.glob`），找不到就把整個 `describe` 標成 `skip`：

- 找不到 → `npm test` 維持綠燈，其他 agent 的分支不會被驗收測試擋住；
- 找得到 → 驗收檔**自動開跑**，不用改測試。

這是刻意的：**「等待中」要是可見、可驗證的狀態**，而不是整個檔案不見。

不過 `src/core` 的**型別**是例外 —— 那部分本來就該在編譯期綁死（見「型別來源」）。

## M1 交付後

1. 把 M1 的分支 merge 進 `qa/acceptance`。
2. `npm test` 會自動解除 skip，開始跑黑箱驗收。
3. 對不上 GDD 的數值 → 開 issue 指給該模組負責人，結果回報在 M1 PR 的討論串。

## 還沒寫的案例

- 舊版存檔的**跨版本**遷移鏈（目前只驗 v0 → v1）。
- `tools/sim`（GDD §10 情境模擬）的數值交叉驗證 —— 那支 PR 還沒開。
- e2e（Playwright）的存檔時機骨架在 `tests/e2e/support/save.ts`，尚未接 spec。
