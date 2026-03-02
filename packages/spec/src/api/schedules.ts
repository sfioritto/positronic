import type { Fetch } from './types.js';

export const schedules = {
  /**
   * Test POST /brains/schedules - Create a new schedule
   */
  async create(
    fetch: Fetch,
    identifier: string,
    cronExpression: string,
    timezone?: string
  ): Promise<string | null> {
    try {
      const body: Record<string, string> = { identifier, cronExpression };
      if (timezone) {
        body.timezone = timezone;
      }

      const request = new Request('http://example.com/brains/schedules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /brains/schedules returned ${response.status}, expected 201`
        );
        return null;
      }

      const data = (await response.json()) as {
        id: string;
        brainTitle: string;
        cronExpression: string;
        timezone: string;
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

      const data = (await response.json()) as {
        schedules: Array<{
          id: string;
          brainTitle: string;
          cronExpression: string;
          timezone: string;
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
        console.error(
          `GET /brains/schedules/runs returned ${response.status}`
        );
        return false;
      }

      const data = (await response.json()) as {
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

  /**
   * Test GET /brains/schedules/timezone - Get project timezone
   */
  async getTimezone(fetch: Fetch): Promise<string | null> {
    try {
      const request = new Request(
        'http://example.com/brains/schedules/timezone',
        { method: 'GET' }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `GET /brains/schedules/timezone returned ${response.status}`
        );
        return null;
      }

      const data = (await response.json()) as { timezone: string };

      if (typeof data.timezone !== 'string') {
        console.error(
          `Expected timezone to be string, got ${typeof data.timezone}`
        );
        return null;
      }

      return data.timezone;
    } catch (error) {
      console.error(
        `Failed to test GET /brains/schedules/timezone:`,
        error
      );
      return null;
    }
  },

  /**
   * Test PUT /brains/schedules/timezone - Set project timezone
   */
  async setTimezone(fetch: Fetch, timezone: string): Promise<boolean> {
    try {
      const request = new Request(
        'http://example.com/brains/schedules/timezone',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timezone }),
        }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `PUT /brains/schedules/timezone returned ${response.status}`
        );
        return false;
      }

      const data = (await response.json()) as { timezone: string };

      if (data.timezone !== timezone) {
        console.error(
          `Expected timezone to be '${timezone}', got '${data.timezone}'`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test PUT /brains/schedules/timezone:`,
        error
      );
      return false;
    }
  },
};
