// Reports which public workspace packages have a local version that is not on
// npm yet, and writes `pending=true|false` to $GITHUB_OUTPUT.
//
// --require-existing: exit 1 if a public package has never been published.
// npm trusted publishing (OIDC) cannot create a package, so `changeset publish`
// would fail for it after its dependents went out pinned to a version that does
// not exist (privacy-pools@0.1.0-alpha.29 -> poseidon@0.0.0).
/* global console, fetch, process */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const REGISTRY = 'https://registry.npmjs.org';
const requireExisting = process.argv.includes('--require-existing');

const workspace = JSON.parse(
  execFileSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], { encoding: 'utf8' }),
);
const packages = workspace.filter((pkg) => !pkg.private && pkg.name && pkg.version);

async function publishedVersions(name) {
  const response = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  });

  if (response.status === 404) return null;

  if (!response.ok) throw new Error(`${name}: registry returned HTTP ${response.status}`);

  return Object.keys((await response.json()).versions ?? {});
}

const pending = [];
const neverPublished = [];

for (const { name, version } of packages) {
  const versions = await publishedVersions(name);

  if (versions === null) neverPublished.push(`${name}@${version}`);

  if (!versions?.includes(version)) pending.push(`${name}@${version}`);
}

console.log(pending.length > 0
  ? `Not on npm yet: ${pending.join(', ')}`
  : 'Every public package version is already on npm.');

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `pending=${pending.length > 0}\n`);
}

if (requireExisting && neverPublished.length > 0) {
  console.log(
    `::error::Not publishing anything: ${neverPublished.join(', ')} has never been published, and trusted ` +
    'publishing cannot create a package. A maintainer must publish its first version by hand and add the ' +
    'trusted publisher on npmjs.com, then re-run this workflow.',
  );
  process.exit(1);
}
