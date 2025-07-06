import type { ArgumentsCamelCase } from 'yargs';
import { apiClient } from './helpers.js';
import React from 'react';
import { Text } from 'ink';
import { Watch } from '../components/watch.js';

interface BrainListArgs {}
interface BrainHistoryArgs {
  name: string;
  limit: number;
}
interface BrainShowArgs {
  name: string;
}
interface BrainRerunArgs {
  name: string;
  runId?: string;
  startsAt?: number;
  stopsAfter?: number;
}
interface BrainRunArgs {
  name: string;
  watch?: boolean;
}
interface BrainWatchArgs {
  runId?: string;
  name?: string;
}
interface BrainNewArgs {
  name: string;
  prompt?: string;
}

export class BrainCommand {
  list(argv: ArgumentsCamelCase<BrainListArgs>) {
    // Implement brain list logic (local or remote)
  }

  history({ name: brainName, limit }: ArgumentsCamelCase<BrainHistoryArgs>) {
    // Implement brain history logic (API call)
  }

  show({ name: brainName }: ArgumentsCamelCase<BrainShowArgs>) {
    // Implement brain show logic (API call)
  }

  rerun({
    name: brainName,
    runId,
    startsAt,
    stopsAfter,
  }: ArgumentsCamelCase<BrainRerunArgs>) {
    // Implement brain rerun logic (API call)
  }

  async run({ name: brainName, watch }: ArgumentsCamelCase<BrainRunArgs>) {
    const apiPath = '/brains/runs';
    try {
      const response = await apiClient.fetch(apiPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ brainName }),
      });

      if (response.status === 201) {
        const result = (await response.json()) as { brainRunId: string };

        if (watch) {
          // Return Watch component for CLI to render
          return this.watch({
            runId: result.brainRunId,
            _: [],
            $0: '',
          });
        } else {
          // Return React element displaying the run ID
          return React.createElement(
            Text,
            null,
            `Run ID: ${result.brainRunId}`
          );
        }
      } else {
        const errorText = await response.text();
        console.error(
          `Error starting brain run: ${response.status} ${response.statusText}`
        );
        console.error(`Server response: ${errorText}`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`Error connecting to the local development server.`);
      console.error(
        "Please ensure the server is running ('positronic server' or 'px s')."
      );
      if (error.code === 'ECONNREFUSED') {
        console.error(
          'Reason: Connection refused. The server might not be running or is listening on a different port.'
        );
      } else {
        console.error(`Fetch error details: ${error.message}`);
      }
      process.exit(1);
    }
  }

  watch({
    runId,
    name: brainName,
  }: ArgumentsCamelCase<BrainWatchArgs>): React.ReactElement {
    // If a specific run ID is provided, return the Watch component
    if (runId) {
      const port = process.env.POSITRONIC_SERVER_PORT || '8787';
      return React.createElement(Watch, { runId, port });
    }

    // If watching by brain name is requested (latest run), this is not yet implemented.
    // For now, show a placeholder message.
    if (brainName) {
      return React.createElement(
        Text,
        null,
        'Watching by brain name is not yet implemented.'
      );
    }

    // Neither runId nor brainName provided – return an error element.
    return React.createElement(
      Text,
      { color: 'red' as any }, // Ink Text color prop
      'Error: You must provide either a brain run ID or a brain name.'
    );
  }

  new({ name: brainName, prompt }: ArgumentsCamelCase<BrainNewArgs>) {
    // Implement brain creation logic
  }
}
