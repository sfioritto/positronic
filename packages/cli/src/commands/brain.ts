import type { ArgumentsCamelCase } from 'yargs';
import { EventSource } from 'eventsource';
import { apiFetch } from './helpers.js';

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
      const response = await apiFetch(apiPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ brainName }),
      });

      if (response.status === 201) {
        const result = (await response.json()) as { brainRunId: string };
        if (watch) {
          this.watch({
            runId: result.brainRunId,
            _: [],
            $0: '',
          });
          await new Promise(() => {});
        } else {
          console.log(`Run ID: ${result.brainRunId}`);
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

  watch({ runId, name: brainName }: ArgumentsCamelCase<BrainWatchArgs>) {
    if (runId) {
      const port = process.env.POSITRONIC_SERVER_PORT || '8787';
      const baseUrl = `http://localhost:${port}`;
      const url = `${baseUrl}/brains/runs/${runId}/watch`;

      const es = new EventSource(url);

      es.onmessage = (event: MessageEvent) => {
        try {
          const eventData = JSON.parse(event.data);
          console.log(JSON.stringify(eventData, null, 2));
        } catch (e) {
          console.error('Error parsing event data:', e);
        }
      };
      // Add error handling for EventSource connection
      es.onerror = (err) => {
        console.error(`EventSource failed for URL: ${url}`, err);
        // Decide if we should exit or retry
        es.close(); // Close on error for now
        process.exit(1);
      };
    } else if (brainName) {
      // TODO: Implement logic to first fetch the latest run ID for brainName
      // This fetch should use apiFetch
    } else {
      console.error(
        'Internal Error: Watch command called without --run-id or --name.'
      );
      process.exit(1);
    }
  }

  new({ name: brainName, prompt }: ArgumentsCamelCase<BrainNewArgs>) {
    // Implement brain creation logic
  }
}
