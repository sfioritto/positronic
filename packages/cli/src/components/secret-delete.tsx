import React, { useEffect } from 'react';
import { useApp } from 'ink';
import type { PositronicDevServer } from '@positronic/spec';

interface SecretDeleteProps {
  name: string;
  server?: PositronicDevServer;
}

export const SecretDelete = ({ name, server }: SecretDeleteProps) => {
  const { exit } = useApp();

  useEffect(() => {
    const deleteSecret = async () => {
      if (!server) {
        console.error('No project found. Please run this command from within a Positronic project directory.');
        exit();
        return;
      }

      if (!server.deleteSecret) {
        console.error('Secret management not supported for this backend');
        exit();
        return;
      }

      try {
        await server.deleteSecret(name);
        exit();
      } catch (err) {
        // Error was already printed by backend
        exit();
      }
    };

    deleteSecret();
  }, [name, server, exit]);

  // This won't be shown because backend output is printed directly
  return null;
};