import type { PositronicDevServer, ServerHandle } from '@positronic/spec';
import nock from 'nock';

interface MockResource {
  key: string;
  type: 'text' | 'binary';
  size: number;
  lastModified: string;
}

export interface MethodCall {
  method: string;
  args: any[];
  timestamp: number;
}

/**
 * Extended ServerHandle interface for testing that includes test-specific methods
 */
export interface TestServerHandle extends ServerHandle {
  /**
   * Get the method call logs
   */
  getLogs(): MethodCall[];

  /**
   * Clear the method call logs
   */
  clearLogs(): void;
}

/**
 * Mock implementation of TestServerHandle for testing
 * Since we're using nock, there's no real process to manage
 */
class MockServerHandle implements TestServerHandle {
  private _killed = false;

  constructor(
    private stopFn: () => void,
    private getLogsFn: () => MethodCall[],
    private clearLogsFn: () => void,
    private port: number
  ) {}

  onClose(callback: (code?: number | null) => void): void {
    // No-op for tests - nock doesn't have lifecycle events
  }

  onError(callback: (error: Error) => void): void {
    // No-op for tests - nock doesn't have lifecycle events
  }

  kill(signal?: string): boolean {
    if (!this._killed) {
      this.stopFn();
      this._killed = true;
      return true;
    }
    return false;
  }

  get killed(): boolean {
    return this._killed;
  }

  async waitUntilReady(maxWaitMs?: number): Promise<boolean> {
    // Test server with nock is always ready immediately
    return true;
  }

  getLogs(): MethodCall[] {
    return this.getLogsFn();
  }

  clearLogs(): void {
    this.clearLogsFn();
  }
}

interface MockSchedule {
  id: string;
  brainName: string;
  cronExpression: string;
  enabled: boolean;
  createdAt: number;
  nextRunAt?: number;
}

export class TestDevServer implements PositronicDevServer {
  private resources: Map<string, MockResource> = new Map();
  private schedules: Map<string, MockSchedule> = new Map();
  public port: number = 0;
  private callLog: MethodCall[] = [];
  private nockScope: nock.Scope | null = null;

  constructor(public projectRootDir: string = '') {}

  private logCall(method: string, args: any[]) {
    const call: MethodCall = {
      method,
      args,
      timestamp: Date.now(),
    };
    this.callLog.push(call);
  }

  async deploy(config?: any): Promise<void> {
    this.logCall('deploy', [this.projectRootDir, config]);
  }

  async setup(force?: boolean): Promise<void> {
    this.logCall('setup', [force]);
    // For tests, we don't need to set up .positronic directory
    // Just ensure we're ready to serve
  }

  public getLogs(): MethodCall[] {
    return this.callLog;
  }

