import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "./config": process.env.UPLOAD_DEMO_ENV === "prod"
        ? "./config.prod.js"
        : "./config.dev.js",
    },
  },
});
