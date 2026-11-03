// esbuild (locales.esbuild.mjs) and the test setup load translation files packed, as base64 text, so only the active one is unpacked.
declare module "*.json" {
  const text: string;
  export default text;
}
