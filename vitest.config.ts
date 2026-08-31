import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
    test: {
        environment: "node",
        globals: false,
        maxWorkers: 3,
    },

    resolve: {
        alias: {
            "@": path.resolve(__dirname, "."),
        },
    },
});