# Secrets Management Design

This document outlines the design for implementing secrets management in Positronic. It serves as a reference for the implementation following the standard new command creation guide.

## Overview

The secrets management system allows users to securely store and access sensitive configuration values (API keys, tokens, etc.) in their Positronic projects. The design follows existing Positronic patterns and integrates seamlessly with the brain execution context.

## API Design

### Core Endpoints

```typescript
// 1. Create/Update a secret
POST /secrets
Body: { name: string, value: string }
Response: 201 { name: string, createdAt: string, updatedAt: string }

// 2. List secrets (names only, never values)
GET /secrets
Response: 200 { secrets: [{ name: string, createdAt: string, updatedAt: string }], count: number }

// 3. Delete a secret
DELETE /secrets/:name
Response: 204 No Content

// 4. Check if secret exists
GET /secrets/:name/exists
Response: 200 { exists: boolean }

// 5. Bulk operations (useful for initial setup)
POST /secrets/bulk
Body: { secrets: [{ name: string, value: string }] }
Response: 201 { created: number, updated: number }
```

### Spec Implementation (packages/spec/src/api.ts)

```typescript
export const secrets = {
  /**
   * Test POST /secrets - Create or update a secret
   */
  async create(fetch: Fetch, name: string, value: string): Promise<boolean> {
    // Implementation details...
  },

  /**
   * Test GET /secrets - List all secrets (names only, not values)
   */
  async list(fetch: Fetch): Promise<boolean> {
    // Implementation details...
  },

  /**
   * Test DELETE /secrets/:name - Delete a specific secret
   */
  async delete(fetch: Fetch, name: string): Promise<boolean> {
    // Implementation details...
  },

  /**
   * Test GET /secrets/:name/exists - Check if a secret exists
   */
  async exists(fetch: Fetch, name: string): Promise<boolean> {
    // Implementation details...
  },

  /**
   * Test POST /secrets/bulk - Create multiple secrets
   */
  async bulk(fetch: Fetch, secrets: Array<{name: string, value: string}>): Promise<boolean> {
    // Implementation details...
  }
};
```

## CLI Commands

### Basic Commands

```bash
# Create a new secret (interactive, secure prompt)
px secret create <name>

# List all secret names (never shows values)
px secret list

# Delete a secret (prompts for confirmation)
px secret delete <name>

# Check if a secret exists
px secret exists <name>

# Import secrets from file
px secret import <file>
```

### Command Implementation Pattern

Following the existing pattern from other commands:

```typescript
// In packages/cli/src/commands/secret.ts
interface SecretCreateArgs {
  name: string;
}

class SecretCommand {
  create({ name }: ArgumentsCamelCase<SecretCreateArgs>): React.ReactElement {
    return React.createElement(SecretCreate, { name });
  }
  
  list(): React.ReactElement {
    return React.createElement(SecretList);
  }
  
  // ... other commands
}
```

## .env File Strategy

### File Types

1. **`.env.secrets`** - Runtime secrets that get loaded into the backend
   - Contains: API keys, database URLs, service tokens
   - Example: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `STRIPE_SECRET_KEY`
   - Loaded into the brain execution context
   - Never committed to git

2. **`.env.deploy`** - Deployment credentials (local only)
   - Contains: Platform-specific deployment credentials
   - Example: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `AWS_ACCESS_KEY_ID`
   - Used by CLI for deployment operations
   - Never loaded into backend/runtime
   - Never committed to git

### Example Files

**.env.secrets.example** (committed to git):
```bash
# AI Service Keys
ANTHROPIC_API_KEY=your-anthropic-api-key-here
OPENAI_API_KEY=your-openai-api-key-here

# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# Third-party Services
STRIPE_SECRET_KEY=sk_test_...
```

**.env.deploy.example** (committed to git):
```bash
# Cloudflare Deployment
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-api-token

# AWS Deployment
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1

# Fly.io Deployment
FLY_API_TOKEN=your-fly-token
```

## Brain Integration

Secrets will be injected into the brain execution context:

```typescript
// In brain step
brain('example')
  .step('UseSecret', async ({ state, secrets }) => {
    // Access secrets through the injected service
    const apiKey = await secrets.get('ANTHROPIC_API_KEY');
    
    // Use the secret
    const client = new AnthropicClient({ apiKey });
    
    return state;
  });
```

## Backend Implementation

### Storage Strategy by Provider

1. **Local Development**
   - Read from `.env.secrets` file
   - In-memory storage for test server

2. **Cloudflare Workers**
   - Store in KV namespace or Durable Objects
   - Encrypted at rest
   - Accessed via Workers Secrets API

3. **AWS**
   - Use AWS Secrets Manager or Parameter Store
   - IAM role-based access

4. **Fly.io**
   - Use Fly Secrets API
   - Automatic encryption

## Security Considerations

1. **Storage**
   - Always encrypted at rest in production
   - Never stored in plain text in backend
   - Scoped to project/application

2. **Transport**
   - Always over HTTPS
   - No secrets in URLs or query parameters

3. **CLI Security**
   - Use secure input (no echo) for secret values
   - No secrets in shell history
   - Clear warnings when using --value flag

4. **Access Control**
   - Secrets scoped to project
   - No cross-project access
   - Audit trail for modifications

## Implementation Checklist

1. [ ] Research existing patterns for secrets and environment variables
2. [ ] Design and implement .env file strategy
3. [ ] Implement spec tests for secrets API endpoints
4. [ ] Create CLI components for secrets management
5. [ ] Add command methods to CLI
6. [ ] Wire up CLI configuration
7. [ ] Add mock support in TestDevServer
8. [ ] Write comprehensive tests for all commands
9. [ ] Implement backend support for Cloudflare
10. [ ] Update brain execution context to inject secrets

## Testing Strategy

Following the CLI testing guide, tests should cover:

1. **Success paths** - Creating, listing, deleting secrets
2. **Empty states** - No secrets exist
3. **Error handling** - Connection errors, API errors
4. **Edge cases** - Invalid names, duplicate secrets

Example test structure:
```typescript
describe('secret commands', () => {
  it('should create a new secret', async () => {
    // Test implementation
  });
  
  it('should list all secrets without values', async () => {
    // Test implementation
  });
  
  it('should handle connection errors gracefully', async () => {
    // Test implementation
  });
});
```

## Future Enhancements

1. Secret rotation reminders
2. Secret usage tracking
3. Team/role-based access control
4. Integration with external secret managers (HashiCorp Vault, etc.)
5. Secret versioning/history

## References

- [New Command Creation Guide](./new-command-creation-guide.md)
- [CLI Testing Guide](./cli-testing-guide.md)
- [Testing Philosophy](./testing-philosophy.md)