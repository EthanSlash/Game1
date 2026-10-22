import { describe, expect, it } from 'vitest';

/**
 * F. 數字格式（萬 / 億 / 兆）—— GDD v1.1 §7 的規則表。
 *
 * §7 已經把縮寫單位、小數位數、取整方向、負數與非有限值的處理全部寫死，
 * 所以這裡直接照表驗收（不是「等 GDD 鎖定再寫」）。
 *
 * 規則摘要：
 * 1. 絕對值 < 10000 → 向下取整顯示整數。
 * 2. >= 1e4 → 萬；>= 1e8 → 億；>= 1e12 → 兆（取最大的適用單位）。
 * 3. 縮寫後最多 2 位小數、**向下取**，並去掉尾端 0。
 * 4. 負數保留 `-`。
 * 5. NaN / Infinity → RangeError。
 *
 * 這裡用執行期動態 import `src/core` 的公開進入點：M1 若搬走這個匯出，
 * 報錯會是「缺少 formatMoney」而不是整批編譯壞掉（別人的 PR 不該被我的測試卡住）。
 */
const core = (await import('../../src/core')) as unknown as {
  formatMoney?: (amount: number) => string;
};

function formatMoney(amount: number): string {
  if (typeof core.formatMoney !== 'function') {
    throw new Error('src/core 的公開進入點沒有匯出 formatMoney（GDD §7 要求顯示層一律走它）');
  }
  return core.formatMoney(amount);
}

describe('F. 數字格式（GDD §7）', () => {
  it('F1 10000 以內不縮寫，向下取整', () => {
    expect(formatMoney(0)).toBe('0');
    expect(formatMoney(999)).toBe('999');
    expect(formatMoney(9_999)).toBe('9999');
    expect(formatMoney(9_999.99)).toBe('9999');
  });

  it('F2 1e4 起縮寫成萬', () => {
    expect(formatMoney(10_000)).toBe('1萬');
    expect(formatMoney(12_345)).toBe('1.23萬');
    expect(formatMoney(15_000)).toBe('1.5萬');
    expect(formatMoney(20_000)).toBe('2萬');
  });

  it('F3 1e8 起縮寫成億', () => {
    expect(formatMoney(100_000_000)).toBe('1億');
    expect(formatMoney(123_456_789)).toBe('1.23億');
  });

  it('F4 1e12 起縮寫成兆', () => {
    expect(formatMoney(1e12)).toBe('1兆');
  });

  it('F5 邊界值照 §7 的表', () => {
    const table: readonly (readonly [number, string])[] = [
      [0, '0'],
      [999, '999'],
      [9_999, '9999'],
      [9_999.99, '9999'],
      [10_000, '1萬'],
      [12_345, '1.23萬'],
      [15_000, '1.5萬'],
      [99_999_999, '9999.99萬'],
      [100_000_000, '1億'],
      [123_456_789, '1.23億'],
      [999_999_999_999, '9999.99億'],
      [1e12, '1兆'],
    ];
    for (const [input, expected] of table) {
      expect(formatMoney(input), `formatMoney(${input})`).toBe(expected);
    }
  });

  it('F5 縮寫後的小數是向下取，不誇大持有金額', () => {
    // 1.2399 萬 → 1.23 萬（不是 1.24 萬）。
    expect(formatMoney(12_399)).toBe('1.23萬');
    // 尾端 0 要去掉。
    expect(formatMoney(20_000)).toBe('2萬');
  });

  it('F5 負數保留符號', () => {
    expect(formatMoney(-1)).toBe('-1');
    expect(formatMoney(-10_000)).toBe('-1萬');
  });

  it('F5 非有限數字丟 RangeError', () => {
    expect(() => formatMoney(Number.NaN)).toThrow(RangeError);
    expect(() => formatMoney(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => formatMoney(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });
});
