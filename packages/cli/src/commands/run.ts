import type { ArgumentsCamelCase } from 'yargs';
import fetch from 'node-fetch'; // Assuming node-fetch is available or polyfilled

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

        // Simplified: Always use the positional argument for the brain name
        const brainName = argv['name-or-path'] as string | undefined;
        const startsAtArg = argv['starts-at'] as number | undefined;
        const stopsAfterArg = argv['stops-after'] as number | undefined;
        const verboseArg = argv.verbose as boolean | undefined;

        if (!brainName) {
            console.error("Error: You must specify the name of the brain to run.");
            console.error("Example: positronic run my-brain");
            process.exit(1);
        }

        // Warn about ignored options, updated for brain
        if (startsAtArg || stopsAfterArg) {
            console.warn("Warning: --starts-at and --stops-after options are ignored by the 'run' command.");
            console.warn("         Use 'positronic brain rerun' to run specific step ranges.");
        }

        // API call logic updated for brains
        const apiUrl = 'http://localhost:8787/brains/runs'; // Updated endpoint
        const verbose = verboseArg;

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
                console.log(`Brain run started successfully.`); // Updated log
                console.log(`Run ID: ${result.brainRunId}`);
                if (verbose) {
                    console.log("Verbose flag detected. You can watch the run with:");
                    // Updated watch command example
                    console.log(`  positronic brain watch ${brainName} --run-id ${result.brainRunId}`);
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
    }
}