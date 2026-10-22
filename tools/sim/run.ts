/**
 * 《夜市攤王》平衡模擬：重現 `docs/GDD.md` §10 的檢查點。
 *
 * 用法：
 *   npm run sim                # 跑滿 GDD §10 的 7 天視窗（雞排先到 Lv100 就提前停）
 *   npm run sim -- --hours 24  # 只跑到指定小時
 *   npm run sim -- --seconds 600
 *
 * 模擬假設（與 GDD §10 一致，改這裡等於改 GDD）：
 * - 全程前景，每 1 秒結算一次（`settle(state, now, 'foreground')`）。
 * - 開局立刻手動開賣雞排車（`toggleSell`），之後不再切換開賣狀態。
 * - 策略每一秒依序：
 *   1. 能解鎖就依序解鎖（一次一攤）。
 *   2. 能雇用就雇用（每攤一位，依 `balance.json` 的攤位順序）。
 *   3. 其餘把錢花在「收益增幅 ÷ 成本」最大的升級上，買到買不起為止。
 *      只投資正在產生前景收益的攤位（有店員或手動開賣）。
 *
 * 只使用 `src/core` 的公開 API；時間由參數注入，不呼叫 `Date.now()`、不碰 I/O 以外的東西。
 * 本檔不寫死任何遊戲數值，全部來自 `data/balance.json`（經 `BALANCE_CONFIG`）。
 */

import { BALANCE_CONFIG, createCore } from '../../src/core';
import type { BalanceConfig, GameState, StallId, StallSnapshot } from '../../src/core';

/** 模擬起點（固定值讓輸出可重現，不代表真實時間）。 */
const SIM_START_MS = 1_700_000_000_000;
const HOUR_SECONDS = 3600;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const SAMPLE_SECONDS: readonly number[] = [HOUR_SECONDS, 6 * HOUR_SECONDS, DAY_SECONDS, 7 * DAY_SECONDS];

interface Checkpoint {
  readonly atSeconds: number;
  readonly balance: number;
  readonly incomePerSec: number;
  readonly stalls: readonly StallSnapshot[];
}

interface SimResult {
  readonly checkpoints: readonly Checkpoint[];
  readonly unlockedAt: ReadonlyMap<StallId, number>;
  readonly hiredAt: ReadonlyMap<StallId, number>;
  readonly secondUpgradeAt: number | null;
  readonly firstMilestoneAt: number | null;
  readonly level100At: number | null;
  readonly level25At: ReadonlyMap<StallId, number>;
  readonly ranSeconds: number;
  readonly stoppedEarly: boolean;
}

/** 解析 `--hours` / `--seconds`；預設 7 天。 */
function parseLimitSeconds(argv: readonly string[]): number {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index < 0 ? undefined : argv[index + 1];
  };

  const toPositive = (raw: string | undefined, scale: number): number | null => {
    if (raw === undefined) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.floor(parsed * scale);
  };

  return toPositive(valueOf('--seconds'), 1) ?? toPositive(valueOf('--hours'), HOUR_SECONDS) ?? 7 * DAY_SECONDS;
}

/** 依照 GDD §4.2 算某一級的每秒收益（只看公式與里程碑，不看目前是否計入）。 */
function incomeAtLevel(config: BalanceConfig, def: BalanceConfig['stalls'][number], level: number, clerkHired: boolean): number {
  const milestoneMultiplier = config.milestones.reduce(
    (acc, milestone) => (level >= milestone.level ? acc * milestone.multiplier : acc),
    1,
  );
  const clerkFactor = clerkHired ? config.clerkIncomeMultiplier : 1;
  return def.baseIncomePerSec * config.incomeGrowthPerLevel ** (level - 1) * milestoneMultiplier * clerkFactor;
}

