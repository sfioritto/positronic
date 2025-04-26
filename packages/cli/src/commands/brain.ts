import type { ArgumentsCamelCase } from 'yargs';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid'; // Import if needed for local testing/mocking?
import { EventSource } from 'eventsource'; // Use named import

export class BrainCommand {
    private isLocalDevMode: boolean;
    private projectRootPath: string | null;
    private brainTemplateDir: string; // Changed from workflowTemplateDir

    constructor(isLocalDevMode: boolean, projectRootPath: string | null, brainTemplateDir: string) {
        this.isLocalDevMode = isLocalDevMode;
        this.projectRootPath = projectRootPath;
        this.brainTemplateDir = brainTemplateDir; // Changed from workflowTemplateDir
    }

    // Handler for brain list (placeholder)
    list(argv: ArgumentsCamelCase<any>): void {
        console.log('Listing all brains...');
        // TODO: Implement brain list logic (local or remote)
    }

    // Handler for brain history
    history(argv: ArgumentsCamelCase<{ name: string; limit: number }>): void {
        const brainName = argv.name;
        const limit = argv.limit;

        console.log(`Listing ${limit} recent runs for brain: ${brainName}`);
        // TODO: Implement brain history logic (API call)
    }

    // Handler for brain show (placeholder)
    show(argv: ArgumentsCamelCase<{ name: string }>): void {
        console.log(`Showing details for brain: ${argv.name}`);
         // TODO: Implement brain show logic (API call)
    }

    // Handler for brain rerun
    rerun(argv: ArgumentsCamelCase<{ name: string; runId?: string; startsAt?: number; stopsAfter?: number; verbose?: boolean }>): void {
        const brainName = argv.name;
        const runId = argv.runId || 'most recent run';
        const startsAt = argv.startsAt ? ` starting at step ${argv.startsAt}` : '';
        const stopsAfter = argv.stopsAfter ? ` stopping after step ${argv.stopsAfter}` : '';
        const verbose = argv.verbose ? ' with verbose output' : '';

        console.log(`Rerunning brain: ${brainName} (run: ${runId})${startsAt}${stopsAfter}${verbose}`);
         // TODO: Implement brain rerun logic (API call)
    }

