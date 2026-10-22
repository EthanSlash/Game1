import balanceJson from '../../data/balance.json';
import { formatMoney } from '../core';
import type { BalanceConfig, GameSnapshot, OfflineSettlement, StallSnapshot, TimestampMs } from '../core';

/**
 * M2 主畫面渲染（唯讀）：只依賴 `src/core` 契約的快照，不做數值加工。
 *
 * - 數值顯示一律走 `src/core/money.ts` 的 `formatMoney`（GDD §7）。
 * - 里程碑進度由快照的 `nextMilestone.progress` 提供（GDD §5.1）；沒有下一個
 *   里程碑時顯示滿格。
 * - 按鈕狀態照快照的 `can*` 欄位；動作觸發用 `data-action` / `data-stall`，
 *   由 `src/ui/store.ts` 的事件委派接 `GameEngine`。
 * - 美術：emoji 來自 `data/balance.json`（快照 `emoji`），UI 不另放常數。
 */
const CONFIG: BalanceConfig = balanceJson;

/** 離線彈窗的「已達上限」提示（上限秒數來自 balance.json，不寫死 4 小時）。 */
const CAP_HINT_TEXT = `已達離線上限（${CONFIG.offline.capSeconds / 3600} 小時）`;

/** creditedMs（毫秒）轉人讀時長：`N 分 M 秒` / `N 小時 M 分 S 秒` / `N 秒`。 */
function formatDuration(ms: TimestampMs): string {
  const totalSec = Math.floor(ms / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hours = Math.floor(totalMin / 60);
  if (hours > 0) return `${hours} 小時 ${min} 分 ${sec} 秒`;
  if (totalMin > 0) return `${totalMin} 分 ${sec} 秒`;
  return `${sec} 秒`;
}

/** 里程碑進度百分比：沒有下一個里程碑（全部達成）→ 滿格 100（GDD §5.1）。 */
function progressPercent(stall: StallSnapshot): number {
  if (!stall.unlocked) return 0;
  const progress = stall.nextMilestone?.progress ?? 1;
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

function unlockedCard(stall: StallSnapshot): string {
  const pct = progressPercent(stall);
  const level = `<span class="stall__level" data-testid="level-${stall.id}">Lv.${stall.level}</span>`;
  const income = `<div class="stall__income" data-testid="income-stall-${stall.id}">+${formatMoney(stall.incomePerSec)}/秒</div>`;
  const bar = `<div class="stall__progress" data-testid="progress-${stall.id}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" style="--pct:${pct}%"><span class="stall__progress-fill"></span></div>`;

  const upgradeLabel =
    stall.upgradeCost === null
      ? '已達上限'
      : `升級 ${formatMoney(stall.upgradeCost)}`;
  const parts: string[] = [
    `<button class="btn" data-testid="upgrade-${stall.id}" data-action="upgrade" data-stall="${stall.id}" ${stall.canUpgrade ? '' : 'disabled'}>${upgradeLabel}</button>`,
  ];
  if (!stall.clerkHired) {
    const hireCost = stall.hireCost ?? 0;
    parts.push(
      `<button class="btn" data-testid="hire-${stall.id}" data-action="hire" data-stall="${stall.id}" ${stall.canHire ? '' : 'disabled'}>雇店員 ${formatMoney(hireCost)}</button>`,
      `<button class="btn btn--sell" data-testid="sell-${stall.id}" data-action="toggleSell" data-stall="${stall.id}">${stall.selling ? '收攤' : '開賣'}</button>`,
    );
  }
  const actions = `<div class="stall__actions">${parts.join('')}</div>`;
  const clerkTag = stall.clerkHired ? '<span class="stall__status">店員顧攤中</span>' : '';

  return `
    <li class="stall" data-testid="stall-${stall.id}">
      <span class="stall__art" aria-hidden="true">${stall.emoji}</span>
      <div class="stall__body">
        <div class="stall__head">
          <span class="stall__name" data-testid="name-${stall.id}">${stall.name}</span>
          ${level}
        </div>
        ${income}
        ${bar}
        ${actions}
        ${clerkTag}
      </div>
    </li>
  `;
}

function lockedCard(stall: StallSnapshot): string {
  const cost = stall.unlockCost ?? 0;
  return `
    <li class="stall stall--locked" data-testid="stall-${stall.id}" data-locked="true">
      <span class="stall__art" aria-hidden="true">${stall.emoji}</span>
      <div class="stall__body">
        <div class="stall__head">
          <span class="stall__name" data-testid="name-${stall.id}">${stall.name}</span>
        </div>
        <span class="stall__status">尚未解鎖</span>
        <div class="stall__actions">
          <button class="btn" data-testid="unlock-${stall.id}" data-action="unlock" data-stall="${stall.id}" ${stall.canUnlock ? '' : 'disabled'}>解鎖 ${formatMoney(cost)}</button>
        </div>
      </div>
    </li>
  `;
}

function renderStall(stall: StallSnapshot): string {
  return stall.unlocked ? unlockedCard(stall) : lockedCard(stall);
}

/**
 * M2 主畫面。`offline !== null` 時彈窗顯示該次離線／長空檔收益
 * （金額一律用引擎給的值，UI 不重算，GDD §6）。
 */
export function renderApp(
  root: HTMLElement,
  snapshot: GameSnapshot,
  offline: OfflineSettlement | null,
): void {
  const stallCards = snapshot.stalls.map(renderStall).join('');
  const clerkState = snapshot.anyClerkHired ? '店員顧攤中' : '自己顧攤';

  root.innerHTML = `
    <header class="top">
      <h1 class="top__title">夜市攤王</h1>
      <p class="top__balance" data-testid="balance">${formatMoney(snapshot.balance)}</p>
      <p class="top__income">
        <span data-testid="income-per-sec">+${formatMoney(snapshot.incomePerSec)}/秒</span>
        <span class="top__clerk">${clerkState}</span>
      </p>
    </header>
    <main>
      <h2 class="section-title">攤位</h2>
      <ul class="stalls">${stallCards}</ul>
    </main>
    <div class="modal" data-testid="offline-modal" ${offline === null ? 'hidden' : ''}>
      <div class="modal__panel" role="dialog" aria-modal="true" aria-label="離線收益">
        <h3 class="modal__title">歡迎回來！離線營業中</h3>
        <p class="modal__amount" data-testid="offline-amount">${offline ? `+${formatMoney(offline.gained)}` : '—'}</p>
        <p class="modal__duration" data-testid="offline-duration">${offline ? formatDuration(offline.creditedMs) : '—'}</p>
        <p class="modal__cap-hint" data-testid="offline-cap-hint" ${offline?.capped ? '' : 'hidden'}>${CAP_HINT_TEXT}</p>
        <button class="btn btn--primary" data-testid="offline-close" data-action="close-modal">收下</button>
      </div>
    </div>
  `;
}
