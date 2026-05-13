// Type declarations for puppeteer-extra-plugin-stealth sub-path imports.
// The evasion modules do not ship TypeScript types; declare them as any so
// the static import() literals in fetchHtmlViaHeadless.ts compile cleanly.
declare module "puppeteer-extra-plugin-stealth/evasions/*";
