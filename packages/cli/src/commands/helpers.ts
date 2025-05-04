import path from 'path';
import { promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';
import fetch, { type RequestInit, type Response } from 'node-fetch';
import process from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// If you move the helpers file, you need to update this path
const templatesBasePath = path.resolve(__dirname, '../../templates');

export async function renderPackageJson(
  projectName: string,
  templatesPath: string,
  version?: string
) {
  const templatePath = path.join(templatesPath, 'package.json.tpl');
  const template = await fsPromises.readFile(templatePath, 'utf-8');

  // Check for POSITRONIC_LOCAL_PATH, if set, use it to replace @positronic/core with a local path for doing development work on the core package
  const devRootPath = process.env.POSITRONIC_LOCAL_PATH;

  let renderedTemplate = template.replace(/{{projectName}}/g, projectName);
  const packageJson = JSON.parse(renderedTemplate);
  for (const dependency of Object.keys(packageJson.dependencies)) {
    if (dependency.startsWith('@positronic/')) {
      if (devRootPath) {
        const packageName = dependency.replace('@positronic/', '');
        const coreDevPath = path.join(devRootPath, 'packages', packageName);
        packageJson.dependencies[dependency] = `file:${coreDevPath}`;
      } else if (version) {
        packageJson.dependencies[dependency] = version;
      }
    }
  }

  return packageJson;
}

// API Fetch Helper
export async function apiFetch(apiPath: string, options?: RequestInit): Promise<Response> {
    const port = process.env.POSITRONIC_SERVER_PORT || '8787';
    const baseUrl = `http://localhost:${port}`;
    const fullUrl = `${baseUrl}${apiPath.startsWith('/') ? apiPath : '/' + apiPath}`;

    const response = await fetch(fullUrl, options);
    return response;
}