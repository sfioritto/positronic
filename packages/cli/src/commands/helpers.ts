import fetch, { type RequestInit, type Response } from 'node-fetch';
import process from 'process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import caz from 'caz';

export async function generateProject(
    projectName: string,
    projectDir: string,
    onSuccess?: () => Promise<void> | void
) {
    const devPath = process.env.POSITRONIC_LOCAL_PATH;
    let newProjectTemplatePath = '@positronic/template-new-project';
    let cazOptions: { name: string, backend?: string, install?: boolean, pm?: string } = { name: projectName };

    try {
        if (devPath) {
            // Copying templates, why you ask?
            // Well because when caz runs if you pass it a path to the template module
            // it runs npm install --production in the template directory. This is a problem
            // in our monorepo because this messes up the node_modules at the root of the
            // monorepo which then causes the tests to fail. Also ny time I was generating a new
            // project it was a pain to have to run npm install over and over again just
            // to get back to a good state.
            const originalNewProjectPkg = path.resolve(devPath, 'packages', 'template-new-project');
            const copiedNewProjectPkg = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-newproj-'));
            fs.cpSync(originalNewProjectPkg, copiedNewProjectPkg, { recursive: true });
            newProjectTemplatePath = copiedNewProjectPkg;
            cazOptions = { name: projectName, backend: 'cloudflare', install: true, pm: 'npm' };
        }

        await caz.default(newProjectTemplatePath, projectDir, {
            ...cazOptions,
            force: false,
        });

        await onSuccess?.();
    } finally {
        // Clean up the temporary copied new project package
        if (devPath) {
            fs.rmSync(newProjectTemplatePath, { recursive: true, force: true, maxRetries: 3 });
        }
    }
}

// API Fetch Helper
export async function apiFetch(apiPath: string, options?: RequestInit): Promise<Response> {
    const port = process.env.POSITRONIC_SERVER_PORT || '8787';
    const baseUrl = `http://localhost:${port}`;
    const fullUrl = `${baseUrl}${apiPath.startsWith('/') ? apiPath : '/' + apiPath}`;

    const response = await fetch(fullUrl, options);
    return response;
}