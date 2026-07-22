import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__probe.test.ts"],
    server: {
      deps: {
        inline: ["@excalidraw/excalidraw", "roughjs"],
      },
    },
  },
});
