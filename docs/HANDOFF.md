# 《夜市攤王》交接文件（HANDOFF）

- 產出時間：2026-10-23（台北時間上午）
- 打包者：DeepSeek41（受 怪獸8號 指派）
- 打包基準：`origin/main` @ `d282a22931b469237346b2082832ef060813b582`（短碼 `d282a22`）
- 目的：讓 Ethan 在家用電腦接手開發，或在另一個 Buzz 環境重建專案

---

## 0. 這個資料夾有什麼

| 檔案 | 大小 | 內容 |
|---|---|---|
| `night-market-king.bundle` | 1.73 MB | 完整 git bundle，含 **17 個分支**與全部 49 個 commit。可離線 clone 還原整段歷史，不需要連線或 Nostr 憑證 |
| `night-market-king-src.zip` | 1.63 MB | 只有 `main` 的程式碼（`git archive` 產物），**不含** `.git`、`node_modules`、`dist`、`test-results`。解壓後 `npm ci` 就能跑 |
| `HANDOFF.md` | 本文件 | 進度、規則、環境需求、還原步驟 |

想看歷史或開分支 → 用 bundle。只想快速看程式碼或試跑 → 用 zip。

---

## 1. Repo 概況

| 項目 | 內容 |
|---|---|
| 專案名稱 | 夜市攤王（`night-market-king`） |
| 類型 | 台灣夜市經營放置遊戲，手機優先 PWA |
| 技術 | TypeScript（strict）+ Vite 8 + Vitest 5 + Playwright 1.64.1 |
| 架構 | `src/core`（純邏輯，不碰 DOM）／`src/ui`（畫面）分離；數值集中在 `data/balance.json` |
| Buzz repo 擁有者 | `9faf50c0d34156eb1a2d750216e5dbab447370ef939fc70d1c5d6d2b83c2c356`（怪獸8號） |
| 所屬頻道 | PJ（`f2085e85-9838-4cf6-be15-0089cdf0c7ca`） |
| Clone URL | `https://ethanhiker.communities.buzz.xyz/git/9faf50c0d34156eb1a2d750216e5dbab447370ef939fc70d1c5d6d2b83c2c356/night-market-king` |

> 注意：程式碼放在 Buzz 自建的 git（relay：`ethanhiker.communities.buzz.xyz`），不在 GitHub。
> 直接 `git clone` 這個 URL 需要 Nostr 身分驗證（本機 agent 是靠 Buzz 的 credential helper）。
> 在家如果只讀不推，用 bundle；要推回去就得先搞定憑證。

---

## 2. 目錄結構（`main`）

```
night-market-king/
├─ AGENTS.md              # repo 內的 agent 規則（角色邊界、硬規則）— 先讀這份
├─ README.md              # 專案說明與快速開始
├─ data/balance.json      # 唯一數值來源（程式不得寫死數值）
├─ docs/
│  ├─ GDD.md              # 遊戲設計文件，唯一規格來源（目前版本欄位 1.4）
│  ├─ LAN_PREVIEW.md      # 區網手機預覽（含防火牆規則）
│  └─ screenshots/        # UX 修正前後對照（ux-polish-1 / ux-polish-2）
├─ src/
│  ├─ core/               # 經濟引擎、離線收益、存檔、金額格式
│  │  ├─ api.ts           # 公開契約：NightMarketCore / GameEngine
│  │  ├─ API_CONTRACT.md  # 契約說明
│  │  ├─ core.ts / engine.ts / money.ts / save.ts / time.ts / index.ts
│  ├─ ui/                 # 畫面與互動
│  │  ├─ app.ts / main.ts / store.ts / styles.css
│  │  └─ testids.md       # data-testid 命名表（E2E 的唯一定位依據）
├─ tests/
│  ├─ unit/               # 92 個單元測試（core / engine / money / save）
│  ├─ acceptance/         # 黑箱驗收（依 GDD 寫，不看實作）
│  └─ e2e/                # Playwright：smoke + gameplay（G1–G10）
│     └─ README.md        # 假時鐘用法、格線對齊、G1–G10 定義
├─ tools/sim/run.ts       # 平衡模擬
└─ playwright.config.ts   # 兩個 project：iphone-13（WebKit）、pixel-7（Chromium）
```

---

## 3. 目前 `main` 的狀態

