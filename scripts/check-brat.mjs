import { access, readFile } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

async function readJsonFile(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

async function assertReadable(path, label) {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    throw new Error(`${label} is missing or unreadable: ${path}`);
  }
}

function assertManifestFields(manifest) {
  const required = ['id', 'name', 'version', 'minAppVersion'];
  for (const key of required) {
    if (!String(manifest[key] ?? '').trim()) {
      throw new Error(`manifest.json is missing required field: ${key}`);
    }
  }
}

async function main() {
  const pkgPath = join(ROOT, 'package.json');
  const manifestPath = join(ROOT, 'manifest.json');
  const mainPath = join(ROOT, 'main.js');
  const stylesPath = join(ROOT, 'styles.css');

  const [pkg, manifest] = await Promise.all([
    readJsonFile(pkgPath),
    readJsonFile(manifestPath),
  ]);

  if (pkg.version !== manifest.version) {
    throw new Error(
      `package.json and manifest.json versions differ: package=${pkg.version} manifest=${manifest.version}`
    );
  }

  assertManifestFields(manifest);

  await Promise.all([
    assertReadable(manifestPath, 'manifest.json'),
    assertReadable(mainPath, 'main.js'),
    assertReadable(stylesPath, 'styles.css'),
  ]);

  console.log(
    `BRAT check passed for Hive plugin v${pkg.version}. Assets ready: manifest.json, main.js, styles.css`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