function simulate(config: BalanceConfig, limitSeconds: number): SimResult {
  const core = createCore(config);
  const firstDef = config.stalls[0];
  if (firstDef === undefined) throw new Error('balance.json 沒有任何攤位');
  // 收窄後存成獨立常數：TypeScript 不會把 `config.stalls[0]` 的收窄帶進巢狀函式。
  const primaryStallId = firstDef.id;

  const opened = core.toggleSell(core.createInitialState(SIM_START_MS), firstDef.id);
  if (!opened.ok) throw new Error(`模擬前置失敗：無法開賣 ${firstDef.id}（${opened.reason}）`);
  let state: GameState = opened.state;

  const sampleSeconds = new Set(SAMPLE_SECONDS);
  const checkpoints: Checkpoint[] = [];
  const unlockedAt = new Map<StallId, number>([[firstDef.id, 0]]);
  const hiredAt = new Map<StallId, number>();
  const level25At = new Map<StallId, number>();
  let secondUpgradeAt: number | null = null;
  let firstMilestoneAt: number | null = null;
  let level100At: number | null = null;

  function record(atSeconds: number): void {
    if (!sampleSeconds.has(atSeconds)) return;
    const snapshot = core.snapshot(state);
    checkpoints.push({
      atSeconds,
      balance: snapshot.balance,
      incomePerSec: snapshot.incomePerSec,
      stalls: snapshot.stalls,
    });
  }

  /** GDD §10 的策略：解鎖 → 雇用 → 買「收益增幅 ÷ 成本」最高者。 */
  function decide(atSeconds: number): void {
    // 1. 能解鎖就依序解鎖（一次一攤；下一秒再試下一攤）。
    for (const def of config.stalls) {
      if (state.stalls[def.id]?.unlocked !== false) continue;
      const result = core.unlock(state, def.id);
      if (result.ok) {
        state = result.state;
        unlockedAt.set(def.id, atSeconds);
      }
      break;
    }

    // 2. 能雇用就雇用（每攤一位）。
    for (;;) {
      const candidate = config.stalls.find((def) => {
        const stall = state.stalls[def.id];
        return stall?.unlocked === true && !stall.clerkHired && state.balance >= def.hireCost;
      });
      if (candidate === undefined) break;
      const result = core.hire(state, candidate.id);
      if (!result.ok) break;
      state = result.state;
      hiredAt.set(candidate.id, atSeconds);
    }

    // 3. 買「收益增幅 ÷ 成本」最大的升級，買到買不起為止。
    for (;;) {
      const snapshot = core.snapshot(state);
      const views = new Map(snapshot.stalls.map((view) => [view.id, view]));
      let bestId: StallId | null = null;
      let bestRatio = 0;

      for (const def of config.stalls) {
        const view = views.get(def.id);
        if (view === undefined) continue;
        // 沒有前景收益的攤位先不投資（GDD §4.3：沒有店員又沒開賣 → 收益 0）。
        if (!(view.clerkHired || view.selling)) continue;
        const cost = view.upgradeCost;
        if (cost === null || cost <= 0 || state.balance < cost) continue;

        const nextRate = incomeAtLevel(config, def, view.level + 1, view.clerkHired);
        const ratio = (nextRate - view.incomePerSec) / cost;
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestId = def.id;
        }
      }

      if (bestId === null) break;
      const result = core.upgrade(state, bestId);
      if (!result.ok) break;
      state = result.state;

      if (bestId === primaryStallId && state.stalls[primaryStallId]?.level === 3) {
        secondUpgradeAt ??= atSeconds;
      }
    }
  }

  let ranSeconds = 0;
  for (let second = 0; second <= limitSeconds; second += 1) {
    if (second > 0) {
      state = core.settle(state, SIM_START_MS + second * 1000, 'foreground').state;
      decide(second);
    }
    record(second);
    ranSeconds = second;

    for (const def of config.stalls) {
      if ((state.stalls[def.id]?.level ?? 0) >= 25 && !level25At.has(def.id)) {
        level25At.set(def.id, second);
        firstMilestoneAt ??= second;
      }
    }

    if (level100At === null && firstDef.maxLevel !== null && (state.stalls[firstDef.id]?.level ?? 0) >= 100) {
      level100At = second;
      break;
    }
  }

  return {
    checkpoints,
    unlockedAt,
    hiredAt,
    secondUpgradeAt,
    firstMilestoneAt,
    level100At,
    level25At,
    ranSeconds,
    stoppedEarly: ranSeconds < limitSeconds,
  };
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '未達成';
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < HOUR_SECONDS) return `${(seconds / 60).toFixed(1)} 分`;
  return `${(seconds / HOUR_SECONDS).toFixed(2)} 小時`;
}

function formatRate(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function main(): void {
  const limitSeconds = parseLimitSeconds(process.argv.slice(2));
  const result = simulate(BALANCE_CONFIG, limitSeconds);

  console.log(`[sim] 模擬視窗 ${formatDuration(limitSeconds)}，實際跑 ${formatDuration(result.ranSeconds)}`);
  console.log('[sim] 假設：全程前景、每 1 秒結算、開局手動開賣第一攤、策略見檔頭說明');

  console.log('\n[sim] 攤位時間線');
  for (const def of BALANCE_CONFIG.stalls) {
    const unlocked = result.unlockedAt.get(def.id);
    const hired = result.hiredAt.get(def.id);
    console.log(
      `  ${def.name.padEnd(6, ' ')} 解鎖 ${formatDuration(unlocked ?? null).padEnd(9, ' ')}` +
        ` 雇用 ${formatDuration(hired ?? null).padEnd(9, ' ')}` +
        ` Lv25 ${formatDuration(result.level25At.get(def.id) ?? null)}`,
    );
  }

  console.log('\n[sim] 檢查點');
  for (const checkpoint of result.checkpoints) {
    const levels = checkpoint.stalls
      .map((stall) => (stall.unlocked ? `${stall.name} Lv${stall.level}` : `${stall.name} 未解鎖`))
      .join('｜');
    console.log(
      `  ${formatDuration(checkpoint.atSeconds).padEnd(10, ' ')}` +
        ` 攤位 ${checkpoint.stalls.filter((stall) => stall.unlocked).length} 間` +
        ` 速率 ${formatRate(checkpoint.incomePerSec)}/秒` +
        ` 餘額 ${formatRate(checkpoint.balance)}`,
    );
    console.log(`    ${levels}`);
  }

  console.log('\n[sim] 里程碑');
  console.log(`  第二次升級（第一攤 Lv3）：${formatDuration(result.secondUpgradeAt)}`);
  console.log(`  第一個 Lv25：${formatDuration(result.firstMilestoneAt)}`);
  console.log(`  第一攤 Lv100：${formatDuration(result.level100At)}`);
  if (result.stoppedEarly) {
    console.log('  （第一攤已達 Lv100，提前結束模擬）');
  }
}

main();
