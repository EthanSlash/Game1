/**
 * 驗收用的型別入口 —— **直接 re-export `src/core/api.ts`**（契約定案版，2026-10-22）。
 *
 * 為什麼不再手抄一份：
 * 1. 契約 PR（`3458165`）已經 merge 進 `main`，`src/core/api.ts` 就是唯一的介面定義。
 *    手抄等於在 repo 裡放第二份定義，介面一改就會漂移 —— 驗收測試會開始
 *    測「自己的假設」而不是「實作的行為」，那是假綠。
 * 2. 型別漂移現在由 **TypeScript 編譯期**直接擋下（`tsc --noEmit`），
 *    比先前「執行期比對欄位」更早、更嚴格。
 *
 * 這支檔案存在的理由只剩兩個：
 * - 給驗收測試一個**穩定的匯入路徑**（`./types`），不必每個檔案都寫相對路徑。
 * - 集中記錄「驗收層與契約層的關係」，讓後人知道型別的唯一來源在哪。
 *
 * ⚠️ 這裡 re-export 的**全部是型別**（`export type *`），執行期不會產生任何
 * import；所以驗收測試對 `src/core` 的實作依然零依賴（黑箱驗收）。
 *
 * 對照來源：`docs/GDD.md` v1.1 與 `src/core/api.ts`。
 */

/**
 * 契約的全部型別。包含：
 * - 純函式層：`NightMarketCore`、`GameState`、`BalanceConfig`、`SettleResult` …
 * - 門面層：`GameEngine`、`EngineFrame`、`OfflineSettlement`、`LoadFailureReason` …
 * - 別名：`StallId`、`TimestampMs`、`SaveVersion`
 */
export type * from '../../../src/core/api';
