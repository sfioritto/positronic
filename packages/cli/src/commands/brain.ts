import type { ArgumentsCamelCase } from 'yargs';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid'; // Import if needed for local testing/mocking?
import { EventSource } from 'eventsource'; // Use named import

// Define argument types for clarity
interface BrainListArgs {} // No specific args yet
interface BrainHistoryArgs { name: string; limit: number; }
interface BrainShowArgs { name: string; }
interface BrainRerunArgs { name: string; runId?: string; startsAt?: number; stopsAfter?: number; }
interface BrainRunArgs { name: string; }
interface BrainWatchArgs { runId?: string; name?: string; }
interface BrainNewArgs { name: string; prompt?: string; }

export class BrainCommand {
    private isLocalDevMode: boolean;
    private projectRootPath: string | null;
    private brainTemplateDir: string; // Changed from workflowTemplateDir

    constructor(isLocalDevMode: boolean, projectRootPath: string | null, brainTemplateDir: string) {
        this.isLocalDevMode = isLocalDevMode;
        this.projectRootPath = projectRootPath;
        this.brainTemplateDir = brainTemplateDir; // Changed from workflowTemplateDir
    }

    // Handler for brain list
    list(argv: ArgumentsCamelCase<BrainListArgs>) {
        // Implement brain list logic (local or remote)
    }

    // Handler for brain history
    history({ name: brainName, limit }: ArgumentsCamelCase<BrainHistoryArgs>) {
        // Implement brain history logic (API call)
    }

    // Handler for brain show
    show({ name: brainName }: ArgumentsCamelCase<BrainShowArgs>) {
        // Implement brain show logic (API call)
    }

    // Handler for brain rerun
    rerun({ name: brainName, runId, startsAt, stopsAfter }: ArgumentsCamelCase<BrainRerunArgs>) {
        // Implement brain rerun logic (API call)
    }

    // Handler for brain run
    async run({ name: brainName }: ArgumentsCamelCase<BrainRunArgs>) {
        console.log(`Attempting to run brain: ${brainName}...`); // Added back for test

        const apiUrl = 'http://localhost:8787/brains/runs'; // Updated endpoint for brains

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
                console.log(`Brain run started successfully.`); // Added back for test
                console.log(`Run ID: ${result.brainRunId}`);    // Added back for test
                // Success, potentially use result.brainRunId
            } else {
                const errorText = await response.text();
                // Handle error
                console.error(`Error starting brain run: ${response.status} ${response.statusText}`); // Updated log
                console.error(`Server response: ${errorText}`);
                process.exit(1);
            }
        } catch (error: any) {
            // Handle connection error
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
    watch({ runId, name: brainName }: ArgumentsCamelCase<BrainWatchArgs>) {
        if (runId) {
            // Implement SSE connection logic using the API endpoint `/brains/runs/${runId}/watch`
            const url = `http://localhost:8787/brains/runs/${runId}/watch`;

            const es = new EventSource(url);

            es.onopen = () => {
                // Connected
            };

            es.onmessage = (event: MessageEvent) => {
                try {
                    // Assuming the server sends JSON data
                    const eventData = JSON.parse(event.data);
                    // Process eventData
                    // Pretty-print the JSON event data
                    console.log(JSON.stringify(eventData, null, 2)); // Re-enabled logging
                } catch (e) {
                   // Error parsing event data
                   console.error('Error parsing event data:', e);
                }
            };

        } else if (brainName) {
             // Implement logic to first fetch the latest run ID for brainName
             // Then, implement SSE connection logic using the fetched run ID
        } else {
            // This case should technically not be reachable due to the .check in yargs config
            console.error("Internal Error: Watch command called without --run-id or --name.");
            process.exit(1);
        }
    }

    // Handler for brain new (Local Dev Mode only)
    // Adapted from WorkflowCommand's new handler
    new({ name: brainName, prompt }: ArgumentsCamelCase<BrainNewArgs>) {
        // Implement brain creation logic
    }
}