  async start(port?: number): Promise<TestServerHandle> {
    this.logCall('start', [port]);

    this.port = port || 9000 + Math.floor(Math.random() * 1000);

    process.env.POSITRONIC_SERVER_PORT = this.port.toString();

    // Set up nock interceptors for all endpoints
    const nockInstance = nock(`http://localhost:${this.port}`).persist();

    // GET /resources
    nockInstance.get('/resources').reply(200, () => {
      // Return the current in-memory resource list (populated by uploads)
      const resources = Array.from(this.resources.values());
      return {
        resources,
        truncated: false,
        count: resources.length,
      };
    });

    // POST /resources
    nockInstance.post('/resources').reply(201, (uri, requestBody) => {
      // Convert request body to string using latin1 encoding to preserve binary data
      let bodyString = Buffer.isBuffer(requestBody)
        ? requestBody.toString('latin1')
        : typeof requestBody === 'string'
        ? requestBody
        : JSON.stringify(requestBody);

      // Check if the body string appears to be hex-encoded (all characters are hex)
      const isHexEncoded = /^[0-9a-fA-F]+$/.test(bodyString);
      if (isHexEncoded) {
        // Convert hex string back to buffer and then to latin1 string
        const hexBuffer = Buffer.from(bodyString, 'hex');
        bodyString = hexBuffer.toString('latin1');
      }

      // Attempt to extract the "key" (resource path) and "type" fields from the multipart data
      const keyMatch = bodyString.match(/name="key"\s*\r?\n\r?\n([^\r\n]+)/);
      const typeMatch = bodyString.match(/name="type"\s*\r?\n\r?\n([^\r\n]+)/);

      const key = keyMatch ? keyMatch[1] : undefined;
      const type = typeMatch ? (typeMatch[1] as 'text' | 'binary') : 'text';

      if (key) {
        this.resources.set(key, {
          key,
          type,
          size: 0,
          lastModified: new Date().toISOString(),
        });
      }

      // Log the upload so tests can verify resource sync behavior
      this.logCall('upload', [bodyString]);

      // Success response
      return '';
    });

    // DELETE /resources (bulk delete all)
    nockInstance.delete('/resources').reply(204, () => {
      this.resources.clear();
      this.logCall('deleteAllResources', []);
      return '';
    });

    // DELETE /resources/:key
    nockInstance.delete(/^\/resources\/(.+)$/).reply((uri) => {
      const match = uri.match(/^\/resources\/(.+)$/);
      if (match) {
        const key = decodeURIComponent(match[1]);
        if (this.resources.has(key)) {
          this.resources.delete(key);
          return [204, ''];
        } else {
          return [
            404,
            JSON.stringify({ error: `Resource "${key}" not found` }),
          ];
        }
      }
      return [404, 'Not Found'];
    });

    // POST /brains/runs
    nockInstance.post('/brains/runs').reply(201, (uri, requestBody) => {
      const body = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
      let brainRunId = `run-${Date.now()}`;
      
      // Return specific runIds for specific test scenarios
      if (body.brainName === 'error-brain') {
        brainRunId = 'test-error-brain';
      } else if (body.brainName === 'restart-brain') {
        brainRunId = 'test-restart-brain';
      } else if (body.brainName === 'multi-status-brain') {
        brainRunId = 'test-multi-status';
      }
      
      this.logCall('createBrainRun', [brainRunId]);
      return { brainRunId };
    });

    // GET /brains/runs/:runId/watch (SSE endpoint)
    nockInstance.get(/^\/brains\/runs\/(.+)\/watch$/).reply(
      200,
      function (uri) {
        const match = uri.match(/^\/brains\/runs\/(.+)\/watch$/);
        if (match) {
          const runId = match[1];
          
          // Different scenarios based on runId
          if (runId === 'test-error-brain') {
            // Error scenario
            return [
              `data: ${JSON.stringify({
                type: 'brain:start',
                brainTitle: 'Error Brain',
                brainRunId: runId,
                options: {},
                status: 'running',
                initialState: {},
              })}\n\n`,
              `data: ${JSON.stringify({
                type: 'brain:error',
                brainRunId: runId,
                brainTitle: 'Error Brain',
                options: {},
                status: 'error',
                error: {
                  name: 'TestError',
                  message: 'Something went wrong in the brain',
                  stack: 'Error: Something went wrong\n    at test.js:1:1',
                },
              })}\n\n`,
            ].join('');
          } else if (runId === 'test-restart-brain') {
            // Restart scenario
            return [
              `data: ${JSON.stringify({
                type: 'brain:restart',
                brainTitle: 'Restarted Brain',
                brainRunId: runId,
                options: {},
                status: 'running',
                initialState: {},
              })}\n\n`,
              `data: ${JSON.stringify({
                type: 'step:status',
                brainRunId: runId,
                options: {},
                steps: [
                  {
                    id: 'restart-step-1',
                    title: 'Restart Step',
                    status: 'pending',
                  },
                ],
              })}\n\n`,
            ].join('');
          } else if (runId === 'test-multi-status') {
            // Multiple step statuses
            return [
              `data: ${JSON.stringify({
                type: 'brain:start',
                brainTitle: 'Multi Status Brain',
                brainRunId: runId,
                options: {},
                status: 'running',
                initialState: {},
              })}\n\n`,
              `data: ${JSON.stringify({
                type: 'step:status',
                brainRunId: runId,
                options: {},
                steps: [
                  { id: 'step-1', title: 'Complete Step', status: 'complete' },
                  { id: 'step-2', title: 'Error Step', status: 'error' },
                  { id: 'step-3', title: 'Running Step', status: 'running' },
                  { id: 'step-4', title: 'Pending Step', status: 'pending' },
                ],
              })}\n\n`,
            ].join('');
          } else if (runId === 'test-complete-flow') {
            // Full flow from start to complete
            return [
              `data: ${JSON.stringify({
                type: 'brain:start',
                brainTitle: 'Complete Flow Brain',
                brainRunId: runId,
                options: {},
                status: 'running',
                initialState: {},
              })}\n\n`,
              `data: ${JSON.stringify({
                type: 'step:status',
                brainRunId: runId,
                options: {},
                steps: [
                  { id: 'step-1', title: 'First Step', status: 'complete' },
                  { id: 'step-2', title: 'Second Step', status: 'complete' },
                ],
              })}\n\n`,
              `data: ${JSON.stringify({
                type: 'brain:complete',
                brainRunId: runId,
                brainTitle: 'Complete Flow Brain',
                options: {},
                status: 'complete',
              })}\n\n`,
            ].join('');
          } else if (runId === 'test-brain-error') {
            // Brain error scenario
            return [
              `data: ${JSON.stringify({
                type: 'brain:start',
                brainTitle: 'Error Brain',
                brainRunId: runId,
                options: {},
                status: 'running',
                initialState: {},
              })}\n\n`,
              `data: ${JSON.stringify({
                type: 'brain:error',
                brainRunId: runId,
                brainTitle: 'Error Brain',
                error: {
                  name: 'BrainExecutionError',
                  message: 'Something went wrong during brain execution',
                  stack: 'Error: Something went wrong during brain execution\n    at BrainRunner.run',
                },
              })}\n\n`,
            ].join('');
          } else if (runId === 'test-malformed-event') {
            // Send malformed JSON
            return 'data: {invalid json here}\n\n';
          } else if (runId === 'test-no-steps') {
            // Brain with no steps initially
            return [
              `data: ${JSON.stringify({
                type: 'brain:start',
                brainTitle: 'No Steps Brain',
                brainRunId: runId,
                options: {},
                status: 'running',
                initialState: {},
              })}\n\n`,
              `data: ${JSON.stringify({
                type: 'step:status',
                brainRunId: runId,
                options: {},
                steps: [],
              })}\n\n`,
            ].join('');
          } else if (runId === 'test-connection-error') {
            // Simulate connection error by returning error
            throw new Error('ECONNREFUSED');
          } else {
            // Default scenario
            const mockEvents = [
              `data: ${JSON.stringify({
                type: 'brain:start',
                brainTitle: 'test-brain',
                brainRunId: runId,
                options: {},
                status: 'running',
                initialState: {},
              })}\n\n`,
              `data: ${JSON.stringify({
                type: 'step:status',
                brainRunId: runId,
                options: {},
                steps: [
                  {
                    id: 'step-1',
                    title: 'Test Step 1',
                    status: 'running',
                  },
                ],
              })}\n\n`,
              `data: ${JSON.stringify({
                type: 'brain:complete',
                brainRunId: runId,
                brainTitle: 'test-brain',
                options: {},
                status: 'complete',
              })}\n\n`,
            ];
            return mockEvents.join('');
          }
        }
        return 'data: {"type":"ERROR","error":{"message":"Invalid run ID"}}\n\n';
      },
      {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      }
    );

    // GET /brains/schedules
    nockInstance.get('/brains/schedules').reply(200, () => {
      const schedules = Array.from(this.schedules.values());
      this.logCall('getSchedules', []);
      return {
        schedules,
        count: schedules.length,
      };
    });

    // POST /brains/schedules
    nockInstance.post('/brains/schedules').reply(201, (uri, requestBody) => {
      const body = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
      const scheduleId = `schedule-${Date.now()}`;
      const schedule: MockSchedule = {
        id: scheduleId,
        brainName: body.brainName,
        cronExpression: body.cronExpression,
        enabled: true,
        createdAt: Date.now(),
        nextRunAt: Date.now() + 3600000, // 1 hour from now
      };
      this.schedules.set(scheduleId, schedule);
      this.logCall('createSchedule', [body]);
      return schedule;
    });

    // DELETE /brains/schedules/:id
    nockInstance.delete(/^\/brains\/schedules\/(.+)$/).reply((uri) => {
      const match = uri.match(/^\/brains\/schedules\/(.+)$/);
      if (match) {
        const scheduleId = decodeURIComponent(match[1]);
        if (this.schedules.has(scheduleId)) {
          this.schedules.delete(scheduleId);
          this.logCall('deleteSchedule', [scheduleId]);
          return [204, ''];
        } else {
          return [
            404,
            JSON.stringify({ error: `Schedule "${scheduleId}" not found` }),
          ];
        }
      }
      return [404, 'Not Found'];
    });

    this.nockScope = nockInstance;

    return new MockServerHandle(
      () => {
        this.stop();
      },
      () => this.callLog,
      () => {
        this.callLog = [];
      },
      this.port
    );
  }

  // Add watch method to track calls
  async watch(event: 'add' | 'change' | 'unlink') {
    this.logCall('watch', [this.projectRootDir, event]);
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

  // Schedule helper methods
  addSchedule(schedule: MockSchedule) {
    this.schedules.set(schedule.id, schedule);
  }

  clearSchedules() {
    this.schedules.clear();
  }

  getSchedules(): MockSchedule[] {
    return Array.from(this.schedules.values());
  }

  stop() {
    if (this.nockScope) {
      // Clean up all nock interceptors
      nock.cleanAll();
      this.nockScope = null;
    }
  }
}
