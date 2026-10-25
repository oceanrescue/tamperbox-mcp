import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractLinks,
  markdownAnchors,
  validateFirstPartyLink,
  validateLocalLink,
} from '../scripts/check-links.mjs';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('repository link checker', () => {
  it('extracts inline, reference and HTML links but ignores code fences', () => {
    const links = extractLinks(`
[Inline](docs/guide.md#setup)
[Reference]: https://example.com/reference
<a href="https://example.com/html">HTML</a>
\`\`\`
[Ignored](missing.md)
\`\`\`
`);
    expect(links.map(({ target }) => target)).toEqual([
      'docs/guide.md#setup',
      'https://example.com/reference',
      'https://example.com/html',
    ]);
  });

  it('creates GitHub-style anchors including duplicate suffixes', () => {
    expect(markdownAnchors('# Setup!\n## Setup!\n<a id="manual"></a>')).toEqual(
      new Set(['setup', 'setup-1', 'manual']),
    );
  });

  it('accepts contract-backed tool links and rejects unknown routes', () => {
    const pages = new Set(['/json-to-yaml']);
    expect(() =>
      validateFirstPartyLink('https://tamperbox.dev/json-to-yaml', pages),
    ).not.toThrow();
    expect(() =>
      validateFirstPartyLink(
        'https://docs.tamperbox.dev/tools/json-to-yaml/',
        pages,
      ),
    ).not.toThrow();
    expect(() =>
      validateFirstPartyLink('https://tamperbox.dev/json-to-yml', pages),
    ).toThrow('unknown Tamperbox page /json-to-yml');
  });

  it('accepts existing files and anchors and rejects missing anchors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tamperbox-links-'));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, 'docs'));
    const source = join(directory, 'README.md');
    await writeFile(source, '[Guide](docs/guide.md#start)');
    await writeFile(join(directory, 'docs/guide.md'), '# Start\n');
    await expect(
      validateLocalLink(source, 'docs/guide.md#start', directory),
    ).resolves.toBeUndefined();
    await expect(
      validateLocalLink(source, 'docs/guide.md#missing', directory),
    ).rejects.toThrow('missing anchor #missing');
  });
});
