import type { ArgumentsCamelCase } from 'yargs';
import { apiClient } from './helpers.js';
import React from 'react';
import { Text } from 'ink';
import { Watch } from '../components/watch.js';
import { BrainList } from '../components/brain-list.js';
import { BrainHistory } from '../components/brain-history.js';
import { BrainShow } from '../components/brain-show.js';
import { BrainRerun } from '../components/brain-rerun.js';
import { ErrorComponent } from '../components/error.js';

interface BrainListArgs {}
interface BrainHistoryArgs {
  filename: string;
  limit: number;
}
interface BrainShowArgs {
  filename: string;
}
interface BrainRerunArgs {
  filename: string;
  runId?: string;
  startsAt?: number;
  stopsAfter?: number;
}
interface BrainRunArgs {
  filename: string;
  watch?: boolean;
  options?: Record<string, string>;
}
interface BrainWatchArgs {
  runId?: string;
  filename?: string;
}

export class BrainCommand {
  list(argv: ArgumentsCamelCase<BrainListArgs>): React.ReactElement {
    return React.createElement(BrainList);
  }

  history({
    filename,
    limit,
  }: ArgumentsCamelCase<BrainHistoryArgs>): React.ReactElement {
    return React.createElement(BrainHistory, { brainName: filename, limit });
  }

  show({
    filename,
  }: ArgumentsCamelCase<BrainShowArgs>): React.ReactElement {
    return React.createElement(BrainShow, { brainName: filename });
  }

  rerun({
    filename,
    runId,
    startsAt,
    stopsAfter,
  }: ArgumentsCamelCase<BrainRerunArgs>): React.ReactElement {
    return React.createElement(BrainRerun, {
      identifier: filename,
      runId,
      startsAt,
      stopsAfter,
    });
  }

  async run({ filename, watch, options }: ArgumentsCamelCase<BrainRunArgs>): Promise<React.ReactElement> {
    const apiPath = '/brains/runs';
    
    try {
      const response = await apiClient.fetch(apiPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          identifier: filename,
          options 
        }),
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
            message: `Brain '${filename}' not found.`,
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

  async watch({
    runId,
    filename,
  }: ArgumentsCamelCase<BrainWatchArgs>): Promise<React.ReactElement> {
    // If a specific run ID is provided, return the Watch component
    if (runId) {
      const port = process.env.POSITRONIC_PORT || '8787';
      return React.createElement(Watch, { runId, port });
    }

    // If watching by brain filename is requested, look up active runs
    if (filename) {
      try {
        const apiPath = `/brains/${encodeURIComponent(filename)}/active-runs`;
        const response = await apiClient.fetch(apiPath, {
          method: 'GET',
        });

        if (response.status === 200) {
          const result = await response.json() as { runs: Array<{ brainRunId: string; brainTitle: string; status: string; createdAt: number }> };
          
          if (result.runs.length === 0) {
            return React.createElement(
              ErrorComponent,
              {
                error: {
                  title: 'No Active Runs',
                  message: `No currently running brain runs found for brain "${filename}".`,
                  details: `To start a new run, use: positronic run ${filename}`
                }
              }
            );
          }

          if (result.runs.length > 1) {
            return React.createElement(
              ErrorComponent,
              {
                error: {
                  title: 'Multiple Active Runs',
                  message: `Found ${result.runs.length} active runs for brain "${filename}".`,
                  details: `Please specify a specific run ID with --run-id:\n${result.runs.map(run => `  positronic watch --run-id ${run.brainRunId}`).join('\n')}`
                }
              }
            );
          }

          // Exactly one active run found - watch it
          const activeRun = result.runs[0];
          const port = process.env.POSITRONIC_PORT || '8787';
          return React.createElement(Watch, { runId: activeRun.brainRunId, port });
        } else {
          const errorText = await response.text();
          return React.createElement(
            ErrorComponent,
            {
              error: {
                title: 'API Error',
                message: `Failed to get active runs for brain "${filename}".`,
                details: `Server returned ${response.status}: ${errorText}`
              }
            }
          );
        }
      } catch (error: any) {
        return React.createElement(
          ErrorComponent,
          {
            error: {
              title: 'Connection Error',
              message: 'Error connecting to the local development server.',
              details: `Please ensure the server is running ('positronic server' or 'px s').\n\nError details: ${error.message}`
            }
          }
        );
      }
    }

    // Neither runId nor brainName provided – return an error element.
    return React.createElement(
      Text,
      { color: 'red' as any }, // Ink Text color prop
      'Error: You must provide either a brain run ID or a brain name.'
    );
  }

}
