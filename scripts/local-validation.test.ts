import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readText(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function readPackage(relativePath: string): { readonly scripts?: Readonly<Record<string, string>> } {
  return JSON.parse(readText(relativePath)) as { readonly scripts?: Readonly<Record<string, string>> };
}

describe('local validation and no-deploy script contracts', () => {
  it('keeps local and LAN development scripts bound to local machine/LAN hosts', () => {
    const root = readPackage('../package.json');
    const server = readPackage('../apps/server/package.json');
    const client = readPackage('../apps/client/package.json');
    const serverEntrypoint = readText('../apps/server/src/index.ts');

    expect(root.scripts?.dev).toContain('npm run dev');
    expect(root.scripts?.['dev:lan']).toContain('npm run dev:lan');
    expect(server.scripts?.dev).not.toContain('HOST=0.0.0.0');
    expect(serverEntrypoint).toContain("process.env.HOST ?? '127.0.0.1'");
    expect(server.scripts?.['dev:lan']).toContain('HOST=0.0.0.0');
    expect(client.scripts?.dev).toContain('--host 127.0.0.1');
    expect(client.scripts?.['dev:lan']).toContain('--host 0.0.0.0');
  });

  it('does not hide Azure deployment commands in npm validation scripts', () => {
    const packages = [
      readPackage('../package.json'),
      readPackage('../packages/game-engine/package.json'),
      readPackage('../apps/server/package.json'),
      readPackage('../apps/client/package.json')
    ];
    const prohibitedDeployment = /\b(?:azd\s+(?:up|deploy)|terraform\s+apply|az\s+deployment)\b/i;

    for (const packageJson of packages) {
      for (const script of Object.values(packageJson.scripts ?? {})) {
        expect(script).not.toMatch(prohibitedDeployment);
      }
    }
  });

  it('keeps Docker as a local build/run smoke artifact', () => {
    const dockerfile = readText('../Dockerfile');
    const dockerignore = readText('../.dockerignore');

    expect(dockerfile).toContain('RUN npm ci');
    expect(dockerfile).toContain('RUN npm run build');
    expect(dockerfile).toContain('HOST=0.0.0.0');
    expect(dockerfile).toContain('EXPOSE 8080');
    expect(dockerignore).toContain('.azure');
    expect(dockerignore).toContain('.env.*');
  });
});
