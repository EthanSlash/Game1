import { describe, expect, it } from 'vitest';
import { formatMoney } from '../../src/core';

describe('formatMoney', () => {
  it('四位數以內直接顯示整數（向下取整）', () => {
    expect(formatMoney(0)).toBe('0');
    expect(formatMoney(1)).toBe('1');
    expect(formatMoney(999)).toBe('999');
    expect(formatMoney(9999)).toBe('9999');
    expect(formatMoney(9999.99)).toBe('9999');
  });

  it('邊界轉換：1萬 / 1億 / 1兆', () => {
    expect(formatMoney(9999)).toBe('9999');
    expect(formatMoney(10_000)).toBe('1萬');
    expect(formatMoney(99_999_999)).toBe('9999.99萬');
    expect(formatMoney(100_000_000)).toBe('1億');
    expect(formatMoney(999_999_999_999)).toBe('9999.99億');
    expect(formatMoney(1e12)).toBe('1兆');
    expect(formatMoney(1e12 * 3)).toBe('3兆');
  });

  it('保留最多小數 2 位並去掉尾端 0', () => {
    expect(formatMoney(12_345)).toBe('1.23萬');
    expect(formatMoney(15_000)).toBe('1.5萬');
    expect(formatMoney(20_000)).toBe('2萬');
    expect(formatMoney(123_456_789)).toBe('1.23億');
  });

  it('負數保留符號', () => {
    expect(formatMoney(-1)).toBe('-1');
    expect(formatMoney(-10_000)).toBe('-1萬');
  });

  it('非有限數字丟 RangeError', () => {
    expect(() => formatMoney(Number.NaN)).toThrow(RangeError);
    expect(() => formatMoney(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
