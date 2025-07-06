import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { generateTypes } from '../commands/helpers.js';
import { ErrorComponent } from './error.js';

interface ResourceTypesProps {
  projectRootDir: string;
}

export const ResourceTypes: React.FC<ResourceTypesProps> = ({ projectRootDir }) => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [typesFilePath, setTypesFilePath] = useState<string>('');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const generateResourceTypes = async () => {
      try {
        const filePath = await generateTypes(projectRootDir);
        setTypesFilePath(filePath);
        setStatus('success');
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      }
    };

    generateResourceTypes();
  }, [projectRootDir]);

  if (status === 'loading') {
    return (
      <Box>
        <Text>🔄 Generating resource types...</Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <ErrorComponent
        error={{
          title: 'Type Generation Failed',
          message: 'Failed to generate resource types.',
          details: error?.message || 'Unknown error',
        }}
      />
    );
  }

  return (
    <Box>
      <Text color="green">✅ Generated resource types at {typesFilePath}</Text>
    </Box>
  );
};