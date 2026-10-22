import type { Page } from '@playwright/test';

import { BALANCE } from '../../acceptance/support/balance';
import { initialStallStates } from '../../acceptance/support/fixtures';
import type {
  GameState,
  SaveEnvelope,
  StallId,
  StallState,
} from '../../../src/core/api';

/**
 * E2E 用的存檔輔助。
 *
 * GDD §8.1 凍結了存檔形狀（`{version, savedAt, state}`），但**沒指定 localStorage 的 key 名稱**
 * （GDD §6.1：「key 名稱由 UI 決定」）。所以這裡不寫死 key，而是**從頁面上找出來**：
 * 掃 localStorage，找值是合法存檔信封的那一格。
 *
 * 這樣 E2E 不會綁死 M2 的實作選擇，卻仍然能用「改存檔 → 重載」測出線性的行為
 * （G6 離線彈窗、G7 重載保留進度、G8 數字格式）。
 *
 * ⚠️ 存檔形狀**不在這裡手抄** —— 直接用 `src/core/api.ts` 的契約型別
 * （`SaveEnvelope` / `GameState` / `StallState`）。攤位清單也從 `data/balance.json`
 * 讀，不寫死（AGENTS.md 硬規則 2：程式不得寫死遊戲數值）。
 */

export type { GameState, SaveEnvelope, StallId, StallState };

/** MVP 五個攤位（順序 = 解鎖順序，GDD §2、§13）。 */
export const STALL_IDS: readonly StallId[] = BALANCE.stalls.map((s) => s.id);

/** 找出 App 存檔用的 localStorage key；找不到回 null。 */
export async function findSaveKey(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key === null) continue;
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'version' in parsed &&
          'state' in parsed
        ) {
          return key;
        }
      } catch {
        // 不是 JSON，不是存檔。
      }
    }
    return null;
  });
}

/** 讀出某個 key 的存檔內容。 */
export async function readSave(page: Page, key: string): Promise<SaveEnvelope | null> {
  return page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as SaveEnvelope;
    } catch {
      return null;
    }
  }, key);
}

/** 寫回存檔。 */
export async function writeSave(page: Page, key: string, save: SaveEnvelope): Promise<void> {
  await page.evaluate(
    ({ k, value }) => {
      window.localStorage.setItem(k, value);
    },
    { k: key, value: JSON.stringify(save) },
  );
}

/**
 * 造一個合法的 v1 存檔（GDD §8.1）。
 *
 * 攤位初始狀態沿用 GDD §3 不變式 3（第一攤 Lv1 已解鎖，其餘 Lv0 未解鎖），
 * 與驗收的 `initialStallStates` 同一份來源。
 */
export function buildSave(options: {
  now: number;
  balance: number;
  lastSettledAt: number;
  stalls?: Partial<Record<StallId, Partial<StallState>>>;
}): SaveEnvelope {
  const base = initialStallStates(BALANCE);
  const stalls: Record<string, StallState> = {};
  for (const def of BALANCE.stalls) {
    const patch = options.stalls?.[def.id] ?? {};
    const origin = base[def.id];
    if (!origin) continue;
    stalls[def.id] = {
      level: patch.level ?? origin.level,
      unlocked: patch.unlocked ?? origin.unlocked,
      clerkHired: patch.clerkHired ?? origin.clerkHired,
      selling: patch.selling ?? origin.selling,
    };
  }
  return {
    version: BALANCE.save.currentVersion,
    savedAt: options.now,
    state: {
      saveVersion: BALANCE.save.currentVersion,
      balance: options.balance,
      lastSettledAt: options.lastSettledAt,
      stalls,
    },
  };
}

/**
 * 等 App 寫出第一份存檔（UI 在動作成功後會立刻存檔，GDD §6.1）。
 * 拿不到 key 就回 null（測試端據此跳過）。
 */
export async function waitForSaveKey(page: Page, timeoutMs = 5_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const key = await findSaveKey(page);
    if (key !== null) return key;
    await page.waitForTimeout(200);
  }
  return null;
}
