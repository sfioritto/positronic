import { createTestEnv, px } from './test-utils.js';
import nock from 'nock';

describe('pages command', () => {
  describe('pages list', () => {
    it('should show empty state when no pages exist', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['pages', 'list']);

        const foundEmpty = await waitForOutput(/No pages found/i, 30);
        expect(foundEmpty).toBe(true);

        // Verify API call
        const calls = env.server.getLogs();
        const getCall = calls.find((c) => c.method === 'getPages');
        expect(getCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should display pages when they exist', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Add test pages
      server.addPage({
        slug: 'test-page',
        url: 'http://localhost:8787/pages/test-page',
        brainRunId: 'run-123',
        persist: false,
        createdAt: new Date().toISOString(),
        size: 1024,
      });

      server.addPage({
        slug: 'persistent-page',
        url: 'http://localhost:8787/pages/persistent-page',
        brainRunId: 'run-456',
        persist: true,
        createdAt: new Date().toISOString(),
        size: 2048,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['pages', 'list']);

        // Check for page data in output
        const foundCount = await waitForOutput(/Found 2 pages/i, 30);
        expect(foundCount).toBe(true);

        const foundTestPage = await waitForOutput(/test-page/i, 30);
        expect(foundTestPage).toBe(true);

        const foundPersistent = await waitForOutput(/persistent-page/i, 30);
        expect(foundPersistent).toBe(true);

        // Verify API call
        const calls = env.server.getLogs();
        const getCall = calls.find((c) => c.method === 'getPages');
        expect(getCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle server connection errors', async () => {
      const env = await createTestEnv();
      // Don't start the server to simulate connection error

      try {
        const { waitForOutput } = await px(['pages', 'list'], {
          server: env.server,
        });

        const foundError = await waitForOutput(
          /Error connecting to the local development server/i,
          30
        );
        expect(foundError).toBe(true);
      } finally {
        env.cleanup();
      }
    });
  });

  describe('pages delete', () => {
    it('should delete a page with --force flag', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Add a test page
      server.addPage({
        slug: 'page-to-delete',
        url: 'http://localhost:8787/pages/page-to-delete',
        brainRunId: 'run-123',
        persist: false,
        createdAt: new Date().toISOString(),
        size: 512,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['pages', 'delete', 'page-to-delete', '--force']);

        const foundSuccess = await waitForOutput(/Page deleted successfully/i, 30);
        expect(foundSuccess).toBe(true);

        // Verify API call
        const calls = env.server.getLogs();
        const deleteCall = calls.find((c) => c.method === 'deletePage');
        expect(deleteCall).toBeDefined();
        expect(deleteCall?.args[0]).toBe('page-to-delete');

        // Verify page was removed from mock server
        expect(server.getPage('page-to-delete')).toBeUndefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show 404 error when page not found', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['pages', 'delete', 'non-existent-page', '--force']);

        const foundNotFound = await waitForOutput(/Page not found/i, 30);
        expect(foundNotFound).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show confirmation prompt without --force', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Add a test page
      server.addPage({
        slug: 'confirm-delete-page',
        url: 'http://localhost:8787/pages/confirm-delete-page',
        brainRunId: 'run-123',
        persist: false,
        createdAt: new Date().toISOString(),
        size: 512,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['pages', 'delete', 'confirm-delete-page']);

        // Should show confirmation prompt
        const foundWarning = await waitForOutput(/Warning.*permanently delete/i, 30);
        expect(foundWarning).toBe(true);

        const foundSlug = await waitForOutput(/confirm-delete-page/i, 30);
        expect(foundSlug).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle server errors', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Clear all existing nock interceptors
        nock.cleanAll();

        // Mock the server to return a 500 error
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .delete('/pages/error-page')
          .reply(500, 'Internal Server Error');

        const { waitForOutput } = await px(['pages', 'delete', 'error-page', '--force']);

        // The ErrorComponent will display an error
        const foundError = await waitForOutput(/Error|Failed|500/i, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });
});