```
d282a22  Merge branch 'main' (418bbce) into ux/action-hints
```

- `main` = `d282a22931b469237346b2082832ef060813b582`
- 分支總數 17（`main`、`ux/action-hints`、`ux/demo-polish`、`qa/*`、`feat/*`、`m2/*`、`docs/gdd-balance`）
- commit 總數 49
- 沒有 tag、沒有 CI 設定（驗證靠人工在 PR 上跑）

**已合併的分支**（可視為完成）：`docs/gdd-balance`、`feat/m1-core-api-contract`、`feat/m1-core-engine`、`feat/m1-tools-sim`、`m2/ui-main-screen`、`m2/ui-real-engine`、`feat/lan-preview`、`qa/gameplay-e2e`、`feat/gdd-v1.3-json-import`、`feat/core-action-hints`、`ux/demo-polish`、`ux/action-hints`、`qa/webkit-e2e`。

---

## 4. 已完成的里程碑

| 里程碑 | 內容 | 代表 commit |
|---|---|---|
| M0 專案骨架 | Vite + TypeScript、core/ui 分離、`data/balance.json`、GDD v1.0 | 早期歷史 |
| GDD v1.1 + 數值表 | `data/balance.json` 與 GDD 對齊 | `dc3fbe6` |
| M1 core engine | 經濟引擎、離線收益、存檔、時間注入 | `c83d376`（`26c7777`） |
| core 公開 API 契約 | `NightMarketCore` / `GameEngine` / `Snapshot` 定案 | `3458165` |
| M2 主畫面 | UI 接上 GameEngine 契約 | `1348309` |
| M2 後續 | UI 全面改讀真引擎（移除假資料） | `ce45aa4` |
| GDD v1.2 + 平衡模擬 | 三個規格空白補齊、可重現的模擬曲線 | `694bfc3`（`822a5e7`） |
| 玩法 E2E G1–G10 | 13 支 Playwright 測試（假時鐘，金額由 balance.json 推算） | `edf0ba3` |
| 區網手機預覽 | `npm run preview:lan` + 防火牆說明 | `5ac639d` |
| GDD v1.3 §9 | G1–G10 寫進 GDD、JSON import attribute、e2e 改從公開進入點取 `formatMoney` | `50aaf89` |
| core 擴充 | `Snapshot.shortfall`、`Snapshot.incomePerSecIfHired` | `2f899ac`（`28bffe0`） |
| UX 第 1 批 | 結構只建一次、開局引導、營業狀態、動作回饋、觸控對比 | 分支 tip `4b77d1a`（關鍵 commit `cef1e73`），併進 `main` 於 `2f899ac` |
| UX 第 2 批 | 「還差 X」、雇用收益預覽、`pop-num` 修正、`prefers-reduced-motion` | `d282a22`（分支 tip `dd72ed8`） |
| WebKit 釐清 | 確認 `iphone-13` project 本來就是 WebKit，只更新 README | `418bbce` |

---

## 5. 待辦與未決事項

| # | 項目 | 狀態／說明 |
|---|---|---|
| 1 | **Android 打包評估** | PG克勞德 評估中，**結果還沒貼出來**；在家開工前若想要可安裝版本，這是唯一卡點 |
| 2 | **G6 E2E flaky** | UX 第 2 批驗證時出現過一次 G6（解鎖鏈），重試後過、單跑 2/2、全套重跑 26 passed。判斷不是該分支的問題但未定案。**再出現一次就開 QA 單查** |
| 3 | **MiniMax31 額度用完** | 它的 OpenCode 免費額度用完，QA 工作（`tests/acceptance`、`tests/e2e`）已改由 DeepSeek41 接手。在家重建 agent 時，QA 角色要有人接 |
| 4 | **共用 checkout 有一筆被放棄的 WebKit 設定修改沒清掉** | `REPOS/night-market-king` 工作目錄的 `playwright.config.ts` 有一筆未 commit 的修改（多一個 `webkit-ios` project）。已確認不需要，但沒人清。**它不在 bundle／zip 裡**（兩者都從 git 物件產生） |
| 5 | `public/` 圖示 | 只有 SVG，正式上架前要補 192/512 PNG（README 列的 M2 待辦） |
| 6 | Service Worker / 離線快取 | 未實作（README 列的 M2 待辦）。`public/manifest.webmanifest` 已存在、`index.html` 也有掛 manifest 與 `theme-color`，smoke 測試在驗 manifest，所以 PWA 只差 SW 與圖示 |
| 7 | 文件與實作落差 | `README.md` 第 5 行仍寫「狀態：M0 專案骨架，畫面目前是假資料」，實際上 M1／M2 都已完成，UI 已接真引擎；`docs/GDD.md` 第 1 行標題仍寫 `v1.0`，但版本欄位是 1.4。**內容以版本欄位與程式為準**，只是標題沒更新 |
| 8 | 沒有 CI | 所有驗證都是 agent 在本機跑。若在家要接 GitHub Actions，要另外建 |

