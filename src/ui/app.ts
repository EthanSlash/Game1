import balanceJson from '../../data/balance.json';
import { formatMoney } from '../core';
import type { BalanceConfig, GameSnapshot, OfflineSettlement, StallSnapshot, TimestampMs } from '../core';

/**
 * M2 主畫面渲染：**結構只建一次**，之後每個 tick 只更新文字與屬性（UX 審查 #13）。
 *
 * 2026-10-23 UX 修正第 1 批（對照 SA克勞德 審查清單編號）：
 * - #1 開局引導：`balance === 0` 且沒有任何攤位開賣／雇店員時，顯示提示行並讓
 *   `sell-*` 發光（`btn--glow`）；條件不成立自動消失。
 * - #2 營業狀態：攤位卡顯示「營業中／休息中／店員顧攤中」狀態標籤（`status-<id>`）；
 *   `sell-*` 按鈕文案維持動作（開賣／收攤）。
 * - #4＋#13 動作回饋：升級／雇用／解鎖成功後該卡短暫亮起、數字跳一下
 *   （`stall--flash` / `pop-num`，由 store 傳入 feedbackStallId 觸發一次）。
 *   動畫能存活的前提就是本檔不再整頁重建 DOM。
 * - #5 進度條標籤：`→ Lv25 收益 ×2`，數值直接讀 `stall.nextMilestone`。
 * - #6＋#7 店員說明：`hire-<id>` 下方加固定說明文字（收益預覽數字在第 2 批）。
 * - #10 鎖定攤位對比：改用色彩調低、不再疊乘透明度；錢夠時 `unlock-<id>` 加
 *   `btn--ready` 明顯強調。
 * - #12 離線彈窗上限提示改寫，小時數由 `balance.json` 組出。
 *
 * 其他不變事項：
 * - 數值顯示一律走 `src/core/money.ts` 的 `formatMoney`（GDD §7）；里程碑進度由
 *   快照的 `nextMilestone.progress` 提供（GDD §5.1）；沒有下一個里程碑時顯示滿格。
 * - 按鈕狀態照快照的 `can*` 欄位；UI 不做任何遊戲數值計算。
 * - 動作觸發仍用 `data-action` / `data-stall`，由 `src/ui/store.ts` 的事件委派接
 *   `GameEngine`；事件 listener 掛在 root 上，結構就地更新不影響委派。
 * - `data-testid` 命名表見 `src/ui/testids.md`，一個都沒改名或移除。
 * - 美術：emoji 來自 `data/balance.json`（快照 `emoji`），UI 不另放常數。
 */
const CONFIG: BalanceConfig = balanceJson;

/** 離線彈窗的「已達上限」提示（小時數來自 balance.json，不寫死；UX #12）。 */
const CAP_HINT_TEXT = `離線最多累積 ${CONFIG.offline.capSeconds / 3600} 小時，記得回來收錢`;

/** 雇用說明（UX #6/#7）。固定文字，不含任何遊戲數值（數字等第 2 批 core 欄位）。 */
const HIRE_HINT_TEXT = '雇店員後自動營業、離線也會賺，開賣鈕會移除';

/** 開局引導文案（UX #1）。 */
const ONBOARDING_TEXT = '按「開賣」開始賺錢';

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

/** 開局引導成立條件（UX #1）：餘額 0、沒有人開賣、沒有店員。 */
function onboardingActive(snapshot: GameSnapshot): boolean {
  return (
    snapshot.balance === 0 &&
    !snapshot.anyClerkHired &&
    !snapshot.stalls.some((stall) => stall.selling)
  );
}

/** 攤位卡的營業狀態文案（UX #2）。鎖住的攤位走「尚未解鎖」，不在本函式。 */
function statusText(stall: StallSnapshot): string {
  if (stall.clerkHired) return '店員顧攤中';
  return stall.selling ? '營業中' : '休息中';
}

/** 同一個文字就不再寫入，避免沒必要的 DOM 變動。 */
function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** 按鈕就地更新：文案＋disabled（照快照 `can*` 決定，UI 不自己算）。 */
function setBtnState(btn: HTMLButtonElement, label: string, enabled: boolean): void {
  setText(btn, label);
  btn.disabled = !enabled;
}

/* ---- 結構模板（只在卡結構改變時重建一次） ---- */

