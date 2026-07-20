import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite's config. The react() plugin teaches Vite how to compile JSX
// (the <Component /> syntax) into plain JavaScript the browser understands.
export default defineConfig({
  plugins: [react()],
});