---

## 6. 團隊工作規則（照做就不會踩雷）

1. **一個 agent 一個 worktree**：`C:\Users\p10444709\.buzz\REPOS\night-market-king-*`。不要直接在共用 checkout 改東西、不要 commit 別人的未提交變更。
2. **一律開 feature branch**，PR 目標 `main`；開 PR 時帶 `--channel f2085e85-9838-4cf6-be15-0089cdf0c7ca`。
3. **Merge 流程**（固定三步，順序不能換）：
   ```bash
   git merge --no-ff origin/main        # 先把最新的 main 併進自己的分支
   CI=1 npm run e2e                     # 在 merge 結果上跑，要 26 passed
   # 全綠才 merge PR，然後標記：
   buzz pr status merged --merge-commit <merge-commit-sha>
   ```
   `CI=1` 會讓 Playwright 開 `forbidOnly`、retry 2 次、輸出 list + html reporter。
4. **不 force-push**，不改寫已推上去的歷史。
5. **`src/ui/testids.md` 是 testid 唯一登記表**：新增或改 `data-testid` 要同步更新該檔；E2E 一律用 testid 定位（唯一例外是 `smoke.spec.ts` 依賴的 3 個 M0 class，保留、不要改也不要刪）。
6. **實作者不驗收自己的成果**，驗收由別人簽。
7. **`src/core` 硬規則**：不得碰 DOM／`window`／`localStorage`／`Date.now()`；時間一律參數注入（`tick(state, nowMs)`）。
8. **數值只放 `data/balance.json`**，程式不得寫死。
9. **TypeScript strict 已開**（含 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`），不要為了過關關掉檢查。
10. **角色邊界**（詳見 repo 的 `AGENTS.md`）：`src/core` = DeepSeek41、`src/ui` = GLM53幫手、`tests/acceptance` + `tests/e2e` = QA（原 MiniMax31，現 DeepSeek41）、`tools/sim` + `docs/GDD.md` + `data/balance.json` = 文件／數值負責人（原 MiMo26，現在 GDD 擁有者是 DeepSeek41）。
11. **縮小範圍**：一次只動自己負責的目錄；要跨目錄先講，避免同一支 PR 夾帶別人的東西。

---

## 7. 環境需求

| 項目 | 需求 | 本機實測值 |
|---|---|---|
| Node.js | Vite 8 要求 `^20.19.0 \|\| >=22.12.0`（`package.json` 沒有 `engines` 欄位） | v24.18.0 |
| npm | 能用 `npm ci`（讀 `package-lock.json`） | 11.16.0 |
| TypeScript / Vite / Vitest | 由 `npm ci` 安裝 | 7.0.2 / 8.3.5 / 5.0.5 |
| Playwright | 1.64.1（`npm ci` 安裝） | 1.64.1 |
| Playwright 瀏覽器 | **chromium 與 webkit 都要**（`iphone-13` project 是 WebKit、`pixel-7` 是 Chromium） | 已安裝 `chromium-1248`、`webkit-2370`；快取目錄實測佔 887.6 MB，其中 chromium 714 MB、webkit 170 MB |

- 只跑 `npm test` / `npm run build` **不需要**瀏覽器。
- 第一次要跑 E2E：`npx playwright install chromium webkit`（或用 repo 的 `npm run e2e:install`，那一支只裝 chromium）。
- 下載量：本機是用現有快取跑的，**沒有重新下載，所以沒有實測下載大小**；上面的 887.6 MB 是安裝後佔用的磁碟空間。

---

## 8. 從 bundle 還原（含完整歷史）

```bash
# 1. 還原（不需要連線、不需要憑證）
git clone night-market-king.bundle night-market-king
cd night-market-king

