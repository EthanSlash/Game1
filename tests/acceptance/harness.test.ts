import { describe, expect, it } from 'vitest';

import { BALANCE, BALANCE_PATH } from './support/balance';
import { HARNESS } from './support/harness';

/**
 * 驗收環境狀態 —— 每次跑 `npm test` 都會看到目前能驗到哪裡。
 *
 * M1 引擎還沒交付時，驗收主體會以 `skip` 標示「等待 M1」，
 * 這支則負責把原因講清楚，避免「整個檔案跳過」看起來像沒做事。
 *
 * 同時檢查**契約漂移**：M1 交出來的引擎必須具備 GDD v1.1 §5／§6 與
 * `src/core/api.ts` 要求的每一個方法，而且必須從**公開進入點**
 * `src/core/index.ts` 轉出（UI 的 M2 只准 import 公開進入點）。
 */
const CORE_METHODS = [
  'createInitialState',
  'snapshot',
  'upgrade',
  'hire',
  'unlock',
  'toggleSell',
  'settle',
  'serialize',
  'load',
] as const;

const ENGINE_METHODS = [
  'init',
  'tick',
  'onHidden',
  'onVisible',
  'upgrade',
  'hire',
  'unlock',
  'toggleSell',
  'save',
  'state',
] as const;

describe('驗收環境', () => {
  it('回報 M1 引擎與設定檔的就緒狀態', () => {
    const lines = [
      `引擎可用：${HARNESS.core !== null && HARNESS.engine !== null ? '是' : '否'}`,
      `原因：${HARNESS.reason ?? '—'}`,
      `設定來源：${BALANCE_PATH}`,
      `src/core 匯出：${HARNESS.exports.join(', ') || '（無）'}`,
      `公開進入點匯出：${HARNESS.publicEntryExports.join(', ') || '（無）'}`,
    ];
    console.log(`[驗收環境]\n${lines.join('\n')}`);

    expect(HARNESS.core !== null || HARNESS.engine !== null ? 'ready' : 'pending').toMatch(
      /^(ready|pending)$/,
    );
  });

  it('設定檔有 GDD v1.1 需要的欄位（前景長空檔門檻、存檔間隔）', () => {
    expect(BALANCE.offline.capSeconds).toBeGreaterThan(0);
    expect(BALANCE.foreground.maxGapSeconds).toBeGreaterThan(0);
    expect(BALANCE.save.foregroundIntervalSeconds).toBeGreaterThan(0);
    expect(BALANCE.save.currentVersion).toBe(1);
    expect(BALANCE.save.minSupportedVersion).toBe(0);
    expect(BALANCE.stalls.length).toBeGreaterThan(0);
  });

  it.skipIf(HARNESS.core === null)('引擎已交付：純函式層具備契約要求的每一個方法', () => {
    const bag = HARNESS.core as unknown as Record<string, unknown>;
    for (const name of CORE_METHODS) {
      expect(typeof bag[name], `缺少 ${name}()`).toBe('function');
    }
  });

  it.skipIf(HARNESS.engine === null)('引擎已交付：門面層具備契約要求的每一個方法', () => {
    const bag = HARNESS.engine as unknown as Record<string, unknown>;
    for (const name of ENGINE_METHODS) {
      expect(typeof bag[name], `缺少 ${name}()`).toBe('function');
    }
  });

  it.skipIf(HARNESS.core === null && HARNESS.engine === null)(
    '引擎已交付：公開進入點 src/core/index.ts 有轉出工廠（UI 只准 import 這裡）',
    () => {
      expect(HARNESS.publicEntryExports).toContain('createCore');
      expect(HARNESS.publicEntryExports).toContain('createGameEngine');
    },
  );
});
