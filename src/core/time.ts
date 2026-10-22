/**
 * 秒 ↔ 毫秒轉換的唯一實作（GDD §1「時間單位鐵則」）。
 *
 * 設定值（`capSeconds`、`foreground.maxGapSeconds`、`save.foregroundIntervalSeconds`）是秒，
 * 執行期欄位（`now`、`elapsedMs`、`creditedMs`、`lastSettledAt`）是毫秒。
 * repo 內只允許透過這支函式做換算，避免 `* 1000` 散落各處。
 */

const MS_PER_SECOND = 1000;

export function secondsToMs(seconds: number): number {
  return seconds * MS_PER_SECOND;
}
