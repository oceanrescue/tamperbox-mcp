import { execFileSync } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import path, { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const reachableRestrictedStatuses = new Set([401, 403, 405, 429]);

export function markdownAnchors(markdown) {
  const anchors = new Set();
  const occurrences = new Map();
  const withoutFences = markdown.replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, '');
  for (const line of withoutFences.split('\n')) {
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (heading) {
      const base = heading
        .toLowerCase()
        .replace(/<[^>]*>/g, '')
        .replace(/[`*_~]/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-');
      const count = occurrences.get(base) ?? 0;
      occurrences.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
    for (const match of line.matchAll(
      /<(?:a\s+[^>]*(?:id|name)|[^>]+\sid)=["']([^"']+)["'][^>]*>/gi,
    ))
      anchors.add(match[1]);
  }
  return anchors;
}

export function extractLinks(markdown) {
  const links = [];
  let fenced = false;
  for (const [index, line] of markdown.split('\n').entries()) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const add = (raw) => {
      const target = raw
        .trim()
        .replace(/^<|>$/g, '')
        .split(/\s+["']/)[0];
      if (target && !target.startsWith('!'))
        links.push({ target, line: index + 1 });
    };
    for (const match of line.matchAll(
      /!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/g,
    ))
      add(match[1]);
    for (const match of line.matchAll(/^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/g))
      add(match[1]);
    for (const match of line.matchAll(
      /<(?:a|img)\s+[^>]*(?:href|src)=["']([^"']+)["'][^>]*>/gi,
    ))
      add(match[1]);
    for (const match of line.matchAll(/<(https?:\/\/[^>]+)>/gi)) add(match[1]);
  }
  return links;
}

export function validateFirstPartyLink(target, toolPages) {
  const url = new URL(target);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (
    url.hostname === 'tamperbox.dev' ||
    url.hostname === 'www.tamperbox.dev'
  ) {
    if (
      path === '/' ||
      path === '/pipeline' ||
      path === '/privacy' ||
      path === '/terms' ||
      toolPages.has(path)
    )
      return;
    throw new Error(`unknown Tamperbox page ${path}`);
  }
  if (url.hostname === 'docs.tamperbox.dev') {
    if (path.startsWith('/tools/')) {
      const toolPath = path.slice('/tools'.length);
      if (toolPages.has(toolPath)) return;
      throw new Error(`unknown Tamperbox documentation page ${path}`);
    }
    if (
      path === '/' ||
      path === '/llms.txt' ||
      path === '/mcp' ||
      path === '/tools' ||
      path.startsWith('/mcp/') ||
      path.startsWith('/reference/')
    )
      return;
    throw new Error(`unknown Tamperbox documentation page ${path}`);
  }
  if (url.hostname === 'mcp.tamperbox.dev' && path === '/mcp') return;
  throw new Error('not a first-party Tamperbox link');
}

export function isRepositoryPath(target, repositoryRoot, paths = path) {
  const relative = paths.relative(
    paths.resolve(repositoryRoot),
    paths.resolve(target),
  );
  return (
    relative !== '..' &&
    !relative.startsWith(`..${paths.sep}`) &&
    !paths.isAbsolute(relative)
  );
}

export async function validateLocalLink(source, target, repositoryRoot = root) {
  if (/^(?:mailto:|tel:|data:|javascript:)/i.test(target)) return;
  const [rawPath, rawFragment] = target.split('#', 2);
  const targetPath = rawPath
    ? resolve(dirname(source), decodeURIComponent(rawPath.split('?')[0]))
    : source;
  if (!isRepositoryPath(targetPath, repositoryRoot))
    throw new Error('escapes the repository');
  await access(targetPath);
  const targetStat = await stat(targetPath);
  if (!rawFragment || targetStat.isDirectory()) return;
  if (extname(targetPath).toLowerCase() !== '.md') return;
  const fragment = decodeURIComponent(rawFragment).toLowerCase();
  const anchors = markdownAnchors(await readFile(targetPath, 'utf8'));
  if (!anchors.has(fragment)) throw new Error(`missing anchor #${fragment}`);
}

async function fetchLink(url) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      let response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'tamperbox-mcp-link-check/1.0' },
      });
      if (response.status === 501)
        response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'user-agent': 'tamperbox-mcp-link-check/1.0',
            range: 'bytes=0-0',
          },
        });
      if (
        (response.status >= 200 && response.status < 400) ||
        reachableRestrictedStatuses.has(response.status)
      )
        return;
      lastError = new Error(`HTTP ${response.status}`);
      if (response.status < 500) break;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function mapConcurrent(values, concurrency, visit) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        await visit(values[index]);
      }
    }),
  );
}

export async function checkRepositoryLinks(
  repositoryRoot = root,
  { liveFirstParty = false } = {},
) {
  const files = execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const failures = [];
  const remoteReferences = new Map();
  const contract = JSON.parse(
    await readFile(resolve(repositoryRoot, 'src/api-contract.json'), 'utf8'),
  );
  const openapi = JSON.parse(
    await readFile(resolve(repositoryRoot, 'src/openapi.json'), 'utf8'),
  );
  const toolPages = new Set(
    contract.operations.map(({ page }) => page).filter(Boolean),
  );
  for (const methods of Object.values(openapi.paths))
    for (const operation of Object.values(methods))
      if (operation && typeof operation === 'object')
        for (const id of operation['x-tamperbox-website-tool-ids'] ?? [])
          toolPages.add(`/${id}`);
  let linkCount = 0;

  for (const relative of files) {
    const source = resolve(repositoryRoot, relative);
    for (const link of extractLinks(await readFile(source, 'utf8'))) {
      linkCount += 1;
      if (/^https?:\/\//i.test(link.target)) {
        const url = new URL(link.target);
        const isPrivateGitHubEvidence =
          url.hostname === 'github.com' &&
          url.pathname.startsWith('/oceanrescue/tamperbox-mcp/');
        const isFirstParty =
          url.hostname === 'tamperbox.dev' ||
          url.hostname === 'www.tamperbox.dev' ||
          url.hostname === 'docs.tamperbox.dev' ||
          url.hostname === 'mcp.tamperbox.dev';
        if (isFirstParty && !liveFirstParty) {
          try {
            validateFirstPartyLink(link.target, toolPages);
          } catch (error) {
            failures.push(
              `${relative}:${link.line} ${link.target} (${error.message})`,
            );
          }
          continue;
        }
        if (isPrivateGitHubEvidence) continue;
        url.hash = '';
        const normalized = url.href;
        const references = remoteReferences.get(normalized) ?? [];
        references.push(`${relative}:${link.line}`);
        remoteReferences.set(normalized, references);
        continue;
      }
      try {
        await validateLocalLink(source, link.target, repositoryRoot);
      } catch (error) {
        failures.push(
          `${relative}:${link.line} ${link.target} (${error.message})`,
        );
      }
    }
  }

  await mapConcurrent(
    [...remoteReferences.entries()],
    8,
    async ([url, references]) => {
      try {
        await fetchLink(url);
      } catch (error) {
        failures.push(`${references.join(', ')} ${url} (${error.message})`);
      }
    },
  );

  if (failures.length)
    throw new Error(
      `Broken links:\n${failures.map((failure) => `- ${failure}`).join('\n')}`,
    );
  return {
    files: files.length,
    links: linkCount,
    remote: remoteReferences.size,
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    const result = await checkRepositoryLinks(root, {
      liveFirstParty: process.argv.includes('--live'),
    });
    process.stdout.write(
      `PASS links: ${result.links} references in ${result.files} Markdown files (${result.remote} unique remote URLs).\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
