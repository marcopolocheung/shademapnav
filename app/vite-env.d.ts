/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FOURSQUARE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
