// Server-side environment access. Never import this from client components.

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Environment variable ${name} belum diisi. Salin .env.example menjadi .env.local lalu isi nilainya.`,
    );
  }
  return value.trim();
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

export const embeddingConfig = () => ({
  apiKey: requireEnv("EMBEDDING_API_KEY"),
  model: optionalEnv("EMBEDDING_MODEL", "voyage-4"),
  dimensions: Number(optionalEnv("EMBEDDING_DIMENSIONS", "1024")),
});
