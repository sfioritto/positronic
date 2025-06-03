import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../commands/helpers.js';

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

        const response = await apiFetch(endpoint, {
          method: 'GET',
          ...options,
        });

        if (response.status === 200) {
          const result = (await response.json()) as T;
          setData(result);
        } else {
          const errorText = await response.text();
          setError({
            title: 'Server Error',
            message: `Error fetching ${endpoint}: ${response.status} ${response.statusText}`,
            details: `Server response: ${errorText}`,
          });
        }
      } catch (err: any) {
        let errorDetails = err.message;
        if (err.code === 'ECONNREFUSED') {
          errorDetails =
            'Connection refused. The server might not be running or is listening on a different port.';
        }

        setError({
          title: 'Connection Error',
          message: 'Error connecting to the local development server.',
          details: `Please ensure the server is running ('positronic server' or 'px s'). ${errorDetails}`,
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

        const response = await apiFetch(endpoint, {
          method: 'POST',
          ...defaultOptions,
          ...options,
          body,
        });

        if (response.status === 200 || response.status === 201) {
          const result = (await response.json()) as T;
          setData(result);
          return result;
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

        let errorDetails = err.message;
        if (err.code === 'ECONNREFUSED') {
          errorDetails =
            'Connection refused. The server might not be running or is listening on a different port.';
        }

        const errorObj = {
          title: 'Connection Error',
          message: 'Error connecting to the local development server.',
          details: `Please ensure the server is running ('positronic server' or 'px s'). ${errorDetails}`,
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

export function useApiDelete() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    title: string;
    message: string;
    details?: string;
  } | null>(null);

  const execute = useCallback(async (endpoint: string, options?: any) => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiFetch(endpoint, {
        method: 'DELETE',
        ...options,
      });

      if (response.status === 204 || response.status === 200) {
        return true;
      } else if (response.status === 404) {
        const errorText = await response.text();
        const errorObj = {
          title: 'Resource Not Found',
          message: 'The resource you are trying to delete does not exist.',
          details: errorText,
        };
        setError(errorObj);
        throw errorObj;
      } else {
        const errorText = await response.text();
        const errorObj = {
          title: 'Server Error',
          message: `Error deleting resource: ${response.status} ${response.statusText}`,
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

      let errorDetails = err.message;
      if (err.code === 'ECONNREFUSED') {
        errorDetails =
          'Connection refused. The server might not be running or is listening on a different port.';
      }

      const errorObj = {
        title: 'Connection Error',
        message: 'Error connecting to the local development server.',
        details: `Please ensure the server is running ('positronic server' or 'px s'). ${errorDetails}`,
      };
      setError(errorObj);
      throw errorObj;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, execute };
}
