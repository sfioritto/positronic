import { STATUS, BRAIN_EVENTS } from '@positronic/core';

type Fetch = (request: Request) => Promise<Response>;

export async function testStatus(fetch: Fetch): Promise<boolean> {
  try {
    const request = new Request('http://example.com/status', {
      method: 'GET',
    });

    const response = await fetch(request);

    if (!response.ok) {
      console.error(`Status endpoint returned ${response.status}`);
      return false;
    }

    const data = await response.json() as { ready: boolean };

    if (data.ready !== true) {
      console.error(`Expected { ready: true }, got ${JSON.stringify(data)}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Failed to test status endpoint:`, error);
    return false;
  }
}

export const resources = {
  /**
   * Test GET /resources - List all resources
   */
  async list(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/resources', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /resources returned ${response.status}`);
        return false;
      }

      const data = await response.json() as {
        resources: Array<{
          key: string;
          type: string;
          size: number;
          lastModified: string;
          local: boolean;
        }>;
        truncated: boolean;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.resources)) {
        console.error(
          `Expected resources to be an array, got ${typeof data.resources}`
        );
        return false;
      }

      if (typeof data.truncated !== 'boolean') {
        console.error(
          `Expected truncated to be boolean, got ${typeof data.truncated}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each resource has required fields
      for (const resource of data.resources) {
        if (
          !resource.key ||
          !resource.type ||
          typeof resource.size !== 'number' ||
          !resource.lastModified ||
          typeof resource.local !== 'boolean'
        ) {
          console.error(
            `Resource missing required fields: ${JSON.stringify(resource)}`
          );
          return false;
        }

        if (!['text', 'binary'].includes(resource.type)) {
          console.error(`Invalid resource type: ${resource.type}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /resources:`, error);
      return false;
    }
  },

  /**
   * Test POST /resources - Upload a resource
   */
  async upload(fetch: Fetch): Promise<boolean> {
    try {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['test content'], { type: 'text/plain' }),
        'test.txt'
      );
      formData.append('type', 'text');
      formData.append('key', 'test-resource.txt');
      formData.append('local', 'false');

      const request = new Request('http://example.com/resources', {
        method: 'POST',
        body: formData,
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /resources returned ${response.status}, expected 201`
        );
        return false;
      }

      const data = await response.json() as {
        key: string;
        type: string;
        size: number;
        lastModified: string;
        local: boolean;
      };

      // Validate response has required fields
      if (
        !data.key ||
        !data.type ||
        typeof data.size !== 'number' ||
        !data.lastModified ||
        typeof data.local !== 'boolean'
      ) {
        console.error(
          `Response missing required fields: ${JSON.stringify(data)}`
        );
        return false;
      }

      if (data.key !== 'test-resource.txt') {
        console.error(
          `Expected key to be 'test-resource.txt', got ${data.key}`
        );
        return false;
      }

      if (data.type !== 'text') {
        console.error(`Expected type to be 'text', got ${data.type}`);
        return false;
      }

      if (data.local !== false) {
        console.error(`Expected local to be false, got ${data.local}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test POST /resources:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /resources/:key - Delete a specific resource
   */
  async delete(fetch: Fetch, key: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/resources/${encodeURIComponent(key)}`,
        {
          method: 'DELETE',
        }
      );

      const response = await fetch(request);

      if (response.status !== 204) {
        console.error(
          `DELETE /resources/${key} returned ${response.status}, expected 204`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /resources/${key}:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /resources - Bulk delete all resources (dev mode only)
   */
  async deleteAll(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/resources', {
        method: 'DELETE',
      });

      const response = await fetch(request);

      // In production mode, this should return 403
      if (response.status === 403) {
        const data = await response.json() as { error: string };
        if (
          data.error === 'Bulk delete is only available in development mode'
        ) {
          // This is expected behavior in production
          return true;
        }
      }

      if (response.status !== 200) {
        console.error(
          `DELETE /resources returned ${response.status}, expected 200 or 403`
        );
        return false;
      }

      const data = await response.json() as { deletedCount: number };

      if (typeof data.deletedCount !== 'number') {
        console.error(
          `Expected deletedCount to be number, got ${typeof data.deletedCount}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /resources:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /resources preserves pages - bulk delete should not delete pages
   */
  async deleteAllPreservesPages(fetch: Fetch): Promise<boolean> {
    try {
      // First create a page
      const pageSlug = `spec-test-page-${Date.now()}`;
      const pageHtml = '<html><body>Test page for spec</body></html>';
      const brainRunId = 'spec-test-brain-run-id';

      const createPageRequest = new Request('http://example.com/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          slug: pageSlug,
          html: pageHtml,
          brainRunId,
        }),
      });

      const createPageResponse = await fetch(createPageRequest);
      if (createPageResponse.status !== 201) {
        console.error(
          `Failed to create test page: ${createPageResponse.status}`
        );
        return false;
      }

      // Now bulk delete all resources
      const deleteRequest = new Request('http://example.com/resources', {
        method: 'DELETE',
      });

      const deleteResponse = await fetch(deleteRequest);

      // Skip test if in production mode (403)
      if (deleteResponse.status === 403) {
        // Clean up the page we created
        await fetch(
          new Request(
            `http://example.com/pages/${encodeURIComponent(pageSlug)}`,
            { method: 'DELETE' }
          )
        );
        console.log(
          'Skipping deleteAllPreservesPages test - bulk delete not available in production'
        );
        return true;
      }

      if (deleteResponse.status !== 200) {
        console.error(
          `DELETE /resources returned ${deleteResponse.status}, expected 200`
        );
        return false;
      }

      // Verify the page still exists
      const getPageRequest = new Request(
        `http://example.com/pages/${encodeURIComponent(pageSlug)}`,
        { method: 'GET' }
      );

      const getPageResponse = await fetch(getPageRequest);

      if (getPageResponse.status === 404) {
        console.error(
          'DELETE /resources incorrectly deleted pages - page not found after bulk delete'
        );
        return false;
      }

      if (!getPageResponse.ok) {
        console.error(
          `GET /pages/${pageSlug} returned ${getPageResponse.status}`
        );
        return false;
      }

      // Clean up: delete the test page
      await fetch(
        new Request(
          `http://example.com/pages/${encodeURIComponent(pageSlug)}`,
          { method: 'DELETE' }
        )
      );

      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /resources preserves pages:`, error);
      return false;
    }
  },

  /**
   * Test POST /resources/presigned-link - Generate presigned URL for upload
   */
  async generatePresignedLink(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request(
        'http://example.com/resources/presigned-link',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            key: 'test-files/large-video.mp4',
            type: 'binary',
            size: 150 * 1024 * 1024, // 150MB - larger than Worker limit
          }),
        }
      );

      const response = await fetch(request);

      // If credentials are not configured, expect 400
      if (response.status === 400) {
        const data = await response.json() as { error?: string };
        // This is acceptable - implementation may not have credentials configured
        console.log(
          'Presigned URL generation not available - this is acceptable'
        );
        return true;
      }

      if (response.status !== 200) {
        console.error(
          `POST /resources/presigned-link returned ${response.status}, expected 200 or 400`
        );
        return false;
      }

      const data = await response.json() as {
        url: string;
        method: string;
        expiresIn: number;
      };

      // Validate response structure (backend-agnostic)
      if (!data.url || typeof data.url !== 'string') {
        console.error(`Expected url to be string, got ${typeof data.url}`);
        return false;
      }

      if (!data.method || data.method !== 'PUT') {
        console.error(`Expected method to be 'PUT', got ${data.method}`);
        return false;
      }

      if (typeof data.expiresIn !== 'number' || data.expiresIn <= 0) {
        console.error(
          `Expected expiresIn to be positive number, got ${data.expiresIn}`
        );
        return false;
      }

      // Basic URL validation - just ensure it's a valid URL
      try {
        new URL(data.url);
        console.log('Presigned URL structure validated successfully');
      } catch (error) {
        console.error(`Invalid URL returned: ${data.url}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test POST /resources/presigned-link:`, error);
      return false;
    }
  },
};

export const brains = {
  /**
   * Test POST /brains/runs - Create a new brain run
   */
  async run(fetch: Fetch, identifier: string, options?: Record<string, string>): Promise<string | null> {
    try {
      const body: any = { identifier };
      if (options && Object.keys(options).length > 0) {
        body.options = options;
      }

      const request = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /brains/runs returned ${response.status}, expected 201`
        );
        return null;
      }

      const data = await response.json() as { brainRunId: string };

      if (!data.brainRunId || typeof data.brainRunId !== 'string') {
        console.error(
          `Expected brainRunId to be string, got ${typeof data.brainRunId}`
        );
        return null;
      }

      return data.brainRunId;
    } catch (error) {
      console.error(`Failed to test POST /brains/runs:`, error);
      return null;
    }
  },

  /**
   * Test POST /brains/runs with options - Create a brain run with runtime options
   */
  async runWithOptions(
    fetch: Fetch,
    identifier: string,
    options: Record<string, string>
  ): Promise<string | null> {
    try {
      const request = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier, options }),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /brains/runs with options returned ${response.status}, expected 201`
        );
        return null;
      }

      const data = await response.json() as { brainRunId: string };

      if (!data.brainRunId || typeof data.brainRunId !== 'string') {
        console.error(
          `Expected brainRunId to be string, got ${typeof data.brainRunId}`
        );
        return null;
      }

      return data.brainRunId;
    } catch (error) {
      console.error(`Failed to test POST /brains/runs with options:`, error);
      return null;
    }
  },

  /**
   * Test POST /brains/runs with non-existent brain - Should return 404
   */
  async runNotFound(
    fetch: Fetch,
    nonExistentBrainTitle: string
  ): Promise<boolean> {
    try {
      const request = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ brainTitle: nonExistentBrainTitle }),
      });

      const response = await fetch(request);

      if (response.status !== 404) {
        console.error(
          `POST /brains/runs with non-existent brain returned ${response.status}, expected 404`
        );
        return false;
      }

      const data = await response.json() as { error: string };

      if (!data.error || typeof data.error !== 'string') {
        console.error(`Expected error to be string, got ${typeof data.error}`);
        return false;
      }

      // Check that the error message mentions the brain title
      if (!data.error.includes(nonExistentBrainTitle)) {
        console.error(
          `Expected error to mention brain title '${nonExistentBrainTitle}', got: ${data.error}`
        );
        return false;
      }

      // Check that the error message follows expected format
      const expectedPattern = new RegExp(
        `Brain '${nonExistentBrainTitle}' not found`
      );
      if (!expectedPattern.test(data.error)) {
        console.error(
          `Expected error message to match pattern "Brain '${nonExistentBrainTitle}' not found", got: ${data.error}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /brains/runs with non-existent brain:`,
        error
      );
      return false;
    }
  },

  /**
   * Test GET /brains/runs/:runId/watch - Watch a brain run via SSE
   */
  async watch(fetch: Fetch, runId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${runId}/watch`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `GET /brains/runs/${runId}/watch returned ${response.status}`
        );
        return false;
      }

      // Check that it's an event stream
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('text/event-stream')) {
        console.error(
          `Expected content-type to be text/event-stream, got ${contentType}`
        );
        return false;
      }

      // Read a bit of the stream to verify it's actually SSE format
      if (response.body) {
        const reader = response.body.getReader();
        try {
          // Read first chunk
          const { value } = await reader.read();
          if (value) {
            const text = new TextDecoder().decode(value);
            // SSE data should contain "data: " lines
            if (!text.includes('data: ')) {
              console.error(
                `Expected SSE format with "data: " prefix, got: ${text.substring(
                  0,
                  100
                )}`
              );
              return false;
            }
          }
        } finally {
          // Always cancel the reader to clean up
          await reader.cancel();
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains/runs/${runId}/watch:`, error);
      return false;
    }
  },

  /**
   * Test GET /brains/:identifier/history - Get history of brain runs
   */
  async history(
    fetch: Fetch,
    identifier: string,
    limit?: number
  ): Promise<boolean> {
    try {
      const url = new URL(
        'http://example.com/brains/' + identifier + '/history'
      );
      if (limit !== undefined) {
        url.searchParams.set('limit', limit.toString());
      }

      const request = new Request(url.toString(), {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `GET /brains/${identifier}/history returned ${response.status}`
        );
        return false;
      }

      const data = await response.json() as {
        runs: Array<{
          brainRunId: string;
          brainTitle: string;
          type: string;
          status: string;
          createdAt: number;
        }>;
      };

      // Validate response structure
      if (!data.runs || !Array.isArray(data.runs)) {
        console.error(`Expected runs to be an array, got ${typeof data.runs}`);
        return false;
      }

      // Validate each run has required fields
      for (const run of data.runs) {
        if (
          !run.brainRunId ||
          !run.brainTitle ||
          !run.type ||
          !run.status ||
          typeof run.createdAt !== 'number'
        ) {
          console.error(`Run missing required fields: ${JSON.stringify(run)}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains/${identifier}/history:`, error);
      return false;
    }
  },

  /**
   * Test GET /brains/watch - Watch all running brains
   */
  async watchAll(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/brains/watch', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /brains/watch returned ${response.status}`);
        return false;
      }

      // Check that it's an event stream
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('text/event-stream')) {
        console.error(
          `Expected content-type to be text/event-stream, got ${contentType}`
        );
        return false;
      }

      // Read a bit of the stream to verify it's actually SSE format
      if (response.body) {
        const reader = response.body.getReader();
        try {
          // Read first chunk
          const { value } = await reader.read();
          if (value) {
            const text = new TextDecoder().decode(value);
            // SSE data should contain "data: " lines
            if (!text.includes('data: ')) {
              console.error(
                `Expected SSE format with "data: " prefix, got: ${text.substring(
                  0,
                  100
                )}`
              );
              return false;
            }
          }
        } finally {
          // Always cancel the reader to clean up
          await reader.cancel();
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains/watch:`, error);
      return false;
    }
  },

  /**
   * Test GET /brains - List all brains
   */
  async list(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/brains', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /brains returned ${response.status}`);
        return false;
      }

      const data = await response.json() as {
        brains: Array<{
          filename: string;
          title: string;
          description: string;
        }>;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.brains)) {
        console.error(
          `Expected brains to be an array, got ${typeof data.brains}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each brain has required fields
      for (const brain of data.brains) {
        if (
          !brain.filename ||
          typeof brain.filename !== 'string' ||
          !brain.title ||
          typeof brain.title !== 'string' ||
          !brain.description ||
          typeof brain.description !== 'string'
        ) {
          console.error(
            `Brain missing required fields or has invalid types: ${JSON.stringify(
              brain
            )}`
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains:`, error);
      return false;
    }
  },

  /**
   * Test GET /brains?q=<query> - Search brains by query string
   * Returns brains matching the query (by title, filename, or description).
   * The matching algorithm is implementation-defined; the spec only verifies
   * the response structure and that results are relevant to the query.
   */
  async search(fetch: Fetch, query: string): Promise<{
    brains: Array<{
      title: string;
      description: string;
    }>;
    count: number;
  } | null> {
    try {
      const url = new URL('http://example.com/brains');
      url.searchParams.set('q', query);

      const request = new Request(url.toString(), {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /brains?q=${query} returned ${response.status}`);
        return null;
      }

      const data = await response.json() as {
        brains: Array<{
          title: string;
          description: string;
        }>;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.brains)) {
        console.error(
          `Expected brains to be an array, got ${typeof data.brains}`
        );
        return null;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return null;
      }

      // Validate each brain has required fields
      for (const brain of data.brains) {
        if (
          !brain.title ||
          typeof brain.title !== 'string' ||
          !brain.description ||
          typeof brain.description !== 'string'
        ) {
          console.error(
            `Brain missing required fields or has invalid types: ${JSON.stringify(
              brain
            )}`
          );
          return null;
        }
      }

      // Count should match array length
      if (data.count !== data.brains.length) {
        console.error(
          `Count (${data.count}) does not match brains array length (${data.brains.length})`
        );
        return null;
      }

      return data;
    } catch (error) {
      console.error(`Failed to test GET /brains?q=${query}:`, error);
      return null;
    }
  },

  /**
   * Test GET /brains/:identifier - Get brain structure/definition
   * (For future brain exploration/info command)
   */
  async getBrainInfo(fetch: Fetch, identifier: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/${encodeURIComponent(identifier)}`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /brains/${identifier} returned ${response.status}`);
        return false;
      }

      const data = await response.json() as {
        title: string;
        steps: Array<{
          type: string;
          title: string;
          innerBrain?: {
            title: string;
            steps: any[];
          };
        }>;
      };

      // Validate response structure
      if (!data.title || typeof data.title !== 'string') {
        console.error(`Expected title to be string, got ${typeof data.title}`);
        return false;
      }

      if (!Array.isArray(data.steps)) {
        console.error(
          `Expected steps to be an array, got ${typeof data.steps}`
        );
        return false;
      }

      // Validate each step
      for (const step of data.steps) {
        if (!step.type || !['step', 'brain'].includes(step.type)) {
          console.error(`Invalid step type: ${step.type}`);
          return false;
        }

        if (!step.title || typeof step.title !== 'string') {
          console.error(
            `Step missing title or has invalid type: ${JSON.stringify(step)}`
          );
          return false;
        }

        // If it's a brain step, validate the inner brain recursively
        if (step.type === 'brain' && step.innerBrain) {
          if (
            !step.innerBrain.title ||
            typeof step.innerBrain.title !== 'string'
          ) {
            console.error(
              `Inner brain missing title: ${JSON.stringify(step.innerBrain)}`
            );
            return false;
          }

          if (!Array.isArray(step.innerBrain.steps)) {
            console.error(
              `Inner brain missing steps array: ${JSON.stringify(
                step.innerBrain
              )}`
            );
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains/${identifier}:`, error);
      return false;
    }
  },

  /**
   * Test GET /brains/:identifier/active-runs - Get active/running brain runs
   */
  async activeRuns(fetch: Fetch, identifier: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/${encodeURIComponent(
          identifier
        )}/active-runs`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `GET /brains/${identifier}/active-runs returned ${response.status}`
        );
        return false;
      }

      const data = await response.json() as {
        runs: Array<{
          brainRunId: string;
          brainTitle: string;
          type: string;
          status: string;
          createdAt: number;
        }>;
      };

      // Validate response structure
      if (!data.runs || !Array.isArray(data.runs)) {
        console.error(`Expected runs to be an array, got ${typeof data.runs}`);
        return false;
      }

      // Validate each run has required fields
      for (const run of data.runs) {
        if (
          !run.brainRunId ||
          !run.brainTitle ||
          !run.type ||
          !run.status ||
          typeof run.createdAt !== 'number'
        ) {
          console.error(
            `Active run missing required fields: ${JSON.stringify(run)}`
          );
          return false;
        }

        // All active runs should have status 'running'
        if (run.status !== STATUS.RUNNING) {
          console.error(
            `Expected active run status to be '${STATUS.RUNNING}', got ${run.status}`
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test GET /brains/${identifier}/active-runs:`,
        error
      );
      return false;
    }
  },

  /**
   * Test GET /brains/runs/:runId - Get detailed information about a specific brain run
   */
  async getRun(fetch: Fetch, runId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${encodeURIComponent(runId)}`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /brains/runs/${runId} returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        brainRunId: string;
        brainTitle: string;
        brainDescription?: string;
        type: string;
        status: string;
        options?: Record<string, any>;
        error?: {
          name: string;
          message: string;
          stack?: string;
        };
        createdAt: number;
        startedAt?: number;
        completedAt?: number;
      };

      // Validate required fields
      if (!data.brainRunId || typeof data.brainRunId !== 'string') {
        console.error(
          `Expected brainRunId to be string, got ${typeof data.brainRunId}`
        );
        return false;
      }

      if (!data.brainTitle || typeof data.brainTitle !== 'string') {
        console.error(
          `Expected brainTitle to be string, got ${typeof data.brainTitle}`
        );
        return false;
      }

      if (!data.type || typeof data.type !== 'string') {
        console.error(`Expected type to be string, got ${typeof data.type}`);
        return false;
      }

      if (!data.status || typeof data.status !== 'string') {
        console.error(
          `Expected status to be string, got ${typeof data.status}`
        );
        return false;
      }

      if (typeof data.createdAt !== 'number') {
        console.error(
          `Expected createdAt to be number, got ${typeof data.createdAt}`
        );
        return false;
      }

      // If status is error, validate error structure
      if (data.status === STATUS.ERROR && data.error) {
        if (!data.error.name || typeof data.error.name !== 'string') {
          console.error(
            `Expected error.name to be string, got ${typeof data.error.name}`
          );
          return false;
        }
        if (!data.error.message || typeof data.error.message !== 'string') {
          console.error(
            `Expected error.message to be string, got ${typeof data.error.message}`
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains/runs/${runId}:`, error);
      return false;
    }
  },

  /**
   * Test GET /brains/runs/:runId with non-existent run - Should return 404
   */
  async getRunNotFound(fetch: Fetch, nonExistentRunId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${encodeURIComponent(nonExistentRunId)}`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (response.status !== 404) {
        console.error(
          `GET /brains/runs/${nonExistentRunId} returned ${response.status}, expected 404`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test GET /brains/runs/${nonExistentRunId}:`,
        error
      );
      return false;
    }
  },

  /**
   * Test GET /brains/:identifier with ambiguous identifier - Should return multiple matches
   * (For future brain exploration/info command)
   */
  async getBrainInfoAmbiguous(
    fetch: Fetch,
    ambiguousIdentifier: string
  ): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/${encodeURIComponent(ambiguousIdentifier)}`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      // When multiple matches found, expect 300 (Multiple Choices)
      if (response.status !== 300) {
        console.error(
          `GET /brains/${ambiguousIdentifier} with ambiguous identifier returned ${response.status}, expected 300`
        );
        return false;
      }

      const data = await response.json() as {
        matchType: 'multiple';
        candidates: Array<{
          title: string;
          filename: string;
          path?: string;
          description?: string;
        }>;
      };

      if (data.matchType !== 'multiple') {
        console.error(
          `Expected matchType to be 'multiple', got ${data.matchType}`
        );
        return false;
      }

      if (!Array.isArray(data.candidates) || data.candidates.length < 2) {
        console.error(
          `Expected candidates to be an array with at least 2 items`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains/${ambiguousIdentifier} with ambiguous identifier:`, error);
      return false;
    }
  },

  /**
   * Test POST /brains/runs with ambiguous identifier - Should return multiple matches
   */
  async runAmbiguous(
    fetch: Fetch,
    ambiguousIdentifier: string
  ): Promise<boolean> {
    try {
      const request = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier: ambiguousIdentifier }),
      });

      const response = await fetch(request);

      // When multiple matches found, expect 300 (Multiple Choices) or 409 (Conflict)
      if (response.status !== 300 && response.status !== 409) {
        console.error(
          `POST /brains/runs with ambiguous identifier returned ${response.status}, expected 300 or 409`
        );
        return false;
      }

      const data = await response.json() as {
        matchType: 'multiple';
        candidates: Array<{
          title: string;
          filename: string;
          path?: string;
          description?: string;
        }>;
      };

      if (data.matchType !== 'multiple') {
        console.error(
          `Expected matchType to be 'multiple', got ${data.matchType}`
        );
        return false;
      }

      if (!Array.isArray(data.candidates) || data.candidates.length < 2) {
        console.error(
          `Expected candidates to be an array with at least 2 items, got ${
            Array.isArray(data.candidates) ? data.candidates.length : 'non-array'
          }`
        );
        return false;
      }

      // Verify each candidate has required fields
      for (const candidate of data.candidates) {
        if (!candidate.title || !candidate.filename) {
          console.error(
            'Each candidate must have title and filename properties'
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test POST /brains/runs with ambiguous identifier:`, error);
      return false;
    }
  },

  /**
   * Test POST /brains/runs/rerun - Rerun an existing brain run
   */
  async rerun(
    fetch: Fetch,
    identifier: string,
    runId?: string,
    startsAt?: number,
    stopsAfter?: number
  ): Promise<string | null> {
    try {
      const body: any = { identifier };
      if (runId) body.runId = runId;
      if (startsAt !== undefined) body.startsAt = startsAt;
      if (stopsAfter !== undefined) body.stopsAfter = stopsAfter;

      const request = new Request('http://example.com/brains/runs/rerun', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /brains/runs/rerun returned ${response.status}, expected 201`
        );
        return null;
      }

      const data = await response.json() as { brainRunId: string };

      if (!data.brainRunId || typeof data.brainRunId !== 'string') {
        console.error(
          `Expected brainRunId to be string, got ${typeof data.brainRunId}`
        );
        return null;
      }

      return data.brainRunId;
    } catch (error) {
      console.error(`Failed to test POST /brains/runs/rerun:`, error);
      return null;
    }
  },
  /**
   * Test DELETE /brains/runs/:runId - Kill/cancel a running brain run
   */
  async kill(fetch: Fetch, runId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/runs/${runId}`,
        {
          method: 'DELETE',
        }
      );
      const response = await fetch(request);
      if (response.status !== 204) {
        console.error(
          `DELETE /brains/runs/${runId} returned ${response.status}, expected 204`
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /brains/runs/${runId}:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /brains/runs/:runId for a brain suspended on a webhook.
   * This tests that killing a webhook-suspended brain:
   * 1. Returns 204 (not 409)
   * 2. Updates status to CANCELLED
   * 3. Clears webhook registrations (webhook no longer resumes the brain)
   *
   * Requires a brain with a loop step that will pause on a webhook.
   */
  async killSuspended(
    fetch: Fetch,
    loopBrainIdentifier: string,
    webhookSlug: string,
    webhookPayload: Record<string, any>
  ): Promise<boolean> {
    try {
      // Step 1: Start the loop brain
      const runRequest = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: loopBrainIdentifier }),
      });

      const runResponse = await fetch(runRequest);
      if (runResponse.status !== 201) {
        console.error(
          `POST /brains/runs returned ${runResponse.status}, expected 201`
        );
        return false;
      }

      const { brainRunId } = (await runResponse.json()) as { brainRunId: string };

      // Step 2: Watch until WEBHOOK event (brain pauses)
      const watchRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}/watch`,
        { method: 'GET' }
      );

      const watchResponse = await fetch(watchRequest);
      if (!watchResponse.ok) {
        console.error(
          `GET /brains/runs/${brainRunId}/watch returned ${watchResponse.status}`
        );
        return false;
      }

      let foundWebhookEvent = false;
      if (watchResponse.body) {
        const reader = watchResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (!foundWebhookEvent) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let eventEndIndex;
            while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
              const message = buffer.substring(0, eventEndIndex);
              buffer = buffer.substring(eventEndIndex + 2);

              if (message.startsWith('data: ')) {
                try {
                  const event = JSON.parse(message.substring(6));
                  if (event.type === BRAIN_EVENTS.WEBHOOK) {
                    foundWebhookEvent = true;
                    break;
                  }
                  if (
                    event.type === BRAIN_EVENTS.COMPLETE ||
                    event.type === BRAIN_EVENTS.ERROR
                  ) {
                    console.error(
                      `Brain completed/errored before WEBHOOK event: ${event.type}`
                    );
                    return false;
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          await reader.cancel();
        }
      }

      if (!foundWebhookEvent) {
        console.error('Brain did not emit WEBHOOK event');
        return false;
      }

      // Step 3: Kill the suspended brain
      const killRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}`,
        { method: 'DELETE' }
      );

      const killResponse = await fetch(killRequest);
      if (killResponse.status !== 204) {
        console.error(
          `DELETE /brains/runs/${brainRunId} returned ${killResponse.status}, expected 204`
        );
        return false;
      }

      // Step 4: Verify status is CANCELLED via getRun
      const getRunRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}`,
        { method: 'GET' }
      );

      const getRunResponse = await fetch(getRunRequest);
      if (!getRunResponse.ok) {
        console.error(
          `GET /brains/runs/${brainRunId} returned ${getRunResponse.status}`
        );
        return false;
      }

      const runData = (await getRunResponse.json()) as { status: string };
      if (runData.status !== STATUS.CANCELLED) {
        console.error(
          `Expected status to be '${STATUS.CANCELLED}', got '${runData.status}'`
        );
        return false;
      }

      // Step 5: Verify webhook no longer resumes the brain
      // Send a webhook - it should return 'no-match' since registrations were cleared
      const webhookRequest = new Request(
        `http://example.com/webhooks/${encodeURIComponent(webhookSlug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        }
      );

      const webhookResponse = await fetch(webhookRequest);
      // Accept 200/202 - the important thing is it doesn't resume the brain
      if (!webhookResponse.ok) {
        console.error(
          `POST /webhooks/${webhookSlug} returned ${webhookResponse.status}`
        );
        return false;
      }

      const webhookResult = (await webhookResponse.json()) as {
        received: boolean;
        action?: string;
      };

      // The action should be 'no-match' since webhook registrations were cleared
      if (webhookResult.action === 'resumed') {
        console.error(
          'Webhook resumed the brain after it was killed - webhook registrations were not cleared'
        );
        return false;
      }

      // Verify the brain is still CANCELLED (didn't restart)
      const finalCheckRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}`,
        { method: 'GET' }
      );

      const finalCheckResponse = await fetch(finalCheckRequest);
      if (!finalCheckResponse.ok) {
        console.error(
          `Final GET /brains/runs/${brainRunId} returned ${finalCheckResponse.status}`
        );
        return false;
      }

      const finalRunData = (await finalCheckResponse.json()) as { status: string };
      if (finalRunData.status !== STATUS.CANCELLED) {
        console.error(
          `Final status check: expected '${STATUS.CANCELLED}', got '${finalRunData.status}'`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test kill suspended brain for ${loopBrainIdentifier}:`,
        error
      );
      return false;
    }
  },

  /**
   * Test that loop steps emit proper LOOP_* events in the SSE stream.
   * Requires a brain with a loop step that will pause on a webhook.
   *
   * Expected events before webhook pause:
   * - LOOP_START (with prompt and optional system)
   * - LOOP_ITERATION
   * - LOOP_TOOL_CALL
   * - LOOP_WEBHOOK (before WEBHOOK event)
   * - WEBHOOK
   */
  async watchLoopEvents(
    fetch: Fetch,
    loopBrainIdentifier: string
  ): Promise<boolean> {
    try {
      // Start the loop brain
      const runRequest = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: loopBrainIdentifier }),
      });

      const runResponse = await fetch(runRequest);
      if (runResponse.status !== 201) {
        console.error(
          `POST /brains/runs returned ${runResponse.status}, expected 201`
        );
        return false;
      }

      const { brainRunId } = (await runResponse.json()) as { brainRunId: string };

      // Watch the brain run
      const watchRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}/watch`,
        { method: 'GET' }
      );

      const watchResponse = await fetch(watchRequest);
      if (!watchResponse.ok) {
        console.error(
          `GET /brains/runs/${brainRunId}/watch returned ${watchResponse.status}`
        );
        return false;
      }

      // Read SSE events until we get WEBHOOK or COMPLETE/ERROR
      const events: any[] = [];
      if (watchResponse.body) {
        const reader = watchResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;

        try {
          while (!done) {
            const { value, done: streamDone } = await reader.read();
            if (streamDone) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE messages
            let eventEndIndex;
            while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
              const message = buffer.substring(0, eventEndIndex);
              buffer = buffer.substring(eventEndIndex + 2);

              if (message.startsWith('data: ')) {
                try {
                  const event = JSON.parse(message.substring(6));
                  events.push(event);

                  // Stop on terminal events
                  if (
                    event.type === BRAIN_EVENTS.WEBHOOK ||
                    event.type === BRAIN_EVENTS.COMPLETE ||
                    event.type === BRAIN_EVENTS.ERROR
                  ) {
                    done = true;
                    break;
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          await reader.cancel();
        }
      }

      // Verify required loop events are present
      const hasLoopStart = events.some(
        (e) => e.type === BRAIN_EVENTS.LOOP_START
      );
      if (!hasLoopStart) {
        console.error('Missing LOOP_START event in SSE stream');
        return false;
      }

      // Verify LOOP_START has prompt field
      const loopStartEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.LOOP_START
      );
      if (!loopStartEvent.prompt || typeof loopStartEvent.prompt !== 'string') {
        console.error('LOOP_START event missing prompt field');
        return false;
      }

      const hasLoopIteration = events.some(
        (e) => e.type === BRAIN_EVENTS.LOOP_ITERATION
      );
      if (!hasLoopIteration) {
        console.error('Missing LOOP_ITERATION event in SSE stream');
        return false;
      }

      const hasLoopToolCall = events.some(
        (e) => e.type === BRAIN_EVENTS.LOOP_TOOL_CALL
      );
      if (!hasLoopToolCall) {
        console.error('Missing LOOP_TOOL_CALL event in SSE stream');
        return false;
      }

      // If we got a WEBHOOK event, verify LOOP_WEBHOOK came before it
      const webhookIndex = events.findIndex(
        (e) => e.type === BRAIN_EVENTS.WEBHOOK
      );
      if (webhookIndex !== -1) {
        const loopWebhookIndex = events.findIndex(
          (e) => e.type === BRAIN_EVENTS.LOOP_WEBHOOK
        );
        if (loopWebhookIndex === -1) {
          console.error('Missing LOOP_WEBHOOK event before WEBHOOK event');
          return false;
        }
        if (loopWebhookIndex >= webhookIndex) {
          console.error('LOOP_WEBHOOK event must come before WEBHOOK event');
          return false;
        }

        // Verify LOOP_WEBHOOK has required fields
        const loopWebhookEvent = events[loopWebhookIndex];
        if (!loopWebhookEvent.toolCallId || !loopWebhookEvent.toolName) {
          console.error(
            'LOOP_WEBHOOK event missing toolCallId or toolName fields'
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test loop events for ${loopBrainIdentifier}:`, error);
      return false;
    }
  },

  /**
   * Test full loop webhook resumption flow:
   * 1. Start a loop brain that will pause on a webhook
   * 2. Verify it pauses with WEBHOOK event
   * 3. Trigger the webhook with a response
   * 4. Verify the brain resumes and emits WEBHOOK_RESPONSE and LOOP_TOOL_RESULT
   *
   * Requires:
   * - A brain with a loop step that calls a tool returning { waitFor: webhook(...) }
   * - The webhook slug and identifier to trigger
   */
  async loopWebhookResume(
    fetch: Fetch,
    loopBrainIdentifier: string,
    webhookSlug: string,
    webhookPayload: Record<string, any>
  ): Promise<boolean> {
    try {
      // Step 1: Start the loop brain
      const runRequest = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: loopBrainIdentifier }),
      });

      const runResponse = await fetch(runRequest);
      if (runResponse.status !== 201) {
        console.error(
          `POST /brains/runs returned ${runResponse.status}, expected 201`
        );
        return false;
      }

      const { brainRunId } = (await runResponse.json()) as { brainRunId: string };

      // Step 2: Watch until WEBHOOK event (brain pauses)
      const watchRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}/watch`,
        { method: 'GET' }
      );

      const watchResponse = await fetch(watchRequest);
      if (!watchResponse.ok) {
        console.error(
          `GET /brains/runs/${brainRunId}/watch returned ${watchResponse.status}`
        );
        return false;
      }

      let foundWebhookEvent = false;
      if (watchResponse.body) {
        const reader = watchResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (!foundWebhookEvent) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let eventEndIndex;
            while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
              const message = buffer.substring(0, eventEndIndex);
              buffer = buffer.substring(eventEndIndex + 2);

              if (message.startsWith('data: ')) {
                try {
                  const event = JSON.parse(message.substring(6));
                  if (event.type === BRAIN_EVENTS.WEBHOOK) {
                    foundWebhookEvent = true;
                    break;
                  }
                  if (
                    event.type === BRAIN_EVENTS.COMPLETE ||
                    event.type === BRAIN_EVENTS.ERROR
                  ) {
                    console.error(
                      `Brain completed/errored before WEBHOOK event: ${event.type}`
                    );
                    return false;
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          await reader.cancel();
        }
      }

      if (!foundWebhookEvent) {
        console.error('Brain did not emit WEBHOOK event');
        return false;
      }

      // Step 3: Trigger the webhook
      const webhookRequest = new Request(
        `http://example.com/webhooks/${encodeURIComponent(webhookSlug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        }
      );

      const webhookResponse = await fetch(webhookRequest);
      if (!webhookResponse.ok) {
        console.error(
          `POST /webhooks/${webhookSlug} returned ${webhookResponse.status}`
        );
        return false;
      }

      const webhookResult = (await webhookResponse.json()) as {
        received: boolean;
        action?: string;
      };

      if (!webhookResult.received) {
        console.error('Webhook was not received');
        return false;
      }

      if (webhookResult.action !== 'resumed') {
        console.error(
          `Expected webhook action 'resumed', got '${webhookResult.action}'`
        );
        return false;
      }

      // Step 4: Watch again for resumed events
      const resumeWatchRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}/watch`,
        { method: 'GET' }
      );

      const resumeWatchResponse = await fetch(resumeWatchRequest);
      if (!resumeWatchResponse.ok) {
        console.error(
          `GET /brains/runs/${brainRunId}/watch (resume) returned ${resumeWatchResponse.status}`
        );
        return false;
      }

      const resumeEvents: any[] = [];
      if (resumeWatchResponse.body) {
        const reader = resumeWatchResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;

        try {
          while (!done) {
            const { value, done: streamDone } = await reader.read();
            if (streamDone) break;

            buffer += decoder.decode(value, { stream: true });

            let eventEndIndex;
            while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
              const message = buffer.substring(0, eventEndIndex);
              buffer = buffer.substring(eventEndIndex + 2);

              if (message.startsWith('data: ')) {
                try {
                  const event = JSON.parse(message.substring(6));
                  resumeEvents.push(event);

                  if (
                    event.type === BRAIN_EVENTS.COMPLETE ||
                    event.type === BRAIN_EVENTS.ERROR
                  ) {
                    done = true;
                    break;
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          await reader.cancel();
        }
      }

      // Verify WEBHOOK_RESPONSE event is present
      const hasWebhookResponse = resumeEvents.some(
        (e) => e.type === BRAIN_EVENTS.WEBHOOK_RESPONSE
      );
      if (!hasWebhookResponse) {
        console.error('Missing WEBHOOK_RESPONSE event after resume');
        return false;
      }

      // Verify LOOP_TOOL_RESULT event is present (with the webhook response as result)
      const hasLoopToolResult = resumeEvents.some(
        (e) => e.type === BRAIN_EVENTS.LOOP_TOOL_RESULT
      );
      if (!hasLoopToolResult) {
        console.error('Missing LOOP_TOOL_RESULT event after resume');
        return false;
      }

      // Verify brain completed successfully
      const completeEvent = resumeEvents.find(
        (e) => e.type === BRAIN_EVENTS.COMPLETE
      );
      if (!completeEvent) {
        console.error('Brain did not complete after resume');
        return false;
      }

      if (completeEvent.status !== STATUS.COMPLETE) {
        console.error(
          `Expected COMPLETE status, got ${completeEvent.status}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test loop webhook resume for ${loopBrainIdentifier}:`,
        error
      );
      return false;
    }
  },

  /**
   * Test that inner brain COMPLETE events don't overwrite outer brain status.
   *
   * This test verifies that when a nested inner brain completes, the outer brain's
   * status in history remains RUNNING (not prematurely set to COMPLETE).
   *
   * Test scenario:
   * 1. Run outer brain that contains inner brain + webhook step after inner brain
   * 2. Watch SSE until outer brain's WEBHOOK event (after inner completes)
   * 3. Query history for the brain
   * 4. Assert status is RUNNING (not COMPLETE from inner brain)
   * 5. Trigger webhook to complete outer brain
   * 6. Assert final status is COMPLETE
   */
  async innerBrainCompleteDoesNotAffectOuterStatus(
    fetch: Fetch,
    outerBrainIdentifier: string,
    webhookSlug: string,
    webhookPayload: Record<string, any>
  ): Promise<boolean> {
    try {
      // Step 1: Start the outer brain
      const runRequest = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: outerBrainIdentifier }),
      });

      const runResponse = await fetch(runRequest);
      if (runResponse.status !== 201) {
        console.error(
          `POST /brains/runs returned ${runResponse.status}, expected 201`
        );
        return false;
      }

      const { brainRunId } = (await runResponse.json()) as {
        brainRunId: string;
      };

      // Step 2: Watch SSE until WEBHOOK event from outer brain (after inner completes)
      const watchRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}/watch`,
        { method: 'GET' }
      );

      const watchResponse = await fetch(watchRequest);
      if (!watchResponse.ok) {
        console.error(
          `GET /brains/runs/${brainRunId}/watch returned ${watchResponse.status}`
        );
        return false;
      }

      let foundOuterWebhook = false;
      let innerCompleteCount = 0;
      if (watchResponse.body) {
        const reader = watchResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (!foundOuterWebhook) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let eventEndIndex;
            while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
              const message = buffer.substring(0, eventEndIndex);
              buffer = buffer.substring(eventEndIndex + 2);

              if (message.startsWith('data: ')) {
                try {
                  const event = JSON.parse(message.substring(6));

                  // Track inner brain completes
                  if (event.type === BRAIN_EVENTS.COMPLETE) {
                    innerCompleteCount++;
                    // First complete is inner brain, second would be outer
                  }

                  // Outer brain webhook (happens after inner brain completes)
                  if (event.type === BRAIN_EVENTS.WEBHOOK) {
                    foundOuterWebhook = true;
                    break;
                  }

                  if (event.type === BRAIN_EVENTS.ERROR) {
                    console.error(
                      `Brain errored: ${JSON.stringify(event.error)}`
                    );
                    return false;
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          await reader.cancel();
        }
      }

      if (!foundOuterWebhook) {
        console.error('Did not receive outer brain WEBHOOK event');
        return false;
      }

      if (innerCompleteCount === 0) {
        console.error('Inner brain did not emit COMPLETE event');
        return false;
      }

      // Step 3: Query history - status should be RUNNING, not COMPLETE
      const historyRequest = new Request(
        `http://example.com/brains/${encodeURIComponent(outerBrainIdentifier)}/history?limit=1`,
        { method: 'GET' }
      );

      const historyResponse = await fetch(historyRequest);
      if (!historyResponse.ok) {
        console.error(
          `GET /brains/${outerBrainIdentifier}/history returned ${historyResponse.status}`
        );
        return false;
      }

      const historyData = (await historyResponse.json()) as {
        runs: Array<{ brainRunId: string; status: string }>;
      };

      const ourRun = historyData.runs.find((r) => r.brainRunId === brainRunId);
      if (!ourRun) {
        console.error(`Run ${brainRunId} not found in history`);
        return false;
      }

      // KEY ASSERTION: Status should be RUNNING despite inner brain COMPLETE event
      if (ourRun.status !== STATUS.RUNNING) {
        console.error(
          `Expected status '${STATUS.RUNNING}' but got '${ourRun.status}'. ` +
            `Bug: Inner brain COMPLETE event overwrote outer brain status!`
        );
        return false;
      }

      // Step 4: Trigger webhook to complete outer brain
      const webhookRequest = new Request(
        `http://example.com/webhooks/${encodeURIComponent(webhookSlug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        }
      );

      const webhookResponse = await fetch(webhookRequest);
      if (!webhookResponse.ok) {
        console.error(
          `POST /webhooks/${webhookSlug} returned ${webhookResponse.status}`
        );
        return false;
      }

      // Step 5: Watch for final completion
      const resumeWatchRequest = new Request(
        `http://example.com/brains/runs/${brainRunId}/watch`,
        { method: 'GET' }
      );

      const resumeWatchResponse = await fetch(resumeWatchRequest);
      if (!resumeWatchResponse.ok) {
        console.error(
          `Resume watch returned ${resumeWatchResponse.status}`
        );
        return false;
      }

      // Wait for the OUTER brain's COMPLETE event specifically (by tracking depth)
      // When resuming, the SSE stream includes historical events, so we need to
      // track START/COMPLETE events to know when the outer brain truly finishes
      let foundFinalComplete = false;
      let depth = 0;
      if (resumeWatchResponse.body) {
        const reader = resumeWatchResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (!foundFinalComplete) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let eventEndIndex;
            while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
              const message = buffer.substring(0, eventEndIndex);
              buffer = buffer.substring(eventEndIndex + 2);

              if (message.startsWith('data: ')) {
                try {
                  const event = JSON.parse(message.substring(6));

                  // Track depth to find the outer brain's COMPLETE
                  if (event.type === BRAIN_EVENTS.START) {
                    depth++;
                  } else if (event.type === BRAIN_EVENTS.COMPLETE) {
                    depth--;
                    // When depth reaches 0, the outer brain has completed
                    if (depth <= 0) {
                      foundFinalComplete = true;
                      break;
                    }
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          await reader.cancel();
        }
      }

      // Step 6: Verify final status is COMPLETE
      const finalHistoryResponse = await fetch(historyRequest);
      if (!finalHistoryResponse.ok) {
        console.error('Final history query failed');
        return false;
      }

      const finalHistoryData = (await finalHistoryResponse.json()) as {
        runs: Array<{ brainRunId: string; status: string }>;
      };

      const finalRun = finalHistoryData.runs.find(
        (r) => r.brainRunId === brainRunId
      );
      if (!finalRun || finalRun.status !== STATUS.COMPLETE) {
        console.error(
          `Expected final status '${STATUS.COMPLETE}' but got '${finalRun?.status}'`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test inner brain complete status for ${outerBrainIdentifier}:`,
        error
      );
      return false;
    }
  },
};

export const schedules = {
  /**
   * Test POST /brains/schedules - Create a new schedule
   */
  async create(
    fetch: Fetch,
    identifier: string,
    cronExpression: string
  ): Promise<string | null> {
    try {
      const request = new Request('http://example.com/brains/schedules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier, cronExpression }),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /brains/schedules returned ${response.status}, expected 201`
        );
        return null;
      }

      const data = await response.json() as {
        id: string;
        brainTitle: string;
        cronExpression: string;
        enabled: boolean;
        createdAt: number;
      };

      // Validate response structure
      if (!data.id || typeof data.id !== 'string') {
        console.error(`Expected id to be string, got ${typeof data.id}`);
        return null;
      }

      // TODO: Once backend is updated, validate that the returned brain matches the identifier
      // For now, we accept any valid response

      if (data.cronExpression !== cronExpression) {
        console.error(
          `Expected cronExpression to be '${cronExpression}', got ${data.cronExpression}`
        );
        return null;
      }

      if (typeof data.enabled !== 'boolean') {
        console.error(
          `Expected enabled to be boolean, got ${typeof data.enabled}`
        );
        return null;
      }

      if (typeof data.createdAt !== 'number') {
        console.error(
          `Expected createdAt to be number, got ${typeof data.createdAt}`
        );
        return null;
      }

      return data.id;
    } catch (error) {
      console.error(`Failed to test POST /brains/schedules:`, error);
      return null;
    }
  },

  /**
   * Test GET /brains/schedules - List all schedules
   */
  async list(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/brains/schedules', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /brains/schedules returned ${response.status}`);
        return false;
      }

      const data = await response.json() as {
        schedules: Array<{
          id: string;
          brainTitle: string;
          cronExpression: string;
          enabled: boolean;
          createdAt: number;
        }>;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.schedules)) {
        console.error(
          `Expected schedules to be an array, got ${typeof data.schedules}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each schedule has required fields
      for (const schedule of data.schedules) {
        if (
          !schedule.id ||
          !schedule.brainTitle ||
          !schedule.cronExpression ||
          typeof schedule.enabled !== 'boolean' ||
          typeof schedule.createdAt !== 'number'
        ) {
          console.error(
            `Schedule missing required fields: ${JSON.stringify(schedule)}`
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains/schedules:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /brains/schedules/:scheduleId - Delete a schedule
   */
  async delete(fetch: Fetch, scheduleId: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/brains/schedules/${scheduleId}`,
        {
          method: 'DELETE',
        }
      );

      const response = await fetch(request);

      if (response.status !== 204) {
        console.error(
          `DELETE /brains/schedules/${scheduleId} returned ${response.status}, expected 204`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test DELETE /brains/schedules/${scheduleId}:`,
        error
      );
      return false;
    }
  },

  /**
   * Test GET /brains/schedules/runs - Get history of scheduled runs
   */
  async runs(
    fetch: Fetch,
    scheduleId?: string,
    limit?: number
  ): Promise<boolean> {
    try {
      const url = new URL('http://example.com/brains/schedules/runs');
      if (scheduleId !== undefined) {
        url.searchParams.set('scheduleId', scheduleId);
      }
      if (limit !== undefined) {
        url.searchParams.set('limit', limit.toString());
      }

      const request = new Request(url.toString(), {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /brains/schedules/runs returned ${response.status}`);
        return false;
      }

      const data = await response.json() as {
        runs: Array<{
          id: string;
          scheduleId: string;
          status: string;
          ranAt: number;
        }>;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.runs)) {
        console.error(`Expected runs to be an array, got ${typeof data.runs}`);
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each run has required fields
      for (const run of data.runs) {
        if (
          !run.id ||
          !run.scheduleId ||
          !run.status ||
          typeof run.ranAt !== 'number'
        ) {
          console.error(
            `Scheduled run missing required fields: ${JSON.stringify(run)}`
          );
          return false;
        }

        if (!['triggered', 'failed'].includes(run.status)) {
          console.error(`Invalid run status: ${run.status}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /brains/schedules/runs:`, error);
      return false;
    }
  },
};

export const secrets = {
  /**
   * Test POST /secrets - Create or update a secret
   */
  async create(fetch: Fetch, name: string, value: string): Promise<boolean> {
    try {
      const request = new Request('http://example.com/secrets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, value }),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /secrets returned ${response.status}, expected 201`
        );
        return false;
      }

      const data = await response.json() as {
        name: string;
        createdAt: string;
        updatedAt: string;
      };

      // Validate response structure
      if (!data.name || typeof data.name !== 'string') {
        console.error(`Expected name to be string, got ${typeof data.name}`);
        return false;
      }

      if (data.name !== name) {
        console.error(`Expected name to be '${name}', got ${data.name}`);
        return false;
      }

      if (typeof data.createdAt !== 'string') {
        console.error(
          `Expected createdAt to be string, got ${typeof data.createdAt}`
        );
        return false;
      }

      if (typeof data.updatedAt !== 'string') {
        console.error(
          `Expected updatedAt to be string, got ${typeof data.updatedAt}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test POST /secrets:`, error);
      return false;
    }
  },

  /**
   * Test GET /secrets - List all secrets (names only, not values)
   */
  async list(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/secrets', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /secrets returned ${response.status}`);
        return false;
      }

      const data = await response.json() as {
        secrets: Array<{
          name: string;
          createdAt: string;
          updatedAt: string;
        }>;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.secrets)) {
        console.error(
          `Expected secrets to be an array, got ${typeof data.secrets}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each secret has required fields (but NOT the value)
      for (const secret of data.secrets) {
        if (
          !secret.name ||
          typeof secret.name !== 'string' ||
          typeof secret.createdAt !== 'string' ||
          typeof secret.updatedAt !== 'string'
        ) {
          console.error(
            `Secret missing required fields: ${JSON.stringify(secret)}`
          );
          return false;
        }

        // Ensure value is NOT included
        if ('value' in secret) {
          console.error(
            `Secret should not include value field: ${JSON.stringify(secret)}`
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /secrets:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /secrets/:name - Delete a specific secret
   */
  async delete(fetch: Fetch, name: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/secrets/${encodeURIComponent(name)}`,
        {
          method: 'DELETE',
        }
      );

      const response = await fetch(request);

      if (response.status !== 204) {
        console.error(
          `DELETE /secrets/${name} returned ${response.status}, expected 204`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /secrets/${name}:`, error);
      return false;
    }
  },

  /**
   * Test GET /secrets/:name/exists - Check if a secret exists
   */
  async exists(fetch: Fetch, name: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/secrets/${encodeURIComponent(name)}/exists`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `GET /secrets/${name}/exists returned ${response.status}`
        );
        return false;
      }

      const data = await response.json() as { exists: boolean };

      // Validate response structure
      if (typeof data.exists !== 'boolean') {
        console.error(
          `Expected exists to be boolean, got ${typeof data.exists}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /secrets/${name}/exists:`, error);
      return false;
    }
  },

  /**
   * Test POST /secrets/bulk - Create multiple secrets
   */
  async bulk(
    fetch: Fetch,
    secrets: Array<{ name: string; value: string }>
  ): Promise<boolean> {
    try {
      const request = new Request('http://example.com/secrets/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ secrets }),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /secrets/bulk returned ${response.status}, expected 201`
        );
        return false;
      }

      const data = await response.json() as {
        created: number;
        updated: number;
      };

      // Validate response structure
      if (typeof data.created !== 'number') {
        console.error(
          `Expected created to be number, got ${typeof data.created}`
        );
        return false;
      }

      if (typeof data.updated !== 'number') {
        console.error(
          `Expected updated to be number, got ${typeof data.updated}`
        );
        return false;
      }

      // Total should match input
      if (data.created + data.updated !== secrets.length) {
        console.error(
          `Expected total (${
            data.created + data.updated
          }) to match input length (${secrets.length})`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test POST /secrets/bulk:`, error);
      return false;
    }
  },
};

export const webhooks = {
  /**
   * Test GET /webhooks - List all available webhook handlers
   */
  async list(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/webhooks', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /webhooks returned ${response.status}`);
        return false;
      }

      const data = await response.json() as {
        webhooks: Array<{
          slug: string;
          description?: string;
        }>;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.webhooks)) {
        console.error(
          `Expected webhooks to be an array, got ${typeof data.webhooks}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each webhook has required fields
      for (const webhook of data.webhooks) {
        if (!webhook.slug || typeof webhook.slug !== 'string') {
          console.error(
            `Webhook missing slug or has invalid type: ${JSON.stringify(
              webhook
            )}`
          );
          return false;
        }

        // Description is optional
        if (
          webhook.description !== undefined &&
          typeof webhook.description !== 'string'
        ) {
          console.error(
            `Webhook description has invalid type: ${JSON.stringify(webhook)}`
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /webhooks:`, error);
      return false;
    }
  },

  /**
   * Test POST /webhooks/:slug - Receive an incoming webhook from an external service
   */
  async receive(
    fetch: Fetch,
    slug: string,
    payload: any
  ): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/webhooks/${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      const response = await fetch(request);

      // Accept either 200 (OK) or 202 (Accepted)
      if (response.status !== 200 && response.status !== 202) {
        console.error(
          `POST /webhooks/${slug} returned ${response.status}, expected 200 or 202`
        );
        return false;
      }

      const data = await response.json() as {
        received: boolean;
        action?: 'resumed' | 'started' | 'queued' | 'no-match';
      };

      // Validate response structure
      if (typeof data.received !== 'boolean') {
        console.error(
          `Expected received to be boolean, got ${typeof data.received}`
        );
        return false;
      }

      // Action field is optional
      if (
        data.action !== undefined &&
        !['resumed', 'started', 'queued', 'no-match'].includes(data.action)
      ) {
        console.error(`Invalid action value: ${data.action}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test POST /webhooks/${slug}:`, error);
      return false;
    }
  },

  /**
   * Test POST /webhooks/:slug with non-existent webhook - Should return 404
   */
  async notFound(fetch: Fetch, slug: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/webhooks/${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );

      const response = await fetch(request);

      if (response.status !== 404) {
        console.error(
          `POST /webhooks/${slug} with non-existent webhook returned ${response.status}, expected 404`
        );
        return false;
      }

      const data = await response.json() as { error: string };

      if (!data.error || typeof data.error !== 'string') {
        console.error(`Expected error to be string, got ${typeof data.error}`);
        return false;
      }

      // Verify error message mentions the webhook slug
      if (!data.error.toLowerCase().includes('webhook')) {
        console.error(
          `Expected error message to mention webhook, got: ${data.error}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /webhooks/${slug} with non-existent webhook:`,
        error
      );
      return false;
    }
  },

  /**
   * Test POST /webhooks/system/ui-form - Built-in webhook for UI form submissions.
   * This is used by pages generated via .ui() steps to submit form data.
   *
   * The endpoint:
   * - Accepts form data (application/x-www-form-urlencoded or multipart/form-data)
   * - Requires an `identifier` query parameter to match the waiting brain
   * - Returns { received: true, action: 'resumed' | 'not_found', ... }
   */
  async uiForm(
    fetch: Fetch,
    identifier: string,
    formData: Record<string, string | string[]>
  ): Promise<boolean> {
    try {
      // Build URLSearchParams from form data
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(formData)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            params.append(`${key}[]`, v);
          }
        } else {
          params.append(key, value);
        }
      }

      const request = new Request(
        `http://example.com/webhooks/system/ui-form?identifier=${encodeURIComponent(identifier)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        }
      );

      const response = await fetch(request);

      // Accept 200 (found and processed) or 404 (no brain waiting)
      if (response.status !== 200 && response.status !== 404) {
        console.error(
          `POST /webhooks/system/ui-form returned ${response.status}, expected 200 or 404`
        );
        return false;
      }

      const data = (await response.json()) as {
        received: boolean;
        action: string;
        identifier?: string;
      };

      // Validate response structure
      if (typeof data.received !== 'boolean') {
        console.error(
          `Expected received to be boolean, got ${typeof data.received}`
        );
        return false;
      }

      if (!data.action || typeof data.action !== 'string') {
        console.error(
          `Expected action to be string, got ${typeof data.action}`
        );
        return false;
      }

      // Action should be 'resumed' or 'not_found'
      if (data.action !== 'resumed' && data.action !== 'not_found') {
        console.error(
          `Expected action to be 'resumed' or 'not_found', got '${data.action}'`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to test POST /webhooks/system/ui-form:', error);
      return false;
    }
  },

  /**
   * Test POST /webhooks/system/ui-form with missing identifier - Should return 400
   */
  async uiFormMissingIdentifier(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/webhooks/system/ui-form', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'test=data',
      });

      const response = await fetch(request);

      if (response.status !== 400) {
        console.error(
          `POST /webhooks/system/ui-form without identifier returned ${response.status}, expected 400`
        );
        return false;
      }

      const data = (await response.json()) as { error: string };

      if (!data.error || typeof data.error !== 'string') {
        console.error(`Expected error to be string, got ${typeof data.error}`);
        return false;
      }

      if (!data.error.toLowerCase().includes('identifier')) {
        console.error(
          `Expected error message to mention identifier, got: ${data.error}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        'Failed to test POST /webhooks/system/ui-form without identifier:',
        error
      );
      return false;
    }
  },
};

export const pages = {
  /**
   * Test GET /pages - List all pages
   */
  async list(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/pages', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /pages returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        pages: Array<{
          slug: string;
          url: string;
          brainRunId: string;
          persist: boolean;
          ttl?: number;
          createdAt: string;
          size: number;
        }>;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.pages)) {
        console.error(
          `Expected pages to be an array, got ${typeof data.pages}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each page has required fields
      for (const page of data.pages) {
        if (
          !page.slug ||
          typeof page.slug !== 'string' ||
          !page.url ||
          typeof page.url !== 'string' ||
          !page.brainRunId ||
          typeof page.brainRunId !== 'string' ||
          typeof page.persist !== 'boolean' ||
          !page.createdAt ||
          typeof page.createdAt !== 'string' ||
          typeof page.size !== 'number'
        ) {
          console.error(
            `Page missing required fields or has invalid types: ${JSON.stringify(
              page
            )}`
          );
          return false;
        }

        // ttl is optional
        if (page.ttl !== undefined && typeof page.ttl !== 'number') {
          console.error(`Page ttl has invalid type: ${typeof page.ttl}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /pages:`, error);
      return false;
    }
  },

  /**
   * Test POST /pages - Create a new page
   */
  async create(
    fetch: Fetch,
    slug: string,
    html: string,
    brainRunId: string,
    options?: { persist?: boolean; ttl?: number }
  ): Promise<string | null> {
    try {
      const body: {
        slug: string;
        html: string;
        brainRunId: string;
        persist?: boolean;
        ttl?: number;
      } = { slug, html, brainRunId };
      if (options?.persist !== undefined) {
        body.persist = options.persist;
      }
      if (options?.ttl !== undefined) {
        body.ttl = options.ttl;
      }

      const request = new Request('http://example.com/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(`POST /pages returned ${response.status}, expected 201`);
        return null;
      }

      const data = (await response.json()) as {
        slug: string;
        url: string;
        brainRunId: string;
        persist: boolean;
        ttl?: number;
        createdAt: string;
      };

      // Validate response structure
      if (!data.slug || typeof data.slug !== 'string') {
        console.error(`Expected slug to be string, got ${typeof data.slug}`);
        return null;
      }

      if (data.slug !== slug) {
        console.error(`Expected slug to be '${slug}', got ${data.slug}`);
        return null;
      }

      if (!data.url || typeof data.url !== 'string') {
        console.error(`Expected url to be string, got ${typeof data.url}`);
        return null;
      }

      if (!data.brainRunId || typeof data.brainRunId !== 'string') {
        console.error(
          `Expected brainRunId to be string, got ${typeof data.brainRunId}`
        );
        return null;
      }

      if (typeof data.persist !== 'boolean') {
        console.error(
          `Expected persist to be boolean, got ${typeof data.persist}`
        );
        return null;
      }

      if (!data.createdAt || typeof data.createdAt !== 'string') {
        console.error(
          `Expected createdAt to be string, got ${typeof data.createdAt}`
        );
        return null;
      }

      return data.slug;
    } catch (error) {
      console.error(`Failed to test POST /pages:`, error);
      return null;
    }
  },

  /**
   * Test GET /pages/:slug - Get page HTML content
   */
  async get(fetch: Fetch, slug: string): Promise<string | null> {
    try {
      const request = new Request(
        `http://example.com/pages/${encodeURIComponent(slug)}`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        console.error(`GET /pages/${slug} returned ${response.status}`);
        return null;
      }

      // Check content type is HTML
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('text/html')) {
        console.error(
          `Expected content-type to be text/html, got ${contentType}`
        );
        return null;
      }

      const html = await response.text();
      return html;
    } catch (error) {
      console.error(`Failed to test GET /pages/${slug}:`, error);
      return null;
    }
  },

  /**
   * Test GET /pages/:slug/meta - Get page metadata
   */
  async getMeta(
    fetch: Fetch,
    slug: string
  ): Promise<{
    slug: string;
    brainRunId: string;
    persist: boolean;
    ttl?: number;
    createdAt: string;
    size: number;
  } | null> {
    try {
      const request = new Request(
        `http://example.com/pages/${encodeURIComponent(slug)}/meta`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        console.error(`GET /pages/${slug}/meta returned ${response.status}`);
        return null;
      }

      const data = (await response.json()) as {
        slug: string;
        brainRunId: string;
        persist: boolean;
        ttl?: number;
        createdAt: string;
        size: number;
      };

      // Validate response structure
      if (
        !data.slug ||
        typeof data.slug !== 'string' ||
        !data.brainRunId ||
        typeof data.brainRunId !== 'string' ||
        typeof data.persist !== 'boolean' ||
        !data.createdAt ||
        typeof data.createdAt !== 'string' ||
        typeof data.size !== 'number'
      ) {
        console.error(
          `Page metadata missing required fields: ${JSON.stringify(data)}`
        );
        return null;
      }

      return data;
    } catch (error) {
      console.error(`Failed to test GET /pages/${slug}/meta:`, error);
      return null;
    }
  },

  /**
   * Test PUT /pages/:slug - Update page HTML content
   */
  async update(fetch: Fetch, slug: string, html: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/pages/${encodeURIComponent(slug)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ html }),
        }
      );

      const response = await fetch(request);

      if (response.status === 404) {
        console.error(`PUT /pages/${slug} returned 404 - page not found`);
        return false;
      }

      if (!response.ok) {
        console.error(`PUT /pages/${slug} returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        slug: string;
        url: string;
        updatedAt: string;
      };

      // Validate response structure
      if (!data.slug || data.slug !== slug) {
        console.error(`Expected slug to be '${slug}', got ${data.slug}`);
        return false;
      }

      if (!data.url || typeof data.url !== 'string') {
        console.error(`Expected url to be string, got ${typeof data.url}`);
        return false;
      }

      if (!data.updatedAt || typeof data.updatedAt !== 'string') {
        console.error(
          `Expected updatedAt to be string, got ${typeof data.updatedAt}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test PUT /pages/${slug}:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /pages/:slug - Delete a page
   */
  async delete(fetch: Fetch, slug: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/pages/${encodeURIComponent(slug)}`,
        {
          method: 'DELETE',
        }
      );

      const response = await fetch(request);

      if (response.status !== 204) {
        console.error(
          `DELETE /pages/${slug} returned ${response.status}, expected 204`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /pages/${slug}:`, error);
      return false;
    }
  },

  /**
   * Test GET /pages/:slug with non-existent page - Should return 404
   */
  async notFound(fetch: Fetch, slug: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/pages/${encodeURIComponent(slug)}`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (response.status !== 404) {
        console.error(
          `GET /pages/${slug} with non-existent page returned ${response.status}, expected 404`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test GET /pages/${slug} with non-existent page:`,
        error
      );
      return false;
    }
  },

  /**
   * Test DELETE /pages/:slug preserves resources - deleting a page should not delete resources
   */
  async deletePreservesResources(fetch: Fetch): Promise<boolean> {
    try {
      // First create a resource
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['test content for spec'], { type: 'text/plain' }),
        'spec-test-resource.txt'
      );
      formData.append('type', 'text');
      formData.append('key', 'spec-test-resource.txt');
      formData.append('local', 'false');

      const createResourceRequest = new Request('http://example.com/resources', {
        method: 'POST',
        body: formData,
      });

      const createResourceResponse = await fetch(createResourceRequest);
      if (createResourceResponse.status !== 201) {
        console.error(
          `Failed to create test resource: ${createResourceResponse.status}`
        );
        return false;
      }

      // Create a page to delete
      const pageSlug = `spec-test-page-${Date.now()}`;
      const createPageRequest = new Request('http://example.com/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          slug: pageSlug,
          html: '<html><body>Test page</body></html>',
          brainRunId: 'spec-test-brain-run-id',
        }),
      });

      const createPageResponse = await fetch(createPageRequest);
      if (createPageResponse.status !== 201) {
        console.error(
          `Failed to create test page: ${createPageResponse.status}`
        );
        // Clean up resource
        await fetch(
          new Request(
            'http://example.com/resources/spec-test-resource.txt',
            { method: 'DELETE' }
          )
        );
        return false;
      }

      // Delete the page
      const deletePageRequest = new Request(
        `http://example.com/pages/${encodeURIComponent(pageSlug)}`,
        { method: 'DELETE' }
      );

      const deletePageResponse = await fetch(deletePageRequest);
      if (deletePageResponse.status !== 204) {
        console.error(
          `DELETE /pages/${pageSlug} returned ${deletePageResponse.status}, expected 204`
        );
        // Clean up resource
        await fetch(
          new Request(
            'http://example.com/resources/spec-test-resource.txt',
            { method: 'DELETE' }
          )
        );
        return false;
      }

      // Verify the resource still exists
      const listResourcesRequest = new Request('http://example.com/resources', {
        method: 'GET',
      });

      const listResourcesResponse = await fetch(listResourcesRequest);
      if (!listResourcesResponse.ok) {
        console.error(
          `GET /resources returned ${listResourcesResponse.status}`
        );
        return false;
      }

      const resourcesData = (await listResourcesResponse.json()) as {
        resources: Array<{ key: string }>;
      };

      const resourceExists = resourcesData.resources.some(
        (r) => r.key === 'spec-test-resource.txt'
      );

      if (!resourceExists) {
        console.error(
          'DELETE /pages incorrectly deleted resources - resource not found after page delete'
        );
        return false;
      }

      // Clean up: delete the test resource
      await fetch(
        new Request(
          'http://example.com/resources/spec-test-resource.txt',
          { method: 'DELETE' }
        )
      );

      return true;
    } catch (error) {
      console.error(
        `Failed to test DELETE /pages preserves resources:`,
        error
      );
      return false;
    }
  },
};

