import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { scaffoldProject } from '@positronic/template-new-project';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ProjectAuthSetup } from './project-auth-setup.js';
import path from 'path';

interface ProjectCreateProps {
  projectPathArg: string;
}

type CreateStatus =
  | 'creating'
  | 'installing'
  | 'auth_setup'
  | 'success'
  | 'error';

const execFileAsync = promisify(execFile);

// Runs the post-scaffold steps. Returns a message for the first step that
// failed, or null when both succeeded. Failures here are not fatal: the
// project files exist and auth setup does not need node_modules.
async function setupProject(projectDir: string) {
  const options = {
    cwd: projectDir,
    maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === 'win32',
  };
  const steps: [string, string[]][] = [
    ['npm', ['install']],
    ['git', ['init']],
  ];
  for (const [command, args] of steps) {
    try {
      await execFileAsync(command, args, options);
    } catch (err) {
      // npm's failure message carries its whole stderr; keep the tail.
      const message = err instanceof Error ? err.message : String(err);
      const detail = message.trim().split('\n').slice(-5).join('\n');
      return `${command} ${args.join(' ')} failed: ${detail}`;
    }
  }
  return null;
}

export const ProjectCreate = ({ projectPathArg }: ProjectCreateProps) => {
  const [status, setStatus] = useState<CreateStatus>('creating');
  const [error, setError] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [projectDir, setProjectDir] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');

  useEffect(() => {
    const createProject = async () => {
      const resolvedProjectDir = path.resolve(projectPathArg);
      const resolvedProjectName = path.basename(resolvedProjectDir);

      setProjectDir(resolvedProjectDir);
      setProjectName(resolvedProjectName);

      try {
        scaffoldProject({
          name: resolvedProjectName,
          dest: resolvedProjectDir,
          backend: 'cloudflare',
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
        setStatus('error');
        return;
      }

      // Tests scaffold in-process and never want a real install or auth setup.
      if (process.env.NODE_ENV === 'test') {
        setStatus('success');
        return;
      }

      setStatus('installing');
      setInstallError(await setupProject(resolvedProjectDir));
      setStatus('auth_setup');
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

  if (status === 'installing') {
    return (
      <Box flexDirection="column" paddingTop={1}>
        <Text bold color="green">
          Project scaffolded!
        </Text>
        <Box marginTop={1}>
          <Text>Installing dependencies...</Text>
        </Box>
      </Box>
    );
  }

  if (status === 'auth_setup') {
    return (
      <Box flexDirection="column" paddingTop={1}>
        <Text bold color="green">
          Project scaffolded!
        </Text>
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
      <Text bold color="green">
        Project Created Successfully!
      </Text>
      <Box marginTop={1} paddingLeft={2} flexDirection="column">
        <Text>
          <Text bold>Name:</Text> {projectName}
        </Text>
        <Text>
          <Text bold>Location:</Text> {projectDir}
        </Text>
      </Box>

      {installError !== null && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">Setup step failed: {installError}</Text>
          <Text dimColor>
            Run "npm install" inside the project directory before starting the
            server.
          </Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text bold>Next steps:</Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text>
            <Text bold>1.</Text> cd {projectDir}
          </Text>
          <Text>
            <Text bold>2.</Text> Add your AI provider API key to .env (e.g.,
            GOOGLE_GENERATIVE_AI_API_KEY)
          </Text>
          <Text>
            <Text bold>3.</Text> Run the development server: px s or positronic
            server
          </Text>
          <Text>
            <Text bold>4.</Text> Open a new terminal in '{projectName}' and run
            a brain: px run example --watch
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            See runner.ts to switch to a different AI provider (e.g., Anthropic,
            OpenAI)
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
