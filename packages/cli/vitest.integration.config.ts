import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/integration/**/*.integration.test.ts', 'test/system/**/*.system.test.ts'],
		globals: true,
		environment: 'node',
	},
});
