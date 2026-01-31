import { Hono, type Context } from 'hono';
import type { Bindings } from './types.js';

type CloudflareSecretResponse = {
  result: Array<{
    name: string;
    type: string;
  }>;
  success: boolean;
  errors: Array<{ message: string }>;
};

/**
 * Helper to check if Cloudflare API credentials are configured
 */
function getSecretsApiConfig(env: Bindings): { accountId: string; scriptName: string; apiToken: string } | null {
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CF_SCRIPT_NAME } = env;

  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !CF_SCRIPT_NAME) {
    return null;
  }

  return {
    accountId: CLOUDFLARE_ACCOUNT_ID,
    scriptName: CF_SCRIPT_NAME,
    apiToken: CLOUDFLARE_API_TOKEN,
  };
}

/**
 * Helper to make Cloudflare API requests for secrets
 */
async function cloudflareSecretsApi(
  config: { accountId: string; scriptName: string; apiToken: string },
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/workers/scripts/${config.scriptName}/secrets`;
  const url = path ? `${baseUrl}/${path}` : baseUrl;

  return fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

const secrets = new Hono<{ Bindings: Bindings }>();

// Protected secret name that cannot be managed via the API
const PROTECTED_SECRET = 'ROOT_PUBLIC_KEY';

// List all secrets (names only, not values)
secrets.get('/', async (context: Context) => {
  const config = getSecretsApiConfig(context.env);

  if (!config) {
    return context.json(
      {
        error: 'Secrets management not configured. Please set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CF_SCRIPT_NAME.',
      },
      400
    );
  }

  try {
    const response = await cloudflareSecretsApi(config, '');
    const data = await response.json() as CloudflareSecretResponse;

    if (!data.success) {
      const errorMessage = data.errors?.[0]?.message || 'Failed to list secrets';
      return context.json({ error: errorMessage }, 500);
    }

    // Transform to match spec format - Cloudflare API doesn't return timestamps
    // so we use placeholder values
    // Filter out ROOT_PUBLIC_KEY from the list for security
    const now = new Date().toISOString();
    const secretList = data.result
      .filter((secret) => secret.name !== PROTECTED_SECRET)
      .map((secret) => ({
        name: secret.name,
        createdAt: now,
        updatedAt: now,
      }));

    return context.json({
      secrets: secretList,
      count: secretList.length,
    });
  } catch (error) {
    console.error('Error listing secrets:', error);
    return context.json(
      {
        error: `Failed to list secrets: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Create or update a secret
secrets.post('/', async (context: Context) => {
  const config = getSecretsApiConfig(context.env);

  if (!config) {
    return context.json(
      {
        error: 'Secrets management not configured. Please set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CF_SCRIPT_NAME.',
      },
      400
    );
  }

  try {
    const body = await context.req.json();
    const { name, value } = body;

    if (!name) {
      return context.json({ error: 'Missing required field "name"' }, 400);
    }
    if (value === undefined) {
      return context.json({ error: 'Missing required field "value"' }, 400);
    }

    // Block setting ROOT_PUBLIC_KEY via API - must be set in Cloudflare dashboard
    if (name === PROTECTED_SECRET) {
      return context.json(
        {
          error: `Cannot set ${PROTECTED_SECRET} via API. This secret must be configured directly in the Cloudflare dashboard under Workers & Pages > Settings > Variables and Secrets.`,
        },
        403
      );
    }

    // Cloudflare API uses PUT with name in body (not in URL)
    const response = await cloudflareSecretsApi(config, '', {
      method: 'PUT',
      body: JSON.stringify({
        name,
        text: value,
        type: 'secret_text',
      }),
    });

    const data = await response.json() as { success: boolean; errors?: Array<{ message: string }> };

    if (!data.success) {
      const errorMessage = data.errors?.[0]?.message || 'Failed to create secret';
      return context.json({ error: errorMessage }, 500);
    }

    const now = new Date().toISOString();
    return context.json(
      {
        name,
        createdAt: now,
        updatedAt: now,
      },
      201
    );
  } catch (error) {
    console.error('Error creating secret:', error);
    return context.json(
      {
        error: `Failed to create secret: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Delete a secret
secrets.delete('/:name', async (context: Context) => {
  const config = getSecretsApiConfig(context.env);

  if (!config) {
    return context.json(
      {
        error: 'Secrets management not configured. Please set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CF_SCRIPT_NAME.',
      },
      400
    );
  }

  const name = decodeURIComponent(context.req.param('name'));

  // Block deleting ROOT_PUBLIC_KEY via API - must be managed in Cloudflare dashboard
  if (name === PROTECTED_SECRET) {
    return context.json(
      {
        error: `Cannot delete ${PROTECTED_SECRET} via API. This secret must be managed directly in the Cloudflare dashboard under Workers & Pages > Settings > Variables and Secrets.`,
      },
      403
    );
  }

  try {
    const response = await cloudflareSecretsApi(config, encodeURIComponent(name), {
      method: 'DELETE',
    });

    const data = await response.json() as { success: boolean; errors?: Array<{ message: string }> };

    if (!data.success) {
      const errorMessage = data.errors?.[0]?.message || 'Failed to delete secret';
      return context.json({ error: errorMessage }, 500);
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(`Error deleting secret ${name}:`, error);
    return context.json(
      {
        error: `Failed to delete secret: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Check if a secret exists
secrets.get('/:name/exists', async (context: Context) => {
  const config = getSecretsApiConfig(context.env);

  if (!config) {
    return context.json(
      {
        error: 'Secrets management not configured. Please set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CF_SCRIPT_NAME.',
      },
      400
    );
  }

  const name = decodeURIComponent(context.req.param('name'));

  try {
    // List all secrets and check if the name exists
    const response = await cloudflareSecretsApi(config, '');
    const data = await response.json() as CloudflareSecretResponse;

    if (!data.success) {
      const errorMessage = data.errors?.[0]?.message || 'Failed to check secret';
      return context.json({ error: errorMessage }, 500);
    }

    const exists = data.result.some((secret) => secret.name === name);

    return context.json({ exists });
  } catch (error) {
    console.error(`Error checking secret ${name}:`, error);
    return context.json(
      {
        error: `Failed to check secret: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Bulk create secrets
secrets.post('/bulk', async (context: Context) => {
  const config = getSecretsApiConfig(context.env);

  if (!config) {
    return context.json(
      {
        error: 'Secrets management not configured. Please set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CF_SCRIPT_NAME.',
      },
      400
    );
  }

  try {
    const body = await context.req.json();
    const { secrets: secretsArray } = body;

    if (!secretsArray || !Array.isArray(secretsArray)) {
      return context.json({ error: 'Missing required field "secrets" (array)' }, 400);
    }

    // First, get existing secrets to determine created vs updated
    const listResponse = await cloudflareSecretsApi(config, '');
    const listData = await listResponse.json() as CloudflareSecretResponse;

    const existingNames = new Set(
      listData.success ? listData.result.map((s) => s.name) : []
    );

    let created = 0;
    let updated = 0;

    // Create/update each secret
    for (const secret of secretsArray) {
      if (!secret.name || secret.value === undefined) {
        continue; // Skip invalid entries
      }

      // Skip ROOT_PUBLIC_KEY - it cannot be set via API
      if (secret.name === PROTECTED_SECRET) {
        continue;
      }

      const response = await cloudflareSecretsApi(config, '', {
        method: 'PUT',
        body: JSON.stringify({
          name: secret.name,
          text: secret.value,
          type: 'secret_text',
        }),
      });

      const data = await response.json() as { success: boolean };

      if (data.success) {
        if (existingNames.has(secret.name)) {
          updated++;
        } else {
          created++;
        }
      }
    }

    return context.json({ created, updated }, 201);
  } catch (error) {
    console.error('Error bulk creating secrets:', error);
    return context.json(
      {
        error: `Failed to bulk create secrets: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

export default secrets;
