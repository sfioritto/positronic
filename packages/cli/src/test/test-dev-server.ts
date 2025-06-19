import { ChildProcess, spawn } from 'child_process';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as path from 'path';
import type { PositronicDevServer } from '@positronic/spec';
import { isText } from 'istextorbinary';

interface MockResource {
  key: string;
  type: 'text' | 'binary';
  size: number;
  lastModified: string;
}

export class TestDevServer implements PositronicDevServer {
  private resources: Map<string, MockResource> = new Map();
  private server: any = null;
  private port: number = 0;
  private projectRoot: string = '';
  private serverProcess: ChildProcess | null = null;

  constructor(initialResources?: MockResource[]) {
    if (initialResources) {
      initialResources.forEach((r) => this.resources.set(r.key, r));
    }
  }

  async setup(projectRoot: string, force?: boolean): Promise<void> {
    // For tests, we don't need to set up .positronic directory
    // Just ensure we're ready to serve
    this.projectRoot = projectRoot;
  }

  private scanResourcesDirectory(): void {
    const resourcesDir = path.join(this.projectRoot, 'resources');
    if (!fs.existsSync(resourcesDir)) {
      return;
    }

    const scanDirectory = (dir: string, baseDir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          scanDirectory(fullPath, baseDir);
        } else if (entry.isFile()) {
          const relativePath = path.relative(baseDir, fullPath);
          const key = relativePath.replace(/\\/g, '/');
          const stats = fs.statSync(fullPath);
          const fileContent = fs.readFileSync(fullPath);

          const type: 'text' | 'binary' = isText(entry.name, fileContent)
            ? 'text'
            : 'binary';

          this.resources.set(key, {
            key,
            type,
            size: stats.size,
            lastModified: stats.mtime.toISOString(),
          });
        }
      }
    };

    scanDirectory(resourcesDir, resourcesDir);
  }

  async start(projectRoot: string, port?: number): Promise<ChildProcess> {
    this.projectRoot = projectRoot;
    this.port = port || 8787;

    // Pre-populate resources from filesystem
    this.scanResourcesDirectory();

    // Create a simple HTTP server
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Handle connection errors
      res.on('error', (err) => {
        console.error('Response error:', err);
      });

      req.on('error', (err) => {
        console.error('Request error:', err);
      });

      try {
        const url = new URL(req.url || '/', `http://localhost:${this.port}`);

        // CORS headers for local development
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader(
          'Access-Control-Allow-Methods',
          'GET, POST, DELETE, OPTIONS'
        );
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        // GET /resources
        if (req.method === 'GET' && url.pathname === '/resources') {
          // Re-scan resources before responding to ensure we have the latest
          this.scanResourcesDirectory();

          const resources = Array.from(this.resources.values());
          const responseData = JSON.stringify({
            resources,
            truncated: false,
            count: resources.length,
          });

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(responseData),
          });
          res.end(responseData);
          return;
        }

        // POST /resources
        if (req.method === 'POST' && url.pathname === '/resources') {
          // For the test server, we don't actually process uploads
          // Resources are pre-populated from the filesystem
          // Just consume the request body and return success
          req.on('data', () => {});
          req.on('end', () => {
            res.writeHead(201);
            res.end();
          });
          return;
        }

        // DELETE /resources/:key
        const deleteMatch = url.pathname.match(/^\/resources\/(.+)$/);
        if (req.method === 'DELETE' && deleteMatch) {
          const key = decodeURIComponent(deleteMatch[1]);
          if (this.resources.has(key)) {
            this.resources.delete(key);
            res.writeHead(204);
            res.end();
          } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: `Resource "${key}" not found` }));
          }
          return;
        }

        // POST /brains/runs
        if (req.method === 'POST' && url.pathname === '/brains/runs') {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            const data = JSON.parse(body);
            const brainRunId = `run-${Date.now()}`;
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ brainRunId }));
          });
          return;
        }

        // Default 404
        res.writeHead(404);
        res.end('Not Found');
      } catch (error) {
        console.error('Test server request error:', error);
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });

    // Start the server
    await new Promise<void>((resolve, reject) => {
      this.server.on('error', (err: Error) => {
        console.error('Test server error:', err);
        reject(err);
      });

      this.server.listen(this.port, () => {
        resolve();
      });
    });

    // Keep a reference to prevent garbage collection
    (global as any).__testServer = this.server;

    // Create a fake child process that represents our server
    // This is a bit of a hack, but it allows us to integrate with the existing CLI code
    const fakeProcess = {
      pid: process.pid,
      kill: (signal?: string) => {
        if (this.server) {
          this.server.close(() => {
            delete (global as any).__testServer;
          });
          this.server = null;
        }
        return true;
      },
      on: (event: string, handler: Function) => {
        // Implement basic event handling for 'close' and 'error'
        if (event === 'close' && this.server) {
          this.server.on('close', handler);
        } else if (event === 'error' && this.server) {
          this.server.on('error', handler);
        }
      },
      killed: false,
    } as any as ChildProcess;

    this.serverProcess = fakeProcess;
    return fakeProcess;
  }

  // Helper methods for tests to manipulate the server state
  addResource(resource: MockResource) {
    this.resources.set(resource.key, resource);
  }

  clearResources() {
    this.resources.clear();
  }

  getResources(): MockResource[] {
    return Array.from(this.resources.values());
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
