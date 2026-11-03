import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { initPool } from "./db/pool.js";

const config = loadConfig();
if (config.databaseUrl) initPool(config.databaseUrl);

const app = buildApp(config);
const close = async () => {
  await app.close();
};
process.on("SIGINT", () => {
  void close().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void close().then(() => process.exit(0));
});

await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`API em http://127.0.0.1:${config.port}`);
console.log("Para encerrar, use Ctrl+C neste terminal.");
