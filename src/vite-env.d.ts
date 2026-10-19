/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The online relay, baked in at build time (see docs/deploy-multiplayer.md):
   * a wss:// URL, or "same-origin" when the relay serves the page itself.
   */
  readonly VITE_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
