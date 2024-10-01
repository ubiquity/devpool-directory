import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    setupNodeEvents() {
      // implement node event listeners here
    },
    experimentalStudio: true,
    baseUrl: "http://localhost:8080",
  },
});
