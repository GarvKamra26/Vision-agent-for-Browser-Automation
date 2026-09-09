import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
    build: {
        rollupOptions: {
            input: resolve(process.cwd(), "src/content.js"),

            output: {
                format: "iife",
                entryFileNames: "content.js"
            }
        },

        outDir: "dist",
        emptyOutDir: true
    }
});