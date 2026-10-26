// Version, short commit and build date, stamped by vite.config.ts; tests and tools run without it.
declare const __BUILD__: string | undefined;
export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
