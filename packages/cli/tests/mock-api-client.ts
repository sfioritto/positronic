import type { ApiClient } from '../src/commands/helpers.js';

interface MockResource {
  key: string;
  type: 'text' | 'binary';
  path?: string;
  size: number;
  lastModified: string;
  local: boolean;
}

export class MockApiClient implements ApiClient {
  private resources: MockResource[] = [];
  private brainRuns: Map<string, any> = new Map();

  // Track all calls for assertions
  public calls: Array<{ path: string; options?: RequestInit }> = [];

  async fetch(path: string, options?: RequestInit): Promise<Response> {
    this.calls.push({ path, options });

    // Mock GET /resources
    if (path === '/resources' && (!options || options.method === 'GET')) {
      return new Response(
        JSON.stringify({
          resources: this.resources,
          truncated: false,
          count: this.resources.length,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Mock POST /resources
    if (path === '/resources' && options?.method === 'POST') {
      // Extract form data from the request
      const formData = options.body;
      if (formData && formData instanceof FormData) {
        const type = formData.get('type');
        const key = formData.get('key');
        const file = formData.get('file');
        const local = formData.get('local');

        if (type && key && file) {
          const newResource: MockResource = {
            key: key as string,
            type: type as 'text' | 'binary',
            size: (file as any).size || 100, // Mock size
            lastModified: new Date().toISOString(),
            local: local === 'true',
          };

          // Update existing or add new
          const existingIndex = this.resources.findIndex((r) => r.key === key);
          if (existingIndex >= 0) {
            this.resources[existingIndex] = newResource;
          } else {
            this.resources.push(newResource);
          }

          return new Response(JSON.stringify(newResource), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response('Bad Request', { status: 400 });
    }

    // Mock DELETE /resources (bulk delete all)
    if (path === '/resources' && options?.method === 'DELETE') {
      this.resources = [];
      return new Response(null, { status: 204 });
    }

    // Mock DELETE /resources/:key
    const deleteMatch = path.match(/^\/resources\/(.+)$/);
    if (deleteMatch && options?.method === 'DELETE') {
      const key = decodeURIComponent(deleteMatch[1]);
      const index = this.resources.findIndex((r) => r.key === key);

      if (index >= 0) {
        this.resources.splice(index, 1);
      }

      // Always return 204 for delete (idempotent)
      return new Response(null, { status: 204 });
    }

    // Mock POST /brains/runs
    if (path === '/brains/runs' && options?.method === 'POST') {
      if (typeof options.body === 'string') {
        const body = JSON.parse(options.body);
        const brainRunId = `run-${Date.now()}`;
        this.brainRuns.set(brainRunId, {
          brainName: body.brainName,
          id: brainRunId,
        });

        return new Response(JSON.stringify({ brainRunId }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Bad Request', { status: 400 });
    }

    // Default: Not found
    return new Response('Not Found', { status: 404 });
  }

  // Helper methods for test setup
  addResource(resource: MockResource) {
    this.resources.push(resource);
  }

  clearResources() {
    this.resources = [];
  }

  getResources() {
    return [...this.resources];
  }

  reset() {
    this.resources = [];
    this.brainRuns.clear();
    this.calls = [];
  }
}

// Factory function for creating mock clients with initial data
export function createMockApiClient(
  initialResources?: MockResource[]
): MockApiClient {
  const client = new MockApiClient();
  if (initialResources) {
    initialResources.forEach((r) => client.addResource(r));
  }
  return client;
}
