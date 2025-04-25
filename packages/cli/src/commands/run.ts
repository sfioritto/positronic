import type { ArgumentsCamelCase } from 'yargs';
import fetch from 'node-fetch'; // Need to import fetch

export class RunCommand {
    private isLocalDevMode: boolean;

    constructor(isLocalDevMode: boolean) {
        this.isLocalDevMode = isLocalDevMode;
    }

    async handle(argv: ArgumentsCamelCase<any>): Promise<void> {
        if (!this.isLocalDevMode) {
            console.error("Error: The 'run' command currently only supports Local Development Mode.");
            console.error("Please ensure you are inside a Positronic project directory and the dev server is running ('positronic server' or 'px s').");
            process.exit(1);
        }

        let targetType: 'workflow' | 'agent' | null = null;
        let targetName: string | null = null;

        // Type assertion for argv properties if needed, or use a more specific type for ArgumentsCamelCase
        const agentArg = argv.agent as string | undefined;
        const workflowArg = argv.workflow as string | undefined;
        const nameOrPathArg = argv['name-or-path'] as string | undefined;
        const startsAtArg = argv['starts-at'] as number | undefined;
        const stopsAfterArg = argv['stops-after'] as number | undefined;
        const verboseArg = argv.verbose as boolean | undefined;

        if (agentArg) {
            targetType = 'agent';
            targetName = agentArg;
            console.error("Error: Running agents via the 'run' command is not yet supported by the local development server.");
            process.exit(1);
            // Future implementation for agents would go here
        } else if (workflowArg) {
            targetType = 'workflow';
            targetName = workflowArg;
        } else if (nameOrPathArg) {
            // If no explicit type flag, assume it's a workflow
            targetType = 'workflow';
            targetName = nameOrPathArg;
        } else {
            console.error("Error: You must specify the name of the workflow or agent to run.");
            console.error("Example: positronic run my-workflow");
            console.error("Example: positronic run --workflow my-workflow");
            process.exit(1);
        }

        // Warn about ignored options for workflows
        if (targetType === 'workflow' && (startsAtArg || stopsAfterArg)) {
            console.warn("Warning: --starts-at and --stops-after options are ignored by the 'run' command.");
            console.warn("         Use 'positronic workflow rerun' to run specific step ranges.");
        }

        if (targetType === 'workflow' && targetName) {
            const apiUrl = 'http://localhost:8787/workflows/runs'; // Default port
            const workflowName = targetName;
            const verbose = verboseArg;

            console.log(`Attempting to run workflow: ${workflowName}...`);

            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ workflowName }),
                });

                if (response.status === 201) {
                    const result = await response.json() as { workflowRunId: string };
                    console.log(`Workflow run started successfully.`);
                    console.log(`Run ID: ${result.workflowRunId}`);
                    if (verbose) {
                        console.log("Verbose flag detected. You can watch the run with:");
                        console.log(`  positronic workflow watch ${workflowName} --run-id ${result.workflowRunId}`);
                        // TODO: Potentially trigger watch directly?
                    }
                } else {
                    const errorText = await response.text();
                    console.error(`Error starting workflow run: ${response.status} ${response.statusText}`);
                    console.error(`Server response: ${errorText}`);
                    process.exit(1);
                }
            } catch (error: any) {
                console.error(`Error connecting to the local development server at ${apiUrl}.`);
                console.error("Please ensure the server is running ('positronic server' or 'px s').");
                // Check if it's a connection refused error
                if (error.code === 'ECONNREFUSED') {
                   console.error("Reason: Connection refused. The server might not be running or is listening on a different port.");
                } else {
                   console.error(`Fetch error details: ${error.message}`);
                }
                process.exit(1);
            }
        }
        // No else block needed as agent case exits earlier
    }
}