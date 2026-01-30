/**
 * Global Jest setup for CLI tests.
 *
 * This setup provides a "safety net" by disabling all real network connections
 * by default. Tests can only make HTTP requests through nock interceptors.
 *
 * This prevents flaky tests caused by accidentally connecting to real servers
 * (like a local development server running on port 8787) when tests are
 * designed to verify "connection error" behavior.
 */
import nock from 'nock';
import { beforeEach, afterEach } from '@jest/globals';

beforeEach(() => {
  // Disable all real network connections for this test.
  // Tests must use nock interceptors to mock HTTP responses.
  nock.disableNetConnect();
});

afterEach(() => {
  // Re-enable network connections and clean up interceptors after each test
  nock.enableNetConnect();
  nock.cleanAll();
});