# 2. clone 可能停在別的 branch（bundle 的 HEAD 是一個 commit，而 main 與 ux/action-hints 指向同一個 commit）
git checkout main
git rev-parse HEAD     # 必須是 d282a22931b469237346b2082832ef060813b582

# 3. 看得到所有分支（remote 形式）
git branch -r

# 4. 裝套件並驗證
npm ci
npm test               # 應為 92 passed
npm run build          # tsc --noEmit + vite build

# 5. 要跑 E2E 才需要
npx playwright install chromium webkit
CI=1 npm run e2e       # 應為 26 passed（13 支 × 2 project）
```

如果你想接回 Buzz 的 relay 繼續推（需要 Nostr 憑證）：

```bash
git remote remove origin
git remote add origin https://ethanhiker.communities.buzz.xyz/git/9faf50c0d34156eb1a2d750216e5dbab447370ef939fc70d1c5d6d2b83c2c356/night-market-king
git fetch origin
```

> 憑證這件事我（打包者）**沒有在家用電腦實測過**。如果家裡的 Buzz 跟公司是同一個 community、同一個帳號，Buzz Desktop 可能已經幫你處理好；沒有的話要自己設 Nostr 認證，不要假設它會通。

---

## 9. 從 zip 還原（只有 `main` 的程式碼）

```bash
# 解壓後會多一層 night-market-king/
npm ci
npm test
npm run build
```

注意 zip 是 `git archive` 產物，**沒有 `.git`**，所以沒有歷史、不能開分支。要長期開發請用 bundle。

---

## 10. 這次打包做了哪些驗證

全部在乾淨環境做（從 relay 重新 fetch 到 `.scratch` 的 bare repo，不碰共用工作目錄、不碰那筆未提交的 `playwright.config.ts`）：

| 驗證 | 結果 |
|---|---|
| `git bundle verify` | `The bundle records a complete history.` / `is okay` |
| 從 bundle `git clone` | HEAD = `d282a22931b469237346b2082832ef060813b582`，工作目錄乾淨，17 個分支都在 |
| 從 bundle clone 出來的 `playwright.config.ts` | 只有 `iphone-13` / `pixel-7` 兩個 project（沒有 `webkit-ios`，確認那筆未提交修改沒被帶進去） |
| zip 內容檢查 | 67 個項目、51 個檔案；無 `node_modules` / `dist` / `test-results` / `.git` |
| 解壓後 `npm ci` | 57 packages，0 vulnerabilities |
| 解壓後 `npm test` | **92 passed**（4 test files） |
| 解壓後 `npm run build` | **OK**（`dist/assets/index-*.js` 21.36 kB / gzip 7.41 kB） |
| 解壓後 `npm run test:coverage` | `src/core` 語句 98.29%、分支 95.79%、函式 100%、行 100%（門檻 90% 通過） |
| 解壓後 `CI=1 npm run e2e` | **26 passed**（38.0s，13 支 × 2 project） |

檔案校驗（SHA256，複製到家裡後可比對）：

```
414FC0CA1C5EFBD4C1558572D8658E16D74FC0E1A8465AB3E6A1E5826A7DF535  night-market-king.bundle   (1,817,346 bytes)
72314BE9D48C5602329E4FBF3563AF8B1131DCB74BB4A4E6396851B5BD2F24CC  night-market-king-src.zip  (1,709,187 bytes)
```

（本文件不列自己的雜湊，因為寫進去就會變。）

驗證指令（Windows）：

```powershell
Get-FileHash night-market-king.bundle -Algorithm SHA256
```

---

## 11. 交接前要決定的兩件事

1. **家裡的 Buzz 跟公司是同一個 community（`ethanhiker.communities.buzz.xyz`）嗎？**
   - 同一個 → 頻道、repo、PR 在家都看得到，bundle 只是備份。
   - 不同個 → 頻道歷史與 PR 不會跟過去，要在家新建 repo 再 push bundle 上去。
2. **公司這台電腦要繼續開機**：所有 agent 都跑在 `p10444709` 上。關機、休眠或 Buzz 關掉，agent 就不會回應。在家要開發就得在家裡的 Buzz 另外建 agent（角色分工見上一節第 10 條與 repo 的 `AGENTS.md`）。
