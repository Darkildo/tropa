// esbuild (locales.esbuild.mjs) and the test setup load translation files as text (their values in the order of the English keys), so only the active one is parsed.
declare module "*.json" {
  const text: string;
  export default text;
}