/**
 * Bundle API Tests
 *
 * Tests for the /bundle/components.js endpoint which serves the component bundle.
 *
 * NOTE: These tests only verify the API endpoint behavior. The bundle build and
 * upload process is backend-specific and must be tested separately by each
 * backend implementation.
 */
export const bundle = {
  /**
   * Test GET /bundle/components.js - Serve the component bundle
   */
  async get(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/bundle/components.js', {
        method: 'GET',
      });

      const response = await fetch(request);

      // Bundle may or may not exist depending on project setup
      // 200 = bundle exists and served correctly
      // 404 = bundle not found (expected if no components/ directory)
      if (response.status !== 200 && response.status !== 404) {
        console.error(
          `GET /bundle/components.js returned unexpected status ${response.status}`
        );
        return false;
      }

      const contentType = response.headers.get('Content-Type');
      if (!contentType || !contentType.includes('application/javascript')) {
        console.error(
          `Expected Content-Type application/javascript, got ${contentType}`
        );
        return false;
      }

      // If 200, verify we got some content
      if (response.status === 200) {
        const content = await response.text();
        if (!content || content.length === 0) {
          console.error('Bundle endpoint returned 200 but empty content');
          return false;
        }
      }

      // If 404, verify we got the helpful error message
      if (response.status === 404) {
        const content = await response.text();
        if (!content.includes('Bundle not found')) {
          console.error(
            'Bundle 404 response missing helpful error message'
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /bundle/components.js:`, error);
      return false;
    }
  },
};