// Memuat .env.local (lalu .env) untuk skrip CLI. Next.js memuatnya sendiri saat runtime.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