function unlockedCardHtml(stall: StallSnapshot): string {
  const pct = progressPercent(stall);
  const upgradeLabel =
    stall.upgradeCost === null ? '已達上限' : `升級 ${formatMoney(stall.upgradeCost)}`;
  const parts: string[] = [
    `<button class="btn" data-testid="upgrade-${stall.id}" data-action="upgrade" data-stall="${stall.id}" ${stall.canUpgrade ? '' : 'disabled'}>${upgradeLabel}</button>`,
  ];
  if (!stall.clerkHired) {
    parts.push(
      `<button class="btn" data-testid="hire-${stall.id}" data-action="hire" data-stall="${stall.id}" ${stall.canHire ? '' : 'disabled'}>雇店員 ${formatMoney(stall.hireCost ?? 0)}</button>`,
      `<button class="btn btn--sell" data-testid="sell-${stall.id}" data-action="toggleSell" data-stall="${stall.id}">${stall.selling ? '收攤' : '開賣'}</button>`,
    );
  }
  const actions = `<div class="stall__actions">${parts.join('')}</div>`;
  const hireHint = stall.clerkHired
    ? ''
    : `<p class="stall__hire-hint" data-testid="hire-hint-${stall.id}">${HIRE_HINT_TEXT}</p>`;
  const milestone = stall.nextMilestone;
  const progressLabel = `<span class="stall__progress-label" data-testid="progress-label-${stall.id}" ${milestone === null ? 'hidden' : ''}>${milestone === null ? '' : `→ Lv${milestone.level} 收益 ×${milestone.multiplier}`}</span>`;

  return `
    <li class="stall" data-testid="stall-${stall.id}">
      <span class="stall__art" aria-hidden="true">${stall.emoji}</span>
      <div class="stall__body">
        <div class="stall__head">
          <span class="stall__name" data-testid="name-${stall.id}">${stall.name}</span>
          <span class="stall__level" data-testid="level-${stall.id}">Lv.${stall.level}</span>
        </div>
        <div class="stall__income" data-testid="income-stall-${stall.id}">+${formatMoney(stall.incomePerSec)}/秒</div>
        <div class="stall__progress" data-testid="progress-${stall.id}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" style="--pct:${pct}%"><span class="stall__progress-fill"></span></div>
        ${progressLabel}
        <span class="stall__status" data-testid="status-${stall.id}" data-state="idle">${statusText(stall)}</span>
        ${actions}
        ${hireHint}
      </div>
    </li>
  `;
}

