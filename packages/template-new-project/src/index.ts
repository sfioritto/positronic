import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Eta } from 'eta';

export type Backend = 'cloudflare' | 'none';

export interface ScaffoldOptions {
  /** Project name. Used for the package name, wrangler config, and R2 bucket. */
  name: string;
  /** Directory to write the project into. Created if missing. */
  dest: string;
  /** Deployment backend. Defaults to 'cloudflare'. */
  backend?: Backend;
  /**
   * Root of a local positronic monorepo. When set, @positronic/* dependencies
   * are written as file: references into that checkout instead of npm ranges.
   * Defaults to POSITRONIC_LOCAL_PATH, and when that is unset, to
   * auto-detection when this package resolves from a monorepo checkout.
   */
  devRootPath?: string;
  /** Include CLAUDE.md in the generated project. Defaults to true. */
  claudeMd?: boolean;
  /**
   * Render only the files under this template subdirectory, writing them
   * directly into dest (without the subdirectory prefix).
   */
  subdir?: string;
}

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const templateRoot = path.join(packageRoot, 'template');

// Files whose names would otherwise affect this package's own repository.
const renames: Record<string, string> = {
  _gitignore: '.gitignore',
  _env: '.env',
  _npmrc: '.npmrc',
};

// The template files carry JS template literals, so `${}` must pass through
// untouched. Eta only recognizes its own tags, and with autoTrim off the
// output whitespace matches the source exactly.
const eta = new Eta({ autoEscape: false, autoTrim: false, useWith: true });

// When this package resolves from a positronic monorepo checkout rather than
// node_modules, generated projects should point at that checkout with file:
// references. POSITRONIC_LOCAL_PATH overrides the detection.
function defaultDevRootPath() {
  const fromEnv = process.env.POSITRONIC_LOCAL_PATH;
  if (fromEnv) return fromEnv;
  const realRoot = fs.realpathSync(packageRoot);
  if (realRoot.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
  const root = path.resolve(realRoot, '..', '..');
  const isMonorepo =
    fs.existsSync(path.join(root, 'packages', 'core')) &&
    fs.existsSync(path.join(root, 'packages', 'cloudflare'));
  return isMonorepo ? root : undefined;
}

function ownVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
  );
  return pkg.version as string;
}

function localOrRange(
  devRootPath: string | undefined,
  packageDir: string,
  range: string
) {
  if (!devRootPath) return range;
  const localPath = path.resolve(devRootPath, 'packages', packageDir);
  return fs.existsSync(localPath) ? `file:${localPath}` : range;
}

// The @positronic/* ranges below use this package's own version because the
// changeset config's `linked` group releases core, spec, cli, cloudflare,
// client-vercel, and this package in lockstep. gen-ui-components is not in
// that group today.
function templateData({
  name,
  backend = 'cloudflare',
  devRootPath = defaultDevRootPath(),
}: Pick<ScaffoldOptions, 'name' | 'backend' | 'devRootPath'>) {
  const range = `^${ownVersion()}`;
  const cloudflareVersion = localOrRange(devRootPath, 'cloudflare', range);
  // The 'none' backend has no package; an empty string keeps the config
  // field a string, which is what the CLI's backend loader expects.
  const backendPackage =
    backend === 'cloudflare'
      ? cloudflareVersion.startsWith('file:')
        ? cloudflareVersion
        : '@positronic/cloudflare'
      : '';

  return {
    name,
    projectName: name,
    backend,
    backendPackage,
    positronicCoreVersion: localOrRange(devRootPath, 'core', range),
    positronicCloudflareVersion: cloudflareVersion,
    positronicClientVercelVersion: localOrRange(
      devRootPath,
      'client-vercel',
      range
    ),
    positronicGenUIComponentsVersion: localOrRange(
      devRootPath,
      'gen-ui-components',
      range
    ),
  };
}

function listFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? listFiles(full, base)
      : [path.relative(base, full)];
  });
}

/**
 * Render the project template into `dest`. Pure file generation: no package
 * install, no git init. Callers layer those on when they want them.
 */
export function scaffoldProject(options: ScaffoldOptions) {
  const { dest, claudeMd = true, subdir } = options;

  if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
    throw new Error(
      `${dest} already exists and is not empty. Choose a new or empty directory.`
    );
  }

  const data = templateData(options);
  const files = listFiles(templateRoot)
    .filter((file) => claudeMd || file !== 'CLAUDE.md')
    .filter((file) => !subdir || file.startsWith(subdir + path.sep));

  for (const file of files) {
    const source = fs.readFileSync(path.join(templateRoot, file), 'utf8');
    const rendered = eta.renderString(source, data);
    const name = subdir ? path.relative(subdir, file) : file;
    const target = path.join(dest, renames[name] ?? name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, rendered);
  }
}
