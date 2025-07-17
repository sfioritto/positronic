import React, { useEffect } from 'react';
import { useApp } from 'ink';
import type { PositronicDevServer } from '@positronic/spec';

interface SecretListProps {
  server?: PositronicDevServer;
}

export const SecretList = ({ server }: SecretListProps) => {
  const { exit } = useApp();

  useEffect(() => {
    const loadSecrets = async () => {
      if (!server) {
        console.error('No project found. Please run this command from within a Positronic project directory.');
        exit();
        return;
      }

      if (!server.listSecrets) {
        console.error('Secret management not supported for this backend');
        exit();
        return;
      }

      try {
        // listSecrets will print output directly via stdio: 'inherit'
        await server.listSecrets();
        exit();
      } catch (err) {
        // Error was already printed by backend
        exit();
      }
    };

    loadSecrets();
  }, [server, exit]);

  // This won't be shown because backend output is printed directly
  return null;
};