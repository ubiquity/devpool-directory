import esbuild from "esbuild";
import { esbuildOptions } from "./esbuild-build";

void (async () => {
  try {
    await server();
  } catch (error) {
    console.error("Unhandled error:", error);
    process.exit(1);
  }
})();

export async function server() {
  const context = await esbuild.context(esbuildOptions);
  const { host, port } = await context.serve({
    servedir: "static",
    port: 8080,
  });
  console.log(`Server running at http://${host}:${port}`);
}
