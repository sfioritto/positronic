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

    const data = await response.json();

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

      const data = await response.json();

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

      const data = await response.json();

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
        const data = await response.json();
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

      const data = await response.json();

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
        const data = await response.json();
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

      const data = await response.json();

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
  async run(fetch: Fetch, brainName: string): Promise<string | null> {
    try {
      const request = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ brainName }),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /brains/runs returned ${response.status}, expected 201`
        );
        return null;
      }

      const data = await response.json();

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
   * Test GET /brains/:brainName/history - Get history of brain runs
   */
  async history(
    fetch: Fetch,
    brainName: string,
    limit?: number
  ): Promise<boolean> {
    try {
      const url = new URL(
        'http://example.com/brains/' + brainName + '/history'
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
          `GET /brains/${brainName}/history returned ${response.status}`
        );
        return false;
      }

      const data = await response.json();

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
      console.error(`Failed to test GET /brains/${brainName}/history:`, error);
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

      const data = await response.json();

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
          !brain.name ||
          typeof brain.name !== 'string' ||
          !brain.title ||
          typeof brain.title !== 'string' ||
          !brain.description ||
          typeof brain.description !== 'string' ||
          typeof brain.createdAt !== 'number' ||
          typeof brain.lastModified !== 'number'
        ) {
          console.error(
            `Brain missing required fields or has invalid types: ${JSON.stringify(brain)}`
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
};

export const schedules = {
  /**
   * Test POST /brains/schedules - Create a new schedule
   */
  async create(
    fetch: Fetch,
    brainName: string,
    cronExpression: string
  ): Promise<string | null> {
    try {
      const request = new Request('http://example.com/brains/schedules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ brainName, cronExpression }),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /brains/schedules returned ${response.status}, expected 201`
        );
        return null;
      }

      const data = await response.json();

      // Validate response structure
      if (!data.id || typeof data.id !== 'string') {
        console.error(`Expected id to be string, got ${typeof data.id}`);
        return null;
      }

      if (data.brainName !== brainName) {
        console.error(
          `Expected brainName to be '${brainName}', got ${data.brainName}`
        );
        return null;
      }

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

      const data = await response.json();

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
          !schedule.brainName ||
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

      const data = await response.json();

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
