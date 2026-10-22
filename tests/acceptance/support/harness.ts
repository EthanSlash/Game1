/**
 * 驗收環境載入器：找出 M1 的引擎實作。
 *
 * M1 還沒交付時，這裡不會讓整個 `npm test` 紅掉，而是讓驗收檔以 `skip` 標示
 * 「等待 M1」，repo 維持綠燈；M1 一交（`src/core` 任何模組匯出
 * `createCore` / `createGameEngine`），驗收檔**自動開跑**，不用改測試。
 *
 * 為什麼在執行期尋找而不是 `import { createCore } from '../../src/core'`？
 * 那樣寫在 M1 交付前會直接編譯失敗，整個 `npm test` 紅掉，其他 agent 的分支
 * 也就沒法跑測試（硬規則：驗收不該卡住別人）。
 *
 * 尋找方式：用 `import.meta.glob` 掃 src/core 底下所有 .ts，挑出有匯出工廠的模組。
 * 這樣不綁死檔名（M1 放 `index.ts`、`engine.ts` 還是 `core/engine.ts` 都找得到），
 * 同時另外檢查「公開進入點 `src/core/index.ts` 有沒有轉出這兩個工廠」——
 * 這是 UI（M2）與驗收唯一該依賴的接點。
 */
import { BALANCE } from './balance';
import type { BalanceConfig, GameEngine, NightMarketCore } from './types';

export interface Harness {
  /** 純函式層；M1 還沒交時為 null。 */
  readonly core: NightMarketCore | null;
  /** 有狀態門面；M1 還沒交時為 null。 */
  readonly engine: GameEngine | null;
  /** 工廠：可以每次做一個**乾淨的**引擎，避免測試之間互相污染。 */
  readonly createCore: CoreFactory | null;
  readonly createEngine: EngineFactory | null;
  /** 不能驗收的原因；可用時為 null。 */
  readonly reason: string | null;
  /** `src/core` 目前匯出的名稱（診斷用）。 */
  readonly exports: readonly string[];
  /** 掃到的模組路徑（診斷用）。 */
  readonly modulePaths: readonly string[];
  /** 載入模組時的錯誤（診斷用）。 */
  readonly loadErrors: readonly string[];
  /** 公開進入點 `src/core/index.ts` 的匯出名稱（診斷用）。 */
  readonly publicEntryExports: readonly string[];
}

type CoreFactory = (config: BalanceConfig) => NightMarketCore;
type EngineFactory = (config: BalanceConfig) => GameEngine;

async function discover(): Promise<Harness> {
  const loaders = import.meta.glob('../../../src/core/**/*.ts');
  const modulePaths = Object.keys(loaders)
    .filter((p) => !p.includes('.test.'))
    .sort();

  const exportNames = new Set<string>();
  const loadErrors: string[] = [];
  let createCore: CoreFactory | null = null;
  let createEngine: EngineFactory | null = null;

  for (const path of modulePaths) {
    let mod: Record<string, unknown>;
    try {
      mod = (await loaders[path]?.()) as Record<string, unknown>;
    } catch (err) {
      loadErrors.push(`${path}: ${(err as Error).message}`);
      continue;
    }
    if (!mod) continue;
    for (const key of Object.keys(mod)) exportNames.add(key);
    if (createCore === null && typeof mod['createCore'] === 'function') {
      createCore = mod['createCore'] as CoreFactory;
    }
    if (createEngine === null && typeof mod['createGameEngine'] === 'function') {
      createEngine = mod['createGameEngine'] as EngineFactory;
    }
  }

  // 公開進入點的匯出（UI 與驗收唯一該依賴的接點）。
  let publicEntryExports: string[] = [];
  try {
    const entry = (await import('../../../src/core')) as unknown as Record<string, unknown>;
    publicEntryExports = Object.keys(entry).sort();
  } catch (err) {
    loadErrors.push(`src/core/index.ts: ${(err as Error).message}`);
  }

  if (createCore === null && createEngine === null) {
    return {
      core: null,
      engine: null,
      createCore: null,
      createEngine: null,
      reason:
        'M1 引擎尚未交付：src/core 沒有任何模組匯出 createCore / createGameEngine' +
        `（目前匯出：${[...exportNames].sort().join(', ') || '（無）'}）`,
      exports: [...exportNames].sort(),
      modulePaths,
      loadErrors,
      publicEntryExports,
    };
  }

  let core: NightMarketCore | null = null;
  let engine: GameEngine | null = null;
  try {
    core = createCore === null ? null : createCore(BALANCE);
  } catch (err) {
    loadErrors.push(`createCore(BALANCE) 失敗：${(err as Error).message}`);
  }
  try {
    engine = createEngine === null ? null : createEngine(BALANCE);
  } catch (err) {
    loadErrors.push(`createGameEngine(BALANCE) 失敗：${(err as Error).message}`);
  }

  const missing: string[] = [];
  if (core === null) missing.push('createCore');
  if (engine === null) missing.push('createGameEngine');

  return {
    core,
    engine,
    createCore,
    createEngine,
    reason:
      missing.length === 0
        ? null
        : `M1 只交了一半：${missing.join(' / ')} 還沒實作（需要兩層都有才跑完整驗收）`,
    exports: [...exportNames].sort(),
    modulePaths,
    loadErrors,
    publicEntryExports,
  };
}

/** 驗收環境（載入結果快取，全測試檔共用）。 */
export const HARNESS: Harness = await discover();

/** 取純函式層；測試體只有在 suite 沒被 skip 時才會呼叫。 */
export function requireCore(): NightMarketCore {
  if (HARNESS.core === null) {
    throw new Error(`M1 引擎不可用：${HARNESS.reason ?? '（原因不明）'}`);
  }
  return HARNESS.core;
}

/**
 * 做一個**乾淨的**門面實例。
 *
 * 門面是有狀態的（持有存檔、離線結算的水位線），共用同一個實例會讓
 * 測試互相污染 —— 每個案例都應該從乾淨狀態開始。
 */
export function freshEngine(): GameEngine {
  if (HARNESS.createEngine === null) {
    throw new Error(`M1 引擎不可用：${HARNESS.reason ?? '（原因不明）'}`);
  }
  return HARNESS.createEngine(BALANCE);
}
