import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["build/index.ts"],
  project: ["src/**/*.ts"],
  ignore: ["src/types/config.ts", "**/__mocks__/**", "**/__fixtures__/**"],
  ignoreExportsUsedInFile: true,
  // We ignore ts-node because it is used by Jest to read the TypeScript configuration
  // eslint can also be safely ignored as per the docs: https://knip.dev/guides/handling-issues#eslint--jest
  ignoreDependencies: ["ts-node", "eslint-config-prettier", "eslint-plugin-prettier", "@types/jest", "@mswjs/data"],
  eslint: true,
};

export default config;
