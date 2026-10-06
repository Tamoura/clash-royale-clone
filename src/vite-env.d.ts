/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** wss:// URL of the online relay, baked in at build time (see docs/deploy-multiplayer.md). */
  readonly VITE_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
