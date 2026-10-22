import { formatMoney } from '../core';
import type { Snapshot, StallView } from '../core';

/**
 * M2 靜態骨架（contract-independent）。
 *
 * 目的：先把畫面結構、data-testid、CSS 樣式定好；互動與數值全部等
 * `src/core/api.ts` 契約定案 + GDD/balance.json 之後，改由 store 轉接器
 * 驅動（見 PLANS/NIGHT_MARKET_KING_M2_UI_PLAN.md）。此版的按鈕一律 disabled、
 * 不掛任何事件。
 *
 * 美術：emoji（Ethan 未決事項的預設）。攤位 emoji 是 UI 常數、不進契約。
 */
const STALL_ART: Record<string, string> = {
  'chicken-steak': '🍗',
  'bubble-tea': '🧋',
  'oyster-omelette': '🥘',
  'stinky-tofu': '🧆',
  sausage: '🌭',
};

const MILESTONES: readonly number[] = [25, 50, 100];

/** 下一個未達成的里程碑（25/50/100）；全部達成回 null。 */
function nextMilestone(level: number): number | null {
  for (const m of MILESTONES) {
    if (level < m) return m;
  }
  return null;
}

/** 目前等級相對下一個里程碑的進度 0～1（鎖住或全部達成為 0）。 */
function progressFor(level: number, unlocked: boolean): number {
  const next = nextMilestone(level);
  if (!unlocked || next === null) return 0;
  return Math.min(1, level / next);
}

function renderStall(stall: StallView): string {
  const art = STALL_ART[stall.id] ?? '🥡';
  const progressPct = Math.round(progressFor(stall.level, stall.unlocked) * 100);

  if (!stall.unlocked) {
    return `
      <li class="stall stall--locked" data-testid="stall-${stall.id}" data-locked="true">
        <span class="stall__art" aria-hidden="true">${art}</span>
        <span class="stall__name">${stall.name}</span>
        <span class="stall__status">尚未解鎖</span>
        <button class="btn" data-testid="unlock-${stall.id}" disabled>解鎖</button>
      </li>
    `;
  }

  return `
    <li class="stall" data-testid="stall-${stall.id}">
      <span class="stall__art" aria-hidden="true">${art}</span>
      <div class="stall__body">
        <div class="stall__head">
          <span class="stall__name" data-testid="name-${stall.id}">${stall.name}</span>
          <span class="stall__level" data-testid="level-${stall.id}">Lv.${stall.level}</span>
        </div>
        <div class="stall__income" data-testid="income-stall-${stall.id}">
          +${formatMoney(stall.incomePerSec)}/秒
        </div>
        <div class="stall__progress" data-testid="progress-${stall.id}" role="progressbar" style="--pct:${progressPct}%">
          <span class="stall__progress-fill"></span>
        </div>
        <div class="stall__actions">
          <button class="btn" data-testid="upgrade-${stall.id}" disabled>升級</button>
          <button class="btn" data-testid="hire-${stall.id}" disabled>雇店員</button>
          <button class="btn btn--sell" data-testid="sell-${stall.id}" disabled>開賣</button>
        </div>
      </div>
    </li>
  `;
}

/**
 * 靜態骨架期畫面：結構與 testid 就位，互動與引擎接線等 store 轉接器。
 * 保留 M0 smoke 測試依賴的 class（.top__balance、.stall、.stall--locked）。
 */
export function renderApp(root: HTMLElement, snapshot: Snapshot): void {
  const totalIncome = snapshot.stalls.reduce((sum, stall) => sum + stall.incomePerSec, 0);

  root.innerHTML = `
    <header class="top">
      <h1 class="top__title">夜市攤王</h1>
      <p class="top__balance" data-testid="balance">${formatMoney(snapshot.balance)}</p>
      <p class="top__income">
        <span data-testid="income-per-sec">+${formatMoney(totalIncome)}/秒</span>
        <span class="top__clerk">${snapshot.clerkHired ? '店員顧攤中' : '自己顧攤'}</span>
      </p>
    </header>
    <main>
      <h2 class="section-title">攤位</h2>
      <ul class="stalls">${snapshot.stalls.map(renderStall).join('')}</ul>
      <p class="note">M2 骨架：畫面結構與 data-testid 就位；按鈕等 core 契約定案後接 store 轉接器。</p>
    </main>
    <div class="modal" data-testid="offline-modal" hidden>
      <div class="modal__panel" role="dialog" aria-modal="true" aria-label="離線收益">
        <h3 class="modal__title">歡迎回來！離線營業中</h3>
        <p class="modal__amount" data-testid="offline-amount">—</p>
        <p class="modal__duration" data-testid="offline-duration">—</p>
        <p class="modal__cap-hint" data-testid="offline-cap-hint" hidden>已達離線上限</p>
        <button class="btn btn--primary" data-testid="offline-close">收下</button>
      </div>
    </div>
  `;
}
