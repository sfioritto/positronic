# New Command Creation Guide

This guide documents the proven process for implementing new CLI commands in the Positronic monorepo.

## Overview

Our command implementation follows a Test-Driven Development (TDD) approach with these key phases:

1. **Research & Planning** - Understand existing patterns and plan the implementation
2. **Spec Implementation** - Define API contracts in the spec package
3. **CLI Implementation** - Create CLI components and command handlers
4. **Testing** - Add comprehensive test coverage following CLI testing guidelines
5. **Integration** - Wire everything together and verify end-to-end functionality

## Detailed Process

### Phase 1: Research & Planning

1. **Plan the implementation** and break down the work into logical steps
2. **Research existing implementations**:

   - Check if similar commands exist in the codebase
   - Look at `packages/cli/src/commands/*.ts` for patterns
   - Review `packages/cli/src/components/*.tsx` for UI patterns
   - Examine test files `packages/cli/src/commands/*.test.ts` for testing approaches

3. **Check API completeness**:

   - Review `packages/spec/src/api.ts` for required spec tests
   - Check if the needed API endpoints exist in the spec
   - Determine what new API contracts need to be defined

4. **Plan the user experience**:
   - Define command syntax and options
   - Plan error scenarios and messages
   - Design success output format

### Phase 2: Spec Implementation

#### 2.1 Add Spec Tests (if needed)

In `packages/spec/src/api.ts`:

```typescript
export const [category] = {
  // ... existing methods

  /**
   * Test GET /your/new/endpoint - Description of what it tests
   */
  async yourNewMethod(fetch: Fetch, param: string): Promise<boolean> {
    try {
      const request = new Request(`http://example.com/your/endpoint/${param}`, {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /your/endpoint returned ${response.status}`);
        return false;
      }

      const data = await response.json();

      // Validate response structure
      if (!Array.isArray(data.items)) {
        console.error(
          `Expected items to be an array, got ${typeof data.items}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /your/endpoint:`, error);
      return false;
    }
  },
};
```

### Phase 3: CLI Implementation

#### 3.1 Create Component (if needed)

In `packages/cli/src/components/your-component.tsx`:

```typescript
import React from 'react';
import { Text, Box } from 'ink';
import { useApiGet } from '../hooks/useApi.js';
import { ErrorComponent } from './error.js';

interface YourComponentProps {
  param: string;
}

interface YourDataType {
  field1: string;
  field2: string;
}

interface YourResponseType {
  items: YourDataType[];
}

