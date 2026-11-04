import { loadConfig } from "./config.js";
import { closePool, initPool } from "./db/pool.js";
import { startWorker } from "./modules/outbox/worker.js";

const config = loadConfig();
if (!config.databaseUrl) {
  console.error("DATABASE_URL ausente. Copie .env.example para .env.");
  process.exit(1);
}

initPool(config.databaseUrl);
const worker = startWorker();
console.log("Worker da outbox em execução.");
console.log("Para encerrar, use Ctrl+C neste terminal.");

const close = async () => {
  await worker.stop();
  await closePool();
};
process.on("SIGINT", () => {
  void close().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void close().then(() => process.exit(0));
});
