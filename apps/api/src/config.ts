import { config as loadEnv } from "dotenv";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });

export type AppConfig = {
  databaseUrl: string | undefined;
  sessionSecret: string;
  webOrigin: string;
  port: number;
  embedWorker: boolean;
};

export function loadConfig(): AppConfig {
  return {
    databaseUrl: process.env.DATABASE_URL || undefined,
    sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString("hex"),
    webOrigin: process.env.WEB_ORIGIN || "http://localhost:5173",
    port: Number(process.env.PORT || 3000),
    embedWorker: process.env.ACCESSFLOW_EMBED_WORKER === "true",
  };
}
