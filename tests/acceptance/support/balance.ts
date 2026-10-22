/**
 * 讀取「規格檔」：`data/balance.json` 與 `docs/GDD.md`。
 *
 * 驗收的數值一律來自 `data/balance.json`（AGENTS.md 硬規則 2：程式不得寫死數值），
 * 這裡用 `readFileSync` 在執行期讀，不依賴 `tsconfig` 的 `resolveJsonModule`，
 * 這樣即使 GDD PR 的 tsconfig 那一行被挪到別的 PR，驗收也不會編譯失敗。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BalanceConfig } from './types';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `tests/acceptance/support` → repo 根目錄。 */
export const REPO_ROOT = resolve(HERE, '..', '..', '..');
export const BALANCE_PATH = resolve(REPO_ROOT, 'data', 'balance.json');
export const GDD_PATH = resolve(REPO_ROOT, 'docs', 'GDD.md');

function parseBalance(): BalanceConfig {
  if (!existsSync(BALANCE_PATH)) {
    throw new Error(`找不到 ${BALANCE_PATH}：驗收需要 GDD 的數值來源（data/balance.json）`);
  }
  const parsed: unknown = JSON.parse(readFileSync(BALANCE_PATH, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('data/balance.json 的內容不是物件');
  }
  return parsed as BalanceConfig;
}

/** `data/balance.json` 的內容（驗收與 oracle 共用同一份數值來源）。 */
export const BALANCE: BalanceConfig = parseBalance();

/** 依 id 找攤位設定；找不到就拋錯（測試寫錯 id 時要立刻看到）。 */
export function stallDef(config: BalanceConfig, id: string) {
  const found = config.stalls.find((s) => s.id === id);
  if (!found) throw new Error(`balance.json 沒有 id = ${id} 的攤位`);
  return found;
}

/** `docs/GDD.md` 全文（規格一致性測試用）。 */
export function readGdd(): string {
  if (!existsSync(GDD_PATH)) {
    throw new Error(`找不到 ${GDD_PATH}：驗收需要 GDD（docs/GDD.md）`);
  }
  return readFileSync(GDD_PATH, 'utf8');
}
