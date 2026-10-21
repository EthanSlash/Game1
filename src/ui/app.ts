import { formatMoney } from '../core';
import type { Snapshot, StallView } from '../core';

function renderStall(stall: StallView): string {
  const status = stall.unlocked
    ? `Lv.${stall.level} ・ +${formatMoney(stall.incomePerSec)}/秒`
    : '尚未解鎖';

  return `
    <li class="stall${stall.unlocked ? '' : ' stall--locked'}">
      <span class="stall__name">${stall.name}</span>
      <span class="stall__status">${status}</span>
    </li>
  `;
}

/**
 * 骨架期畫面：只把 Snapshot 畫出來，沒有任何互動。
 * M2（行動版 UI）會整個改寫這裡，接上真正的引擎與操作（升級 / 雇用 / 解鎖）。
 */
export function renderApp(root: HTMLElement, snapshot: Snapshot): void {
  const totalIncome = snapshot.stalls.reduce((sum, stall) => sum + stall.incomePerSec, 0);

  root.innerHTML = `
    <header class="top">
      <h1 class="top__title">夜市攤王</h1>
      <p class="top__balance">${formatMoney(snapshot.balance)}</p>
      <p class="top__income">+${formatMoney(totalIncome)}/秒
        <span class="top__clerk">${snapshot.clerkHired ? '店員顧攤中' : '自己顧攤'}</span>
      </p>
    </header>
    <main>
      <h2 class="section-title">攤位</h2>
      <ul class="stalls">${snapshot.stalls.map(renderStall).join('')}</ul>
      <p class="note">M0 骨架：假資料畫面，引擎（M1）與 UI（M2）尚未接上。</p>
    </main>
  `;
}
