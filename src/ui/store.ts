import { BALANCE_CONFIG, createGameEngine } from '../core';
import { renderApp } from './app';
import type { EngineFrame, GameSnapshot, OfflineSettlement, TimestampMs } from '../core';

/**
 * M2 store — `GameEngine` 門面（M1 真引擎，`createGameEngine`）
 * 與 DOM 之間的唯一接線，職責：
 *
 * - `init` 讀檔冷啟動：`loadError` 只 console 警告（GDD：不彈錯誤、不崩）；
 *   `frame.offline` 有值（含冷啟動離線收益、`tick` 偵測到的長空檔）跳彈窗。
 * - 每 250ms `tick`（GDD §6 建議節奏）；結算是連續時間制，tick 間距不影響金額。
 * - 存檔時機（GDD §6.1 UI 硬規則）：
 *   ①`onHidden` 之後立刻存（同一個 `now`）；②每次動作成功後立刻存；
 *   ③前景每 `save.foregroundIntervalSeconds` 秒定期存（僅前景，hidden 期間跳過）。`init` 後不強制。
 *   UI 只把 `engine.save()` 的字串原樣寫進**單一** localStorage key，不解析；
 *   寫入失敗吞掉例外、僅 console 警告。
 */
/** 畫面 tick 節奏（毫秒）。結算不吃這個值，只影響更新頻率。 */
const TICK_MS = 250;
/** 秒 → 毫秒（repo 唯一允許的秒↔毫秒轉換處之一，GDD §1）。 */
const SAVE_INTERVAL_MS = BALANCE_CONFIG.save.foregroundIntervalSeconds * 1000;
/** GDD §6.1：單一 localStorage key，名稱由 UI 決定。 */
const SAVE_KEY = 'night-market-king-save';

export function start(root: HTMLElement): void {
  const engine = createGameEngine(BALANCE_CONFIG);
  let snapshot: GameSnapshot = engine.state();
  let modalOffline: OfflineSettlement | null = null;
  let lastSaveAt = Date.now();

  function readSavedState(): string | null {
    try {
      return localStorage.getItem(SAVE_KEY);
    } catch {
      return null; // 隱私模式等：視為沒有存檔
    }
  }

  function persistSave(now: TimestampMs): void {
    try {
      localStorage.setItem(SAVE_KEY, engine.save(now));
      lastSaveAt = now;
    } catch (error) {
      console.warn('[夜市攤王] 存檔寫入失敗，下個時機再試', error);
    }
  }

  function render(feedbackStallId: string | null = null): void {
    renderApp(root, snapshot, modalOffline, feedbackStallId);
  }

  /** 離線彈窗：`gained > 0` 才顯示（GDD §6：收益 0 不跳，由引擎保證 offline 為 null）。 */
  function applyFrame(frame: EngineFrame): void {
    snapshot = frame.snapshot;
    if (frame.loadError !== null) {
      console.warn(
        `[夜市攤王] 存檔載入失敗（${frame.loadError}），已開新局`,
      );
    }
    if (frame.offline !== null) {
      modalOffline = frame.offline;
    }
    render();
  }

  /* ---- 冷啟動 ---- */
  applyFrame(engine.init(Date.now(), readSavedState()));

  /* ---- 動作（事件委派：listener 掛在 root 上，結構就地更新不受委派影響） ---- */
  const ACTIONS = ['upgrade', 'hire', 'unlock', 'toggleSell'] as const;
  type ActionName = (typeof ACTIONS)[number];
  const isAction = (value: string): value is ActionName =>
    (ACTIONS as readonly string[]).includes(value);

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>('button[data-action]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    const action = button.dataset.action ?? '';
    if (action === 'close-modal') {
      modalOffline = null;
      render();
      return;
    }
    const stallId = button.dataset.stall;
    if (!isAction(action) || stallId === undefined) return;

    // 門面動作內部先結算（GDD §5）；成功後立刻存檔（§6.1，同一個 now）。
    // 成功時把攤位 id 傳給 renderer 觸發一次回饋動畫（升級／雇用／解鎖，UX #4）；
    // 開賣／收攤是狀態切換，狀態本來就會顯示，不另外閃卡。
    const now = Date.now();
    const ok = engine[action](stallId, now);
    if (ok) persistSave(now);
    snapshot = engine.state();
    render(ok && action !== 'toggleSell' ? stallId : null);
  });

  /* ---- 前景 loop：tick + 定期存檔 ---- */
  setInterval(() => {
    // 文件 hidden 時整段跳過：引擎 §6 本來就忽略背景 tick（不結算、不改狀態），
    // 定期存檔也只在背景前後重寫同一份內容；唯一該存的時機（onHidden 後立刻存）
    // 由下一層 visibilitychange 處理（§6.1）。
    if (document.hidden) return;
    const now = Date.now();
    applyFrame(engine.tick(now));
    if (now - lastSaveAt >= SAVE_INTERVAL_MS) persistSave(now);
  }, TICK_MS);

  /* ---- 前景／背景切換 ---- */
  document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    if (document.hidden) {
      engine.onHidden(now);
      persistSave(now); // §6.1 硬規則：onHidden 後立刻存（被系統殺掉前最後一次）
    } else {
      applyFrame(engine.onVisible(now));
      lastSaveAt = now; // 定期存檔重新起算
    }
  });
}
