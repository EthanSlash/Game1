# 夜市攤王 (night-market-king)

台灣夜市經營放置遊戲（手機優先 PWA）。TypeScript + Vite，core（純邏輯）與 ui 分離，數值放 `data/balance.json`。

狀態：**M0 專案骨架**。畫面目前是假資料，沒有任何玩法邏輯。

## 快速開始

```bash
npm install
npm run dev          # http://127.0.0.1:5174
npm test             # Vitest：單元測試 + 黑箱驗收
npm run test:coverage  # 只算 src/core，門檻 90%（M1 起適用）
npm run e2e          # Playwright（iPhone 13 / Pixel 7）
npm run build        # tsc --noEmit + vite build
npm run sim          # 平衡模擬（佔位）
```

第一次跑 E2E 前需要安裝瀏覽器：

```bash
npm run e2e:install
```

## 目錄

| 路徑 | 內容 | 誰負責 |
|---|---|---|
| `src/core/` | 純邏輯：經濟引擎、離線收益、存檔。**禁止** DOM / `window` / `localStorage` / `Date.now()` | DeepSeek41 (M1) |
| `src/ui/` | 畫面與互動，只透過 `src/core` 公開 API 取資料 | GLM53幫手 (M2) |
| `tests/unit/` | 單元測試，與被測程式碼同進 | 開發者本人 |
| `tests/acceptance/` | 黑箱驗收，只照 `docs/GDD.md` 寫，不看實作 | MiniMax31 |
| `tests/e2e/` | Playwright，手機尺寸 | MiniMax31 |
| `tools/sim/` | 平衡模擬曲線 | MiMo26 |
| `data/balance.json` | 所有數值，程式不得寫死 | MiMo26 (M0 規格) |
| `docs/GDD.md` | 遊戲設計文件，公式與目標曲線 | MiMo26 (M0 規格) |

## 開發規則

- 分支：一律開 feature branch，PR 目標 `main`，PR 帶 `--channel f2085e85-9838-4cf6-be15-0089cdf0c7ca`。
- 時間：core 內所有時間由參數注入（`tick(state, nowMs)`），方便測試與防作弊。
- 數值：新增或調整數值只改 `data/balance.json`，不要寫進程式碼。
- 覆蓋率：`src/core` ≥ 90%，`npm run test:coverage` 會擋。
- 不能自己驗收自己的東西：實作者不簽自己的驗收。

## 已知待辦（M0 之後）

- `public/` 目前只有 SVG 圖示，正式上架前要補 192/512 PNG（M2）。
- Service Worker / 離線快取尚未實作（M2）。
- `src/core/index.ts` 的 `Snapshot` / `PLACEHOLDER_SNAPSHOT` 是骨架期假資料，M1 接上引擎後刪除。