export const YourComponent = ({ param }: YourComponentProps) => {
  const url = `/your/endpoint/${encodeURIComponent(param)}`;
  const { data, loading, error } = useApiGet<YourResponseType>(url);

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>🔄 Loading...</Text>
      </Box>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No items found for: {param}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Tip: Try running "px some-command" to create items
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        Items for "{param}" ({data.items.length} shown):
      </Text>

      <Box marginTop={1} flexDirection="column">
        {/* Render your data */}
        {data.items.map((item) => (
          <Box key={item.field1}>
            <Text>
              {item.field1}: {item.field2}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
```

#### 3.2 Add Command Method

In `packages/cli/src/commands/your-category.ts`:

```typescript
// Add interface for arguments
interface YourCommandArgs {
  param: string;
  option?: string;
}

// Add to class
yourCommand({
  param,
  option,
}: ArgumentsCamelCase<YourCommandArgs>): React.ReactElement {
  return React.createElement(YourComponent, { param, option });
}
```

#### 3.3 Wire Up CLI Configuration

In `packages/cli/src/cli.ts`:

```typescript
// Add to appropriate command group
.command(
  'your-command <param>',
  'Description of what this command does',
  (yargsBuilder) => {
    return yargsBuilder
      .positional('param', {
        describe: 'Description of the parameter',
        type: 'string',
        demandOption: true,
      })
      .option('option', {
        describe: 'Optional parameter description',
        type: 'string',
        alias: 'o',
      })
      .example(
        '$0 your-command example-param',
        'Example usage description'
      );
  },
  (argv) => {
    const element = yourCategoryCommand.yourCommand(argv as any);
    render(element);
  }
)
```

### Phase 4: Testing Implementation

#### 4.1 Add Mock Support

In `packages/cli/src/test/test-dev-server.ts`:

```typescript
// Add interface for mock data
interface MockYourDataType {
  field1: string;
  field2: string;
}

// Add to TestDevServer class
private yourMockData: MockYourDataType[] = [];

// Add helper methods
addYourData(data: MockYourDataType) {
  this.yourMockData.push(data);
}

clearYourData() {
  this.yourMockData = [];
}

// Add endpoint mock in start() method
nockInstance.get(/^\/your\/endpoint\/(.+)$/).reply((uri) => {
  const param = decodeURIComponent(uri.split('/')[3]);

  this.logCall('getYourData', [param]);

  const filteredData = this.yourMockData.filter(item =>
    item.field1.includes(param)
  );

  return [200, { items: filteredData }];
});
```

#### 4.2 Write Comprehensive Tests

In `packages/cli/src/commands/your-category.test.ts`:

```typescript
describe('your command', () => {
  it('should show items when data exists', async () => {
    const env = await createTestEnv();
    const { server } = env;

    // Add test data
    server.addYourData({
      field1: 'test-value',
      field2: 'test-data',
    });

    const px = await env.start();

    try {
      const { waitForOutput } = await px(['your-command', 'test-param']);

      // Check for expected output
      const foundData = await waitForOutput(/test-value/, 30);
      expect(foundData).toBe(true);

      // Verify API call
      const calls = server.getLogs();
      const dataCall = calls.find((c) => c.method === 'getYourData');
      expect(dataCall).toBeDefined();
      expect(dataCall?.args[0]).toBe('test-param');
    } finally {
      await env.stopAndCleanup();
    }
  });

  it('should show empty state when no data exists', async () => {
    const env = await createTestEnv();
    const px = await env.start();

    try {
      const { waitForOutput } = await px(['your-command', 'test-param']);

      const foundEmpty = await waitForOutput(/No items found/, 30);
      expect(foundEmpty).toBe(true);
    } finally {
      await env.stopAndCleanup();
    }
  });

  it('should handle server connection errors', async () => {
    const env = await createTestEnv();
    // Don't start the server to simulate connection error

    try {
      const { waitForOutput } = await px(['your-command', 'test-param'], {
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

  it('should handle API server errors', async () => {
    const env = await createTestEnv();
    const px = await env.start();

    try {
      // Clear all existing nock interceptors to avoid conflicts
      nock.cleanAll();

      // Mock the server to return a 500 error
      const port = env.server.port;
      nock(`http://localhost:${port}`)
        .get(/^\/your\/endpoint\/(.+)$/)
        .reply(500, 'Internal Server Error');

      const { waitForOutput } = await px(['your-command', 'test-param']);

      // The ErrorComponent will display the error
      const foundError = await waitForOutput(/Error:|Failed|500/i, 30);
      expect(foundError).toBe(true);
    } finally {
      await env.stopAndCleanup();
    }
  });
});
```

### Phase 5: Integration & Verification

#### 5.1 Run Tests

```bash
# Run specific command tests
npm test -- packages/cli/src/commands/your-category.test.ts -t "your command"

# Run all tests
npm test

# Build everything
npm run build:workspaces
```

#### 5.2 Manual Testing

```bash
# Start development server
npm run dev

# In another terminal, test the command
./packages/cli/dist/src/positronic.js your-command test-param
```

## Key Patterns & Best Practices

### Error Handling

- Always use `ErrorComponent` for consistent error display
- Handle three types of errors:
  1. **Connection errors** - Server not running
  2. **API errors** - Server returns error status
  3. **Empty state** - No data found (not an error, but needs handling)

### Testing Strategy

- Follow the **CLI Testing Guide** (`docs/cli-testing-guide.md`)
- Test all scenarios: success, empty state, connection errors, API errors
- Use `waitForOutput()` with sufficient retries if needed
- Always verify API calls with `server.getLogs()`
- Use proper cleanup with `env.stopAndCleanup()` or `env.cleanup()`

### Component Patterns

- Use `useApiGet` hook for data fetching
- Show loading states with appropriate messages
- Handle empty states with helpful tips
- Use consistent styling with Ink components
- Prefer table layouts for list data

### API Design

- Use RESTful endpoints (`GET /category/:id/subcategory`)
- Return consistent JSON structure (`{ items: [...] }`)
- Include proper error responses with meaningful messages
- Log all method calls for testing verification

## Backend Implementation

If you need to implement backend support for your new command, each backend (like Cloudflare Workers) needs to:

1. **Add spec test implementation** - Create a test that uses the spec function you defined
2. **Implement the API endpoint** - Add the actual endpoint that matches the spec contract
3. **Add any required business logic** - Implement data access methods in appropriate modules (like Durable Objects)

Example backend test implementation:

```typescript
// In your backend's test file
import { yourCategory } from '@positronic/spec';

describe('your API endpoint', () => {
  it('should pass spec test', async () => {
    const result = await yourCategory.yourNewMethod(mockFetch, 'test-param');
    expect(result).toBe(true);
  });
});
```

The key is that any backend must satisfy the spec contracts defined in `packages/spec/src/api.ts`.

## Common Pitfalls

1. **Forgetting to start test server** - Always `await env.start()`
2. **Not waiting for API calls** - Use `waitForOutput()` before checking `getLogs()`
3. **Missing nock cleanup** - Use `nock.cleanAll()` in error tests
4. **Incorrect TypeScript types** - Follow existing patterns for async methods
5. **Process.exit in components** - Handle with `ErrorComponent` instead
6. **Missing CLI async handlers** - Make command handlers `async` when needed

This process has been proven successful for implementing multiple commands and ensures comprehensive, well-tested functionality that follows established patterns.
