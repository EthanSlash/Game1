import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 單元測試（開發者自寫）+ 黑箱驗收（MiniMax31 只照 GDD 寫，不看實作）
    include: ['tests/unit/**/*.test.ts', 'tests/acceptance/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/*.d.ts'],
      // 團隊規則：core 覆蓋率 >= 90%（M1 起適用）
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
