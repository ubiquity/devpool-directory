import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["build/index.ts"],
  project: ["src/**/*.ts"],
  ignore: ["src/types/config.ts"],
  ignoreExportsUsedInFile: true,
  // We ignore ts-node because it is used by Jest to read the TypeScript configuration
  ignoreDependencies: ["ts-node"],
};

export default config;
