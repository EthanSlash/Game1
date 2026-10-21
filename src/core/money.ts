/**
 * 金額顯示：9999 / 1萬 / 1億 / 1兆。
 *
 * 注意：此檔為 M0 骨架的暫定實作（提供 UI 與測試用的確定行為）。
 * M1（核心經濟引擎）若依 GDD 需要不同取整規則（例如四捨五入、小數位數），
 * 以 GDD 為準覆蓋此檔並同步調整 tests/unit/money.test.ts。
 */

interface Unit {
  readonly value: number;
  readonly suffix: string;
}

/** 由大到小，第一個 <= 絕對值者即為顯示單位。 */
const UNITS: readonly Unit[] = [
  { value: 1e12, suffix: '兆' },
  { value: 1e8, suffix: '億' },
  { value: 1e4, suffix: '萬' },
];

/** 取到小數第 2 位（向下取，不誇大玩家持有金額），並去掉尾端 0。 */
function trimToHundredths(value: number): string {
  const truncated = Math.floor(value * 100) / 100;
  return truncated.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * 把金額轉為繁中短單位字串。小於 10000 顯示整數（向下取）。
 * @throws RangeError 當金額不是有限數字
 */
export function formatMoney(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`formatMoney 只接受有限數字，收到 ${String(amount)}`);
  }

  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);

  for (const unit of UNITS) {
    if (abs >= unit.value) {
      return `${sign}${trimToHundredths(abs / unit.value)}${unit.suffix}`;
    }
  }

  return `${sign}${Math.floor(abs)}`;
}
