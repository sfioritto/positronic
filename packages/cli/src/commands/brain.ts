import type { ArgumentsCamelCase } from 'yargs';
import { apiClient } from './helpers.js';
import React from 'react';
import { Text } from 'ink';
import { Watch } from '../components/watch.js';
import { BrainList } from '../components/brain-list.js';
import { BrainHistory } from '../components/brain-history.js';
import { BrainShow } from '../components/brain-show.js';
import { BrainRerun } from '../components/brain-rerun.js';
import { BrainNew } from '../components/brain-new.js';
import { ErrorComponent } from '../components/error.js';

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
  list(argv: ArgumentsCamelCase<BrainListArgs>): React.ReactElement {
    return React.createElement(BrainList);
  }

  history({
    name: brainName,
    limit,
  }: ArgumentsCamelCase<BrainHistoryArgs>): React.ReactElement {
    return React.createElement(BrainHistory, { brainName, limit });
  }

  show({
    name: brainName,
  }: ArgumentsCamelCase<BrainShowArgs>): React.ReactElement {
    return React.createElement(BrainShow, { brainName });
  }

  rerun({
    name: brainName,
    runId,
    startsAt,
    stopsAfter,
  }: ArgumentsCamelCase<BrainRerunArgs>): React.ReactElement {
    return React.createElement(BrainRerun, {
      brainName,
      runId,
      startsAt,
      stopsAfter,
    });
  }

  async run({ name: brainName, watch }: ArgumentsCamelCase<BrainRunArgs>): Promise<React.ReactElement> {
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
      } else if (response.status === 404) {
        // Handle brain not found with a helpful message
        return React.createElement(ErrorComponent, {
          error: {
            title: 'Brain Not Found',
            message: `Brain '${brainName}' not found.`,
            details: 'Please check that:\n  1. The brain name is spelled correctly\n  2. The brain exists in your project\n  3. The brain has been properly defined and exported\n\nYou can list available brains with: positronic list'
          }
        });
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

  new({
    name: brainName,
    prompt,
  }: ArgumentsCamelCase<BrainNewArgs>): React.ReactElement {
    return React.createElement(BrainNew, { brainName, prompt });
  }
}