function lockedCardHtml(stall: StallSnapshot): string {
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

/* ---- 就地更新的 DOM 參考 ---- */

/** 卡片結構鍵：結構改變（解鎖、雇店員）才重建那一張卡，其餘就地更新。 */
type CardStructure = 'locked' | 'unlocked-open' | 'unlocked-clerk';

function cardStructure(stall: StallSnapshot): CardStructure {
  if (!stall.unlocked) return 'locked';
  return stall.clerkHired ? 'unlocked-clerk' : 'unlocked-open';
}

/**
 * 單卡 DOM 參考（discriminated union：`structure` 收窄）。
 * - `locked`：只有 `unlockBtn`。
 * - `unlocked-*`：沒有 `unlockBtn`；雇店員後 `hireBtn` / `sellBtn` 消失
 *   （結構鍵會變、整卡重建，`unlocked-clerk` 時兩者恆為 null）。
 */
interface LockedCardRefs {
  readonly structure: 'locked';
  readonly li: HTMLLIElement;
  readonly unlockBtn: HTMLButtonElement;
}

interface UnlockedCardRefs {
  readonly structure: Exclude<CardStructure, 'locked'>;
  readonly li: HTMLLIElement;
  readonly level: HTMLElement;
  readonly income: HTMLElement;
  readonly progress: HTMLElement;
  readonly progressLabel: HTMLElement;
  readonly status: HTMLElement;
  readonly upgradeBtn: HTMLButtonElement;
  readonly hireBtn: HTMLButtonElement | null;
  readonly sellBtn: HTMLButtonElement | null;
}

type CardRefs = LockedCardRefs | UnlockedCardRefs;

const SELECT = (testid: string): string => `[data-testid="${testid}"]`;

function hydrateCard(li: HTMLLIElement, stallId: string, structure: CardStructure): CardRefs {
  /** 必要元素；缺少代表模板與此處不同步，直接爆掉比靜默壞畫面好。 */
  function q<T extends Element>(testid: string): T {
    const el = li.querySelector<T>(SELECT(testid));
    if (el === null) {
      throw new Error(`夜市攤王渲染錯誤：攤位 ${stallId} 缺少 [data-testid="${testid}"]`);
    }
    return el;
  }

  if (structure === 'locked') {
    const unlockBtn = q<HTMLButtonElement>('unlock-' + stallId);
    const refs: LockedCardRefs = { structure, li, unlockBtn };
    return refs;
  }
  const hireBtn = li.querySelector<HTMLButtonElement>(SELECT('hire-' + stallId));
  const sellBtn = li.querySelector<HTMLButtonElement>(SELECT('sell-' + stallId));
  if (structure === 'unlocked-clerk' && (hireBtn !== null || sellBtn !== null)) {
    throw new Error(`夜市攤王渲染錯誤：攤位 ${stallId} 已雇店員，不應再有 hire/sell 鈕`);
  }
  const refs: UnlockedCardRefs = {
    structure,
    li,
    level: q('level-' + stallId),
    income: q('income-stall-' + stallId),
    progress: q('progress-' + stallId),
    progressLabel: q('progress-label-' + stallId),
    status: q('status-' + stallId),
    upgradeBtn: q('upgrade-' + stallId),
    hireBtn,
    sellBtn,
  };
  return refs;
}

/**
 * 整頁參考（骨架）：`buildSession` 一次性寫入 `root.innerHTML` 之後，
 * 一律只透過這些參考就地更新。
 */
interface RenderSession {
  readonly balance: HTMLElement;
  readonly incomeTop: HTMLElement;
  readonly clerkTop: HTMLElement;
  readonly onboarding: HTMLElement;
  readonly stalls: HTMLElement;
  readonly modal: HTMLElement;
  readonly amount: HTMLElement;
  readonly duration: HTMLElement;
  readonly capHint: HTMLElement;
  readonly cards: Map<string, CardRefs>;
}

const sessions = new WeakMap<HTMLElement, RenderSession>();

function buildSession(root: HTMLElement): RenderSession {
  root.innerHTML = `
    <header class="top">
      <h1 class="top__title">夜市攤王</h1>
      <p class="top__balance" data-testid="balance"></p>
      <p class="top__income">
        <span data-testid="income-per-sec"></span>
        <span class="top__clerk"></span>
      </p>
    </header>
    <p class="onboarding" data-testid="onboarding-hint" hidden>${ONBOARDING_TEXT}</p>
    <main>
      <h2 class="section-title">攤位</h2>
      <ul class="stalls"></ul>
    </main>
    <div class="modal" data-testid="offline-modal" hidden>
      <div class="modal__panel" role="dialog" aria-modal="true" aria-label="離線收益">
        <h3 class="modal__title">歡迎回來！離線營業中</h3>
        <p class="modal__amount" data-testid="offline-amount">—</p>
        <p class="modal__duration" data-testid="offline-duration">—</p>
        <p class="modal__cap-hint" data-testid="offline-cap-hint" hidden>${CAP_HINT_TEXT}</p>
        <button class="btn btn--primary" data-testid="offline-close" data-action="close-modal">收下</button>
      </div>
    </div>
  `;

  function q<T extends HTMLElement>(selector: string): T {
    const el = root.querySelector<T>(selector);
    if (el === null) throw new Error(`夜市攤王渲染錯誤：骨架缺少 ${selector}`);
    return el;
  }

  return {
    balance: q('.top__balance'),
    incomeTop: q('[data-testid="income-per-sec"]'),
    clerkTop: q('.top__clerk'),
    onboarding: q('.onboarding'),
    stalls: q('.stalls'),
    modal: q('[data-testid="offline-modal"]'),
    amount: q('[data-testid="offline-amount"]'),
    duration: q('[data-testid="offline-duration"]'),
    capHint: q('[data-testid="offline-cap-hint"]'),
    cards: new Map<string, CardRefs>(),
  };
}

/** 卡結構變了才重建單張卡（解鎖／雇店員），位置照快照順序原地替換。 */
function mountCard(session: RenderSession, stall: StallSnapshot): CardRefs {
  const structure = cardStructure(stall);
  const tpl = document.createElement('template');
  tpl.innerHTML = (stall.unlocked ? unlockedCardHtml(stall) : lockedCardHtml(stall)).trim();
  const li = tpl.content.firstElementChild;
  if (!(li instanceof HTMLLIElement)) {
    throw new Error('夜市攤王渲染錯誤：攤位卡模板不是 <li>');
  }
  const prev = session.cards.get(stall.id);
  if (prev === undefined) session.stalls.appendChild(li);
  else prev.li.replaceWith(li);
  const card = hydrateCard(li, stall.id, structure);
  session.cards.set(stall.id, card);
  return card;
}

/** 單卡就地更新：文字、屬性、class；model 全部來自快照，UI 不計算數值。 */
function updateCard(card: CardRefs, stall: StallSnapshot, onboardingOn: boolean): void {
  if (card.structure === 'locked') {
    setBtnState(card.unlockBtn, `解鎖 ${formatMoney(stall.unlockCost ?? 0)}`, stall.canUnlock);
    // UX #10：錢夠的時候「可解鎖」要有明顯強調。
    card.unlockBtn.classList.toggle('btn--ready', stall.canUnlock);
    return;
  }

  setText(card.level, `Lv.${stall.level}`);
  setText(card.income, `+${formatMoney(stall.incomePerSec)}/秒`);

  const pct = progressPercent(stall);
  card.progress.setAttribute('aria-valuenow', String(pct));
  card.progress.style.setProperty('--pct', `${pct}%`);
  const milestone = stall.nextMilestone;
  card.progressLabel.hidden = milestone === null;
  if (milestone !== null) {
    setText(card.progressLabel, `→ Lv${milestone.level} 收益 ×${milestone.multiplier}`);
  }

  // UX #2：狀態標籤。data-state 給 CSS 上色用（營業中／顧攤 = accent 色）。
  const state = stall.clerkHired ? 'clerk' : stall.selling ? 'selling' : 'idle';
  setText(card.status, statusText(stall));
  if (card.status.dataset.state !== state) card.status.dataset.state = state;

  setBtnState(
    card.upgradeBtn,
    stall.upgradeCost === null ? '已達上限' : `升級 ${formatMoney(stall.upgradeCost)}`,
    stall.canUpgrade,
  );

  if (card.sellBtn !== null) {
    // UX #2：sell 按鈕維持動作文案；UX #1：開局引導時讓它發光。
    setText(card.sellBtn, stall.selling ? '收攤' : '開賣');
    card.sellBtn.classList.toggle('btn--glow', onboardingOn);
  }
  if (card.hireBtn !== null) {
    setBtnState(
      card.hireBtn,
      `雇店員 ${formatMoney(stall.hireCost ?? 0)}`,
      stall.canHire,
    );
  }
}

/* ---- 動作成功回饋（UX #4）：卡片亮一下、數字跳一下 ---- */

/** 動畫結束監聽；重觸發時先移除舊的，避免殘留的 once 監聽提前砍掉新動畫。 */
const animationEndListeners = new WeakMap<HTMLElement, (event: Event) => void>();

/** 重啟（restart）一個 CSS class 動畫：移除 → 強制 reflow → 加回。 */
function retrigger(el: HTMLElement, className: string): void {
  const old = animationEndListeners.get(el);
  if (old !== undefined) {
    el.removeEventListener('animationend', old);
    animationEndListeners.delete(el);
  }
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  const onEnd = (): void => {
    el.classList.remove(className);
    animationEndListeners.delete(el);
  };
  el.addEventListener('animationend', onEnd, { once: true });
  animationEndListeners.set(el, onEnd);
}

function flashCard(session: RenderSession, stallId: string): void {
  const card = session.cards.get(stallId);
  if (card === undefined) return;
  retrigger(card.li, 'stall--flash');
  const numbers: Array<HTMLElement | null> =
    card.structure === 'locked' ? [card.unlockBtn] : [card.level, card.income];
  for (const el of numbers) {
    if (el instanceof HTMLElement) retrigger(el, 'pop-num');
  }
}

/* ---- 對外：每 250ms 的 tick 或一次動作之後都會呼叫 ---- */

/**
 * M2 主畫面更新。第一次呼叫建立骨架與卡片結構，之後只更新文字／屬性。
 * `feedbackStallId`：store 在升級／雇用／解鎖**成功**後傳入該攤位 id（觸發一次
 * 回饋動畫），普通的 tick 呼叫不需要傳。
 * `offline !== null` 時彈窗顯示該次離線／長空檔收益（金額一律用引擎給的值，
 * UI 不重算，GDD §6）。
 */
export function renderApp(
  root: HTMLElement,
  snapshot: GameSnapshot,
  offline: OfflineSettlement | null,
  feedbackStallId: string | null = null,
): void {
  let session = sessions.get(root);
  if (session === undefined) {
    session = buildSession(root);
    sessions.set(root, session);
  }

  const onboardingOn = onboardingActive(snapshot);
  session.onboarding.hidden = !onboardingOn;
  setText(session.balance, formatMoney(snapshot.balance));
  setText(session.incomeTop, `+${formatMoney(snapshot.incomePerSec)}/秒`);
  setText(session.clerkTop, snapshot.anyClerkHired ? '店員顧攤中' : '自己顧攤');

  session.modal.hidden = offline === null;
  setText(session.amount, offline === null ? '—' : `+${formatMoney(offline.gained)}`);
  setText(session.duration, offline === null ? '—' : formatDuration(offline.creditedMs));
  session.capHint.hidden = !(offline?.capped ?? false);
  if (offline?.capped === true) setText(session.capHint, CAP_HINT_TEXT);

  const seen = new Set<string>();
  for (const stall of snapshot.stalls) {
    seen.add(stall.id);
    let card = session.cards.get(stall.id);
    if (card === undefined || card.structure !== cardStructure(stall)) {
      card = mountCard(session, stall);
    }
    updateCard(card, stall, onboardingOn);
  }
  // 防禦：快照裡已消失的攤位卡一併移除（正常不會發生，攤位固定 5 張）。
  for (const [id, card] of [...session.cards]) {
    if (!seen.has(id)) {
      card.li.remove();
      session.cards.delete(id);
    }
  }

  if (feedbackStallId !== null) flashCard(session, feedbackStallId);
}
