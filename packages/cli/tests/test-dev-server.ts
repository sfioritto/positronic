import type { PositronicDevServer, ServerHandle } from '@positronic/spec';
import nock from 'nock';
import { parse } from 'dotenv';
import fs from 'fs';

interface MockResource {
  key: string;
  type: 'text' | 'binary';
  size: number;
  lastModified: string;
  local?: boolean;
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
  private _errorCallback?: (error: Error) => void;
  private _closeCallback?: (code?: number | null) => void;

  constructor(
    private stopFn: () => void,
    private getLogsFn: () => MethodCall[],
    private clearLogsFn: () => void,
    private port: number
  ) {}

  onClose(callback: (code?: number | null) => void): void {
    this._closeCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this._errorCallback = callback;
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
  brainTitle: string;
  cronExpression: string;
  enabled: boolean;
  createdAt: number;
  nextRunAt?: number;
}

interface MockScheduleRun {
  id: string;
  scheduleId: string;
  status: 'triggered' | 'failed';
  ranAt: number;
  brainRunId?: string;
  error?: string;
}

interface MockBrain {
  filename: string;
  title: string;
  description: string;
  createdAt?: number;
  lastModified?: number;
  steps?: Array<{
    type: 'step' | 'brain';
    title: string;
    innerBrain?: {
      title: string;
      description?: string;
      steps: any[];
    };
  }>;
}

interface MockBrainRun {
  brainRunId: string;
  brainTitle: string;
  brainDescription?: string;
  type: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'ERROR';
  options?: any;
  error?: any;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

interface MockSecret {
  name: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export class TestDevServer implements PositronicDevServer {
  private resources: Map<string, MockResource> = new Map();
  private schedules: Map<string, MockSchedule> = new Map();
  private scheduleRuns: MockScheduleRun[] = [];
  private brains: Map<string, MockBrain> = new Map();
  private brainRuns: MockBrainRun[] = [];
  private secrets: Map<string, MockSecret> = new Map();
  public port: number = 0;
  private callLog: MethodCall[] = [];
  private nockScope: nock.Scope | null = null;
  private logCallbacks: Array<(message: string) => void> = [];
  private errorCallbacks: Array<(message: string) => void> = [];
  private warningCallbacks: Array<(message: string) => void> = [];

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

    process.env.POSITRONIC_PORT = this.port.toString();

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
          this.logCall('deleteResource', [key]);
          return [204, ''];
        } else {
          // Check if it was already deleted (idempotent delete)
          const wasDeleted = this.callLog.some(
            (call) => call.method === 'deleteResource' && call.args[0] === key
          );
          if (wasDeleted) {
            // Return success for idempotent delete
            return [204, ''];
          }
          return [
            404,
            JSON.stringify({ error: `Resource "${key}" not found` }),
          ];
        }
      }
      return [404, 'Not Found'];
    });

    // POST /brains/runs
    nockInstance.post('/brains/runs').reply((uri, requestBody) => {
      const body =
        typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;

      // Check if brain exists (for testing brain not found scenario)
      if (body.brainTitle === 'non-existent-brain') {
        this.logCall('createBrainRun', [body.brainTitle]);
        return [404, { error: `Brain '${body.brainTitle}' not found` }];
      }

      let brainRunId = `run-${Date.now()}`;

      // Return specific runIds for specific test scenarios
      if (body.brainTitle === 'error-brain') {
        brainRunId = 'test-error-brain';
      } else if (body.brainTitle === 'restart-brain') {
        brainRunId = 'test-restart-brain';
      } else if (body.brainTitle === 'multi-status-brain') {
        brainRunId = 'test-multi-status';
      }

      this.logCall('createBrainRun', [body.brainTitle, body.options]);
      return [201, { brainRunId }];
    });

    // POST /brains/runs/rerun
    nockInstance.post('/brains/runs/rerun').reply((uri, requestBody) => {
      const body =
        typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;

      // Check if brain exists
      if (body.brainTitle === 'non-existent-brain') {
        this.logCall('rerunBrain', [
          body.brainTitle,
          body.runId,
          body.startsAt,
          body.stopsAfter,
        ]);
        return [404, { error: `Brain '${body.brainTitle}' not found` }];
      }

      // Check if run ID exists (if provided)
      if (body.runId === 'non-existent-run') {
        this.logCall('rerunBrain', [
          body.brainTitle,
          body.runId,
          body.startsAt,
          body.stopsAfter,
        ]);
        return [404, { error: `Brain run '${body.runId}' not found` }];
      }

      const newBrainRunId = `rerun-${Date.now()}`;

      this.logCall('rerunBrain', [
        body.brainTitle,
        body.runId,
        body.startsAt,
        body.stopsAfter,
      ]);
      return [201, { brainRunId: newBrainRunId }];
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
                  stack:
                    'Error: Something went wrong during brain execution\n    at BrainRunner.run',
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

    // GET /brains
    nockInstance.get('/brains').reply(200, () => {
      const brains = Array.from(this.brains.values());
      this.logCall('getBrains', []);
      return {
        brains,
        count: brains.length,
      };
    });

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
      const body =
        typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
      const scheduleId = `schedule-${Date.now()}`;
      const schedule: MockSchedule = {
        id: scheduleId,
        brainTitle: body.brainTitle,
        cronExpression: body.cronExpression,
        enabled: true,
        createdAt: Date.now(),
        nextRunAt: Date.now() + 3600000, // 1 hour from now
      };
      this.schedules.set(scheduleId, schedule);
      this.logCall('createSchedule', [body]);
      return schedule;
    });

    // GET /brains/schedules/runs
    nockInstance
      .get('/brains/schedules/runs')
      .query(true)
      .reply((uri) => {
        const url = new URL(uri, 'http://example.com');
        const scheduleId = url.searchParams.get('scheduleId');
        const limit = parseInt(url.searchParams.get('limit') || '100', 10);

        this.logCall('getScheduleRuns', [uri]);

        let runs = this.scheduleRuns;

        // Filter by scheduleId if provided
        if (scheduleId) {
          runs = runs.filter((run) => run.scheduleId === scheduleId);
        }

        // Sort by ranAt descending (newest first)
        runs = runs.sort((a, b) => b.ranAt - a.ranAt);

        // Apply limit
        runs = runs.slice(0, limit);

        return [
          200,
          {
            runs,
            count: runs.length,
          },
        ];
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

    // GET /brains/:brainName/history
    nockInstance
      .get(/^\/brains\/(.+)\/history$/)
      .query(true)
      .reply((uri) => {
        const parts = uri.split('/');
        const brainName = decodeURIComponent(parts[2]);
        const url = new URL(uri, 'http://example.com');
        const limit = parseInt(url.searchParams.get('limit') || '10', 10);

        this.logCall('getBrainHistory', [brainName, limit]);

        // Filter runs by brain title
        const runs = this.brainRuns
          .filter(
            (run) =>
              run.brainTitle.toLowerCase() ===
              brainName.toLowerCase().replace(/-/g, ' ')
          )
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, limit);

        return [200, { runs }];
      });

    // GET /brains/:brainName/active-runs
    nockInstance.get(/^\/brains\/(.+)\/active-runs$/).reply((uri) => {
      const parts = uri.split('/');
      const brainName = decodeURIComponent(parts[2]);

      this.logCall('getBrainActiveRuns', [brainName]);

      // Filter brain runs by brain title and status RUNNING
      const activeRuns = this.brainRuns
        .filter(
          (run) =>
            run.brainTitle.toLowerCase() ===
              brainName.toLowerCase().replace(/-/g, ' ') &&
            run.status === 'RUNNING'
        )
        .sort((a, b) => b.createdAt - a.createdAt);

      return [200, { runs: activeRuns }];
    });

    // GET /brains/:brainName
    nockInstance.get(/^\/brains\/(.+)$/).reply((uri) => {
      const brainName = decodeURIComponent(uri.split('/')[2]);
      const brain = this.brains.get(brainName);
      this.logCall('getBrain', [brainName]);

      if (!brain) {
        return [404, { error: `Brain '${brainName}' not found` }];
      }

      return [
        200,
        {
          filename: brain.filename,
          title: brain.title,
          description: brain.description || `${brain.title} brain`,
          steps: brain.steps || [],
        },
      ];
    });

    // Secret Management Endpoints

    // POST /secrets
    nockInstance.post('/secrets').reply(201, (uri, requestBody) => {
      const body =
        typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;

      const now = new Date().toISOString();
      const secret: MockSecret = {
        name: body.name,
        value: body.value,
        createdAt: now,
        updatedAt: now,
      };

      this.secrets.set(body.name, secret);
      this.logCall('createSecret', [body.name]);

      // Return without the value for security
      return {
        name: secret.name,
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
      };
    });

    // GET /secrets
    nockInstance.get('/secrets').reply(200, () => {
      this.logCall('listSecrets', []);

      // Return secrets without values
      const secrets = Array.from(this.secrets.values()).map((secret) => ({
        name: secret.name,
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
      }));

      return {
        secrets,
        count: secrets.length,
      };
    });

    // DELETE /secrets/:name
    nockInstance.delete(/^\/secrets\/(.+)$/).reply((uri) => {
      const match = uri.match(/^\/secrets\/(.+)$/);
      if (match) {
        const secretName = decodeURIComponent(match[1]);

        if (this.secrets.has(secretName)) {
          this.secrets.delete(secretName);
          this.logCall('deleteSecret', [secretName]);
          return [204, ''];
        } else {
          return [404, { error: `Secret "${secretName}" not found` }];
        }
      }
      return [404, 'Not Found'];
    });

    // GET /secrets/:name/exists
    nockInstance.get(/^\/secrets\/(.+)\/exists$/).reply((uri) => {
      const match = uri.match(/^\/secrets\/(.+)\/exists$/);
      if (match) {
        const secretName = decodeURIComponent(match[1]);
        const exists = this.secrets.has(secretName);

        this.logCall('secretExists', [secretName]);

        return [200, { exists }];
      }
      return [404, 'Not Found'];
    });

    // POST /secrets/bulk
    nockInstance.post('/secrets/bulk').reply(201, (uri, requestBody) => {
      const body =
        typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;

      let created = 0;
      let updated = 0;
      const now = new Date().toISOString();

      for (const secretData of body.secrets) {
        const existing = this.secrets.has(secretData.name);

        const secret: MockSecret = {
          name: secretData.name,
          value: secretData.value,
          createdAt: existing
            ? this.secrets.get(secretData.name)!.createdAt
            : now,
          updatedAt: now,
        };

        this.secrets.set(secretData.name, secret);

        if (existing) {
          updated++;
        } else {
          created++;
        }
      }

      this.logCall('bulkCreateSecrets', [body.secrets.length]);

      return { created, updated };
    });

    this.nockScope = nockInstance;

    // Simulate some initial log output after server starts
    setTimeout(() => {
      this.logCallbacks.forEach((cb) =>
        cb('✅ Synced 3 resources (0 up to date, 0 deleted)\n')
      );
      this.logCallbacks.forEach((cb) =>
        cb('🚀 Server started on port ' + this.port + '\n')
      );
    }, 100);

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

  addScheduleRun(run: MockScheduleRun) {
    this.scheduleRuns.push(run);
  }

  clearScheduleRuns() {
    this.scheduleRuns = [];
  }

  getSchedules(): MockSchedule[] {
    return Array.from(this.schedules.values());
  }

  // Secret helper methods
  addSecret(name: string, value: string) {
    const now = new Date().toISOString();
    this.secrets.set(name, {
      name,
      value,
      createdAt: now,
      updatedAt: now,
    });
  }

  clearSecrets() {
    this.secrets.clear();
  }

  getSecrets(): MockSecret[] {
    return Array.from(this.secrets.values());
  }

  getSecret(name: string): MockSecret | undefined {
    return this.secrets.get(name);
  }

  // Brain helper methods
  addBrain(brain: MockBrain) {
    this.brains.set(brain.filename, brain);
  }

  addBrainRun(run: MockBrainRun) {
    this.brainRuns.push(run);
  }

  clearBrainRuns() {
    this.brainRuns = [];
  }

  clearBrains() {
    this.brains.clear();
  }

  getBrains(): MockBrain[] {
    return Array.from(this.brains.values());
  }

  stop() {
    if (this.nockScope) {
      // Clean up all nock interceptors
      nock.cleanAll();
      this.nockScope = null;
    }
  }

  onLog(callback: (message: string) => void): void {
    this.logCall('onLog', ['callback registered']);
    this.logCallbacks.push(callback);
  }

  onError(callback: (message: string) => void): void {
    this.logCall('onError', ['callback registered']);
    this.errorCallbacks.push(callback);
  }

  onWarning(callback: (message: string) => void): void {
    this.logCall('onWarning', ['callback registered']);
    this.warningCallbacks.push(callback);
  }

  async listSecrets(): Promise<
    Array<{ name: string; createdAt?: Date; updatedAt?: Date }>
  > {
    this.logCall('listSecrets', []);
    return Array.from(this.secrets.values()).map((secret) => ({
      name: secret.name,
      createdAt: new Date(secret.createdAt),
      updatedAt: new Date(secret.updatedAt),
    }));
  }

  async setSecret(name: string, value: string): Promise<void> {
    this.logCall('setSecret', [name, value]);
    const now = new Date().toISOString();
    const existing = this.secrets.get(name);

    this.secrets.set(name, {
      name,
      value,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
  }

  async deleteSecret(name: string): Promise<boolean> {
    this.logCall('deleteSecret', [name]);
    if (this.secrets.has(name)) {
      this.secrets.delete(name);
      return true;
    }
    return false;
  }

  async bulkSecrets(filePath: string): Promise<void> {
    this.logCall('bulkSecrets', [filePath]);

    try {
      // Read and parse the .env file
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const envContent = fs.readFileSync(filePath, 'utf8');
      const secrets = parse(envContent);

      const secretsArray = Object.entries(secrets);

      if (secretsArray.length === 0) {
        throw new Error('No secrets found in the .env file');
      }

      // Simulate the bulk upload - just store them
      const now = new Date().toISOString();
      for (const [name, value] of secretsArray) {
        const existing = this.secrets.has(name);
        this.secrets.set(name, {
          name,
          value,
          createdAt: existing ? this.secrets.get(name)!.createdAt : now,
          updatedAt: now,
        });
      }

      // Simulate console output
      this.logCallbacks.forEach((cb) =>
        cb(`✨ Successfully uploaded ${secretsArray.length} secrets\n`)
      );
    } catch (error) {
      throw error;
    }
  }
}
