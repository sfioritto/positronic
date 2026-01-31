import { useState, useEffect, useCallback } from 'react';
import { apiClient, isApiLocalDevMode } from '../commands/helpers.js';
import type { AuthSetupResponse } from '@positronic/spec';

type ErrorObject = { title: string; message: string; details: string };

const ROOT_KEY_NOT_CONFIGURED_ERROR: ErrorObject = {
  title: 'Root Key Not Configured',
  message: 'The server does not have a root authentication key configured.',
  details: "Run 'px auth format-jwk-key' to generate the key, then add ROOT_PUBLIC_KEY as a secret in your server configuration.",
};

const AUTH_REQUIRED_ERROR: ErrorObject = {
  title: 'Authentication Required',
  message: 'Your request could not be authenticated.',
  details: "Run 'px auth login' to configure your SSH key, or check that your key is registered on the server.",
};

function getConnectionErrorMessage(): ErrorObject {
  if (isApiLocalDevMode()) {
    return {
      title: 'Connection Error',
      message: 'Error connecting to the local development server.',
      details: "Please ensure the server is running ('positronic server' or 'px s').",
    };
  } else {
    return {
      title: 'Connection Error',
      message: 'Error connecting to the remote project server.',
      details: 'Please check your network connection and verify the project URL is correct.',
    };
  }
}

/**
 * Fetch auth setup instructions from the server
 */
async function fetchAuthSetupInstructions(): Promise<AuthSetupResponse | null> {
  const response = await apiClient.fetchUnauthenticated('/auth/setup');
  if (response.ok) {
    return (await response.json()) as AuthSetupResponse;
  }
  return null;
}

/**
 * Check if the error response indicates ROOT_KEY_NOT_CONFIGURED
 */
async function isRootKeyNotConfiguredError(response: Response): Promise<boolean> {
  try {
    const clonedResponse = response.clone();
    const data = await clonedResponse.json() as { error?: string };
    return data.error === 'ROOT_KEY_NOT_CONFIGURED';
  } catch {
    return false;
  }
}

/**
 * Build the appropriate auth error based on the response
 */
async function buildAuthError(response: Response): Promise<ErrorObject> {
  if (await isRootKeyNotConfiguredError(response)) {
    const setupInfo = await fetchAuthSetupInstructions();
    if (setupInfo) {
      return {
        ...ROOT_KEY_NOT_CONFIGURED_ERROR,
        details: setupInfo.instructions,
      };
    }
    return ROOT_KEY_NOT_CONFIGURED_ERROR;
  }
  return AUTH_REQUIRED_ERROR;
}

export function useApiGet<T>(endpoint: string, options?: any) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{
    title: string;
    message: string;
    details?: string;
  } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await apiClient.fetch(endpoint, {
          method: 'GET',
          ...options,
        });

        if (response.status === 200) {
          const result = (await response.json()) as T;
          setData(result);
        } else if (response.status === 401) {
          setError(await buildAuthError(response));
        } else {
          const errorText = await response.text();
          setError({
            title: 'Server Error',
            message: `Error fetching ${endpoint}: ${response.status} ${response.statusText}`,
            details: `Server response: ${errorText}`,
          });
        }
      } catch (err: any) {
        const baseError = getConnectionErrorMessage();
        let errorDetails = err.message;
        if (err.code === 'ECONNREFUSED') {
          errorDetails =
            'Connection refused. The server might not be running or is listening on a different port.';
        }

        setError({
          ...baseError,
          details: `${baseError.details} ${errorDetails}`,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [endpoint]);

  return { data, loading, error };
}

export function useApiPost<T>(endpoint: string, defaultOptions?: any) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    title: string;
    message: string;
    details?: string;
  } | null>(null);

  const execute = useCallback(
    async (body?: any, options?: any) => {
      try {
        setLoading(true);
        setError(null);

        const response = await apiClient.fetch(endpoint, {
          method: 'POST',
          ...defaultOptions,
          ...options,
          body,
        });

        if (response.status === 200 || response.status === 201 || response.status === 202) {
          const result = (await response.json()) as T;
          setData(result);
          return result;
        } else if (response.status === 401) {
          const errorObj = await buildAuthError(response);
          setError(errorObj);
          throw errorObj;
        } else {
          const errorText = await response.text();
          const errorObj = {
            title: 'Server Error',
            message: `Error posting to ${endpoint}: ${response.status} ${response.statusText}`,
            details: `Server response: ${errorText}`,
          };
          setError(errorObj);
          throw errorObj;
        }
      } catch (err: any) {
        // If it's already our error object, don't wrap it again
        if (err.title && err.message) {
          setError(err);
          throw err;
        }

        const baseError = getConnectionErrorMessage();
        let errorDetails = err.message;
        if (err.code === 'ECONNREFUSED') {
          errorDetails =
            'Connection refused. The server might not be running or is listening on a different port.';
        }

        const errorObj = {
          ...baseError,
          details: `${baseError.details} ${errorDetails}`,
        };
        setError(errorObj);
        throw errorObj;
      } finally {
        setLoading(false);
      }
    },
    [endpoint, defaultOptions]
  );

  return { data, loading, error, execute };
}

export function useApiDelete(resourceType: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    title: string;
    message: string;
    details?: string;
  } | null>(null);

  const execute = useCallback(
    async (endpoint: string, options?: any) => {
      try {
        setLoading(true);
        setError(null);

        const response = await apiClient.fetch(endpoint, {
          method: 'DELETE',
          ...options,
        });

        if (response.status === 204 || response.status === 200) {
          return true;
        } else if (response.status === 401) {
          const errorObj = await buildAuthError(response);
          setError(errorObj);
          throw errorObj;
        } else {
          const errorText = await response.text();
          const errorObj = {
            title: 'Server Error',
            message: `Error deleting ${resourceType}: ${response.status} ${response.statusText}`,
            details: `Server response: ${errorText}`,
          };
          setError(errorObj);
          throw errorObj;
        }
      } catch (err: any) {
        // If it's already our error object, don't wrap it again
        if (err.title && err.message) {
          setError(err);
          throw err;
        }

        const baseError = getConnectionErrorMessage();
        let errorDetails = err.message;
        if (err.code === 'ECONNREFUSED') {
          errorDetails =
            'Connection refused. The server might not be running or is listening on a different port.';
        }

        const errorObj = {
          ...baseError,
          details: `${baseError.details} ${errorDetails}`,
        };
        setError(errorObj);
        throw errorObj;
      } finally {
        setLoading(false);
      }
    },
    [resourceType]
  );

  return { loading, error, execute };
}