    // Handler for brain run
    async run(argv: ArgumentsCamelCase<{ name: string; verbose?: boolean }>): Promise<void> {
        // Note: The actual run logic is likely handled by the top-level 'run' command via RunCommand.
        // This handler within 'brain run' might be redundant or could offer alternative run mechanisms.
        const brainName = argv.name;
        const verbose = argv.verbose ? ' with verbose output' : '';

        // console.log(`(Brain Command) Running brain: ${brainName}${verbose}`); // Old message
        console.log(`Attempting to run brain: ${brainName}...`); // Updated to match test/previous RunCommand
        // Consider if this specific command should delegate to RunCommand or have its own logic.
         console.warn("Warning: Prefer using 'positronic run <brain-name>' for running brains.");

        // --- Start: Logic adapted from former RunCommand --- //

        if (!this.isLocalDevMode) {
            // This check might be redundant if called via top-level command which already checks, but good for safety
            console.error("Error: The 'run' command currently only supports Local Development Mode.");
            console.error("Please ensure you are inside a Positronic project directory and the dev server is running ('positronic server' or 'px s').");
            process.exit(1);
        }

        const apiUrl = 'http://localhost:8787/brains/runs'; // Updated endpoint for brains

        console.log(`Attempting to run brain: ${brainName}...`);

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ brainName }), // Updated payload key
            });

            if (response.status === 201) {
                // Assuming the response structure is { brainRunId: string }
                const result = await response.json() as { brainRunId: string };
                console.log(`Brain run started successfully.`); // Log success
                console.log(`Run ID: ${result.brainRunId}`);    // Log Run ID
                if (argv.verbose) {
                    console.log("Verbose flag detected. You can watch the run with:");
                    // Updated watch command example
                    console.log(`  positronic watch ${brainName} --run-id ${result.brainRunId}`);
                }
            } else {
                const errorText = await response.text();
                console.error(`Error starting brain run: ${response.status} ${response.statusText}`); // Updated log
                console.error(`Server response: ${errorText}`);
                process.exit(1);
            }
        } catch (error: any) {
            console.error(`Error connecting to the local development server at ${apiUrl}.`);
            console.error("Please ensure the server is running ('positronic server' or 'px s').");
            if (error.code === 'ECONNREFUSED') {
               console.error("Reason: Connection refused. The server might not be running or is listening on a different port.");
            } else {
               console.error(`Fetch error details: ${error.message}`);
            }
            process.exit(1);
        }
        // --- End: Logic adapted from former RunCommand --- //
    }

    // Handler for brain watch
    // Updated signature to accept optional runId or name
    watch(argv: ArgumentsCamelCase<{ runId?: string; name?: string }>): void {
        if (argv.runId) {
            const runId = argv.runId;
            console.log(`Watching specific brain run ID: ${runId}...`);
            // TODO: Implement SSE connection logic using the API endpoint `/brains/runs/${runId}/watch`
            const url = `http://localhost:8787/brains/runs/${runId}/watch`;

            const es = new EventSource(url);

            es.onopen = () => {
                console.log(`Connected to event stream for run ID: ${runId}`);
            };

            es.onmessage = (event: MessageEvent) => {
                try {
                    // Assuming the server sends JSON data
                    const eventData = JSON.parse(event.data);
                    // Pretty-print the JSON event data
                    console.log(JSON.stringify(eventData, null, 2));
                } catch (e) {
                    console.error('Error parsing event data:', e);
                    console.log('Received raw data:', event.data);
                }
            };

            es.onerror = (err: any) => {
                // The EventSource library automatically handles reconnection on most errors.
                // We only need to handle fatal errors or provide feedback.
                console.error('EventSource encountered an error:', err);
                // You might want to add specific error handling, e.g., check for connection refused
                // and prompt the user to ensure the server is running.
                if ((err as any)?.status === 404) {
                     console.error(`Error: Run ID '${runId}' not found on the server.`);
                     es.close(); // Close the connection on 404
                } else if ((err as any)?.message?.includes('ECONNREFUSED')) {
                     console.error('Error: Connection refused. Is the local dev server running? (px s)');
                     es.close(); // Close on connection refused
                }
                // The EventSource library attempts reconnection automatically for other errors.
                // If reconnection fails repeatedly, it will eventually stop.
            };

        } else if (argv.name) {
            const brainName = argv.name;
            console.log(`Watching latest run for brain name: ${brainName}`);
            // TODO: Implement logic to first fetch the latest run ID for brainName
            // TODO: Then, implement SSE connection logic using the fetched run ID
        } else {
            // This case should technically not be reachable due to the .check in yargs config
            console.error("Internal Error: Watch command called without --run-id or --name.");
            process.exit(1);
        }
    }

    // Handler for brain new (Local Dev Mode only)
    // Adapted from WorkflowCommand's new handler
    new(argv: ArgumentsCamelCase<{ name: string; prompt?: string }>): void {
        // isLocalDevMode check is implicitly handled by command registration
        if (!this.isLocalDevMode || !this.projectRootPath) {
            console.error("Internal Error: 'brain new' command requires local dev mode and project root path.");
            process.exit(1);
        }

        const brainName = argv.name;
        const brainFileName = `${brainName}.ts`; // Brains are TS files like workflows were
        const brainsDir = path.join(this.projectRootPath, 'brains'); // New directory name
        const destinationPath = path.join(brainsDir, brainFileName);
        // Assuming a generic template exists or the workflow one is suitable
        const templatePath = path.join(this.brainTemplateDir, 'new.ts.tpl');

        console.log(`Creating new brain '${brainName}' in ${brainsDir}...${argv.prompt ? ` (Prompt: "${argv.prompt}")` : ''}`);
        // TODO: Potentially use the prompt for generation later

        fsPromises.mkdir(brainsDir, { recursive: true })
            .then(() => fsPromises.copyFile(templatePath, destinationPath))
            .then(() => {
                console.log(`Brain file created: ${destinationPath}`);
                console.log(`
Next steps:`);
                console.log(`  - Edit ${path.relative(process.cwd(), destinationPath)} to define your brain logic.`);
                console.log(`  - Run your brain locally with: positronic run ${brainName}`);
            })
            .catch((err) => {
                console.error(`Error creating brain file:`, err);
                process.exit(1);
            });
    }
}