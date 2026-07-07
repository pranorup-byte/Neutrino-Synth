import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// When building for GitHub Pages the site is served from
// https://<user>.github.io/<repo>/ , so assets need a sub-path base.
// The deploy workflow sets BASE_PATH; local dev/build defaults to "/".
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || "/",
});
