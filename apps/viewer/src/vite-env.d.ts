/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Short-lived Bunny directory-token query generated for local CDN debugging.
   * Never put the Pull Zone security key here.
   */
  readonly VITE_FPSR_CDN_TOKEN_QUERY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
