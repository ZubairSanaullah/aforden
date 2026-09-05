import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
    test: {
        environment: "node",
        globals: false,
        maxWorkers: 2,
        testTimeout: 30000,
        hookTimeout: 30000,
        coverage: {
            provider: "v8",
            reporter: ["text", "json-summary"],
            include: ["app/**", "lib/**", "auth.ts", "proxy.ts", "instrumentation.ts"],
            exclude: [
                "node_modules/**",
                "tests/**",
                "**/*.test.ts",
                "**/*.spec.ts",
                "**/*.d.ts",
                "generated/**",
                ".next/**",
            ],
        },
    },

    resolve: {
        alias: {
            "@": path.resolve(__dirname, "."),
        },
    },
});