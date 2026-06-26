import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Tauri 期望固定端口;预览/CI 可用 PORT 覆盖,避免端口占用阻塞。
  server: { port: Number(process.env.PORT) || 5180, strictPort: false },
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@antv/x6")) return "vendor-x6";
          if (id.includes("node_modules")) return "vendor-core";
        },
      },
    },
  },
});
