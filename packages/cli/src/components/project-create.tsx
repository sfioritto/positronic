import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { generateProject } from '../commands/helpers.js';
import { ProjectAuthSetup } from './project-auth-setup.js';
import path from 'path';

interface ProjectCreateProps {
  projectPathArg: string;
}

type CreateStatus = 'creating' | 'auth_setup' | 'success' | 'error';

export const ProjectCreate = ({ projectPathArg }: ProjectCreateProps) => {
  const [status, setStatus] = useState<CreateStatus>('creating');
  const [error, setError] = useState<string | null>(null);
  const [projectDir, setProjectDir] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');

  useEffect(() => {
    const createProject = async () => {
      try {
        const resolvedProjectDir = path.resolve(projectPathArg);
        const resolvedProjectName = path.basename(resolvedProjectDir);

        setProjectDir(resolvedProjectDir);
        setProjectName(resolvedProjectName);

        await generateProject(resolvedProjectName, resolvedProjectDir);
        // After scaffolding, move to auth setup (skip in test environment)
        if (process.env.NODE_ENV === 'test') {
          setStatus('success');
        } else {
          setStatus('auth_setup');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
        setStatus('error');
      }
    };

    createProject();
  }, [projectPathArg]);

  if (status === 'creating') {
    return (
      <Box flexDirection="column">
        <Text>Creating project...</Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">Error creating project: {error}</Text>
      </Box>
    );
  }

  if (status === 'auth_setup') {
    return (
      <Box flexDirection="column" paddingTop={1}>
        <Text bold color="green">Project scaffolded!</Text>
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Text>
            <Text bold>Name:</Text> {projectName}
          </Text>
          <Text>
            <Text bold>Location:</Text> {projectDir}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text bold>Setting up authentication...</Text>
        </Box>
        <ProjectAuthSetup
          projectDir={projectDir}
          onComplete={() => setStatus('success')}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold color="green">Project Created Successfully!</Text>
      <Box marginTop={1} paddingLeft={2} flexDirection="column">
        <Text>
          <Text bold>Name:</Text> {projectName}
        </Text>
        <Text>
          <Text bold>Location:</Text> {projectDir}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Next steps:</Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text>
            <Text bold>1.</Text> cd {projectDir}
          </Text>
          <Text>
            <Text bold>2.</Text> Install dependencies if you didn't choose to during setup (e.g., npm install)
          </Text>
          <Text>
            <Text bold>3.</Text> Run the development server: px s or positronic server
          </Text>
          <Text>
            <Text bold>4.</Text> Open a new terminal in '{projectName}' and run a brain: px run example --watch
          </Text>
        </Box>
      </Box>
    </Box>
  );
};