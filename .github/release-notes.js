// Writes the text for a GitHub Release: what each download is (from
// RELEASE_NOTES.md), then what's new in this version (from CHANGELOG.md).
// Used by the release workflow: node .github/release-notes.js > notes.md
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// The part of the changelog under "## <version>", up to the next version.
const changelog = read('CHANGELOG.md');
const start = changelog.search(new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?\\s*$`, 'm'));
if (start < 0) {
  console.error(`CHANGELOG.md has no "## ${version}" section. Add one before releasing.`);
  process.exit(1);
}
const rest = changelog.slice(start).split('\n').slice(1).join('\n');
const end = rest.search(/^## /m);
const changes = (end < 0 ? rest : rest.slice(0, end)).trim().replace(/^### /gm, '#### ');

process.stdout.write(`## What's new in ${version}\n\n${changes}\n\n${read('RELEASE_NOTES.md').replace(/\{version\}/g, version)}`);
