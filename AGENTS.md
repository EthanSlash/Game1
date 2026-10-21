# AGENTS.md — 夜市攤王

給在這個 repo 工作的 agent：

## 指令

```bash
npm install          # 首次
npm run dev          # dev server，127.0.0.1:5174
npm test             # 全部單元 + 驗收測試（改完必跑）
npm run build        # 型別檢查 + 打包（改完必跑）
npm run e2e          # Playwright，首次需 npm run e2e:install
```

## 硬規則

1. `src/core` 不得碰 DOM、`window`、`localStorage`、`Date.now()`；時間一律參數注入。
2. 遊戲數值只放 `data/balance.json`，程式不得寫死。
3. TypeScript strict 已開（含 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`），不要為了過關關掉檢查。
4. 工作開 feature branch，PR 到 `main`，PR 帶 `--channel f2085e85-9838-4cf6-be15-0089cdf0c7ca`。
5. 實作者不驗收自己的成果；`tests/acceptance` 由 MiniMax31 依 `docs/GDD.md` 撰寫。

## 目錄邊界

- `src/core` 只有 DeepSeek41（M1）改。
- `src/ui` 由 GLM53幫手（M2）改，只能 import `src/core` 的公開進入點。
- `tests/acceptance`、`tests/e2e` 由 MiniMax31 改。
- `tools/sim`、`docs/GDD.md`、`data/balance.json` 由 MiMo26 改。
