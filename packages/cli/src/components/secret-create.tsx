import React, { useEffect } from 'react';
import { useApp } from 'ink';
import type { PositronicDevServer } from '@positronic/spec';

interface SecretCreateProps {
  name: string;
  value?: string;
  server?: PositronicDevServer;
}

export const SecretCreate = ({ name, value: providedValue, server }: SecretCreateProps) => {
  const { exit } = useApp();

  useEffect(() => {
    const createSecret = async () => {
      if (!server) {
        console.error('No project found. Please run this command from within a Positronic project directory.');
        exit();
        return;
      }

      if (!server.setSecret) {
        console.error('Secret management not supported for this backend');
        exit();
        return;
      }

      // If no value provided, backend will prompt for it
      if (!providedValue) {
        console.error('Please provide a value using --value flag');
        exit();
        return;
      }

      try {
        await server.setSecret(name, providedValue);
        exit();
      } catch (err) {
        // Error was already printed by backend
        exit();
      }
    };

    createSecret();
  }, [name, providedValue, server, exit]);

  // This won't be shown because backend output is printed directly
  return null;
};