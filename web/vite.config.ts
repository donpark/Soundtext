import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pre-bundle the speech stack at startup. Discovered on-demand, they trigger
  // a dep re-optimization + full page reload mid-session (which also kills any
  // in-flight automation evaluate context).
  optimizeDeps: {
    include: ["@huggingface/transformers", "@ricky0123/vad-web"],
  },
});
