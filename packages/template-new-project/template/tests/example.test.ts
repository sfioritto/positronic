import { createMockClient, runBrainTest } from '@positronic/core/testing';
import exampleBrain from '../brains/example.js';

describe('example brain', () => {
  it('should complete successfully with welcome messages', async () => {
    // Arrange
    const mockClient = createMockClient();
    
    // Act
    const result = await runBrainTest(exampleBrain, { client: mockClient });
    
    // Assert
    expect(result.completed).toBe(true);
    expect(result.error).toBeNull();
    expect(result.finalState).toMatchObject({
      message: 'Welcome to Positronic!',
      finalMessage: 'Welcome to Positronic! Your project is set up.'
    });
  });
});