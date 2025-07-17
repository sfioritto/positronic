import { describe, it, expect } from '@jest/globals';
import { createTestEnv, px } from './test-utils.js';

describe('secret commands', () => {
  describe('secret create', () => {
    it('should pass through to backend', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Just verify it runs without error
        await px([
          'secret',
          'create',
          'TEST_SECRET',
          '--value=test-value',
        ]);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('secret list', () => {
    it('should pass through to backend', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Just verify it runs without error
        await px(['secret', 'list']);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('secret delete', () => {
    it('should pass through to backend', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Just verify it runs without error
        await px(['secret', 'delete', 'TEST_SECRET']);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });
});