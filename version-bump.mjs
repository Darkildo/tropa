import { readFileSync, writeFileSync } from "node:fs";

// npm version runs this: the manifest gets the new version, versions.json maps it to minAppVersion.
const version = process.env.npm_package_version;
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = version;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[version] = manifest.minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`);
