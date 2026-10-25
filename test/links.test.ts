import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractLinks,
  isRepositoryPath,
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

  it.each([
    ['POSIX', posix, '/workspace/repo'],
    ['Windows drive', win32, 'C:\\workspace\\repo'],
    ['Windows UNC', win32, '\\\\server\\share\\repo'],
  ] as const)('checks containment with %s path semantics', (_, paths, root) => {
    for (const directory of [root, root + paths.sep]) {
      expect(isRepositoryPath(root, directory, paths)).toBe(true);
      expect(
        isRepositoryPath(
          paths.join(root, 'docs', 'guide.md'),
          directory,
          paths,
        ),
      ).toBe(true);
      expect(
        isRepositoryPath(
          paths.join(root, 'docs', '..', 'README.md'),
          directory,
          paths,
        ),
      ).toBe(true);
      expect(
        isRepositoryPath(paths.join(root, '..notes.md'), directory, paths),
      ).toBe(true);
      expect(isRepositoryPath(paths.dirname(root), directory, paths)).toBe(
        false,
      );
      expect(
        isRepositoryPath(
          paths.join(root, '..', 'outside.md'),
          directory,
          paths,
        ),
      ).toBe(false);
      expect(
        isRepositoryPath(
          root + '-sibling' + paths.sep + 'guide.md',
          directory,
          paths,
        ),
      ).toBe(false);
    }
  });

  it('handles Windows case and mixed separators without accepting another drive or share', () => {
    expect(
      isRepositoryPath(
        'c:/WORKSPACE/repo/docs/guide.md',
        'C:\\workspace\\repo',
        win32,
      ),
    ).toBe(true);
    expect(
      isRepositoryPath(
        'D:\\workspace\\repo\\guide.md',
        'C:\\workspace\\repo',
        win32,
      ),
    ).toBe(false);
    expect(
      isRepositoryPath(
        '\\\\server\\other\\repo\\guide.md',
        '\\\\server\\share\\repo',
        win32,
      ),
    ).toBe(false);
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
    await expect(
      validateLocalLink(source, '../outside.md', directory),
    ).rejects.toThrow('escapes the repository');
    await expect(
      validateLocalLink(source, '%2e%2e/outside.md', directory),
    ).rejects.toThrow('escapes the repository');
  });
});
