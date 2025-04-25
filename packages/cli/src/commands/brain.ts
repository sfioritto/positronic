import type { ArgumentsCamelCase } from 'yargs';
import * as path from 'path';
import * as fsPromises from 'fs/promises';

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
    history(argv: ArgumentsCamelCase<{ brainName: string; limit: number }>): void {
        const brainName = argv.brainName;
        const limit = argv.limit;

        console.log(`Listing ${limit} recent runs for brain: ${brainName}`);
        // TODO: Implement brain history logic (API call)
    }

    // Handler for brain show (placeholder)
    show(argv: ArgumentsCamelCase<{ brainName: string }>): void {
        console.log(`Showing details for brain: ${argv.brainName}`);
         // TODO: Implement brain show logic (API call)
    }

    // Handler for brain rerun
    rerun(argv: ArgumentsCamelCase<{ brainName: string; brainRunId?: string; startsAt?: number; stopsAfter?: number; verbose?: boolean }>): void {
        const brainName = argv.brainName;
        const brainRunId = argv.brainRunId || 'most recent run';
        const startsAt = argv.startsAt ? ` starting at step ${argv.startsAt}` : '';
        const stopsAfter = argv.stopsAfter ? ` stopping after step ${argv.stopsAfter}` : '';
        const verbose = argv.verbose ? ' with verbose output' : '';

        console.log(`Rerunning brain: ${brainName} (run: ${brainRunId})${startsAt}${stopsAfter}${verbose}`);
         // TODO: Implement brain rerun logic (API call)
    }

    // Handler for brain run
    run(argv: ArgumentsCamelCase<{ brainName: string; verbose?: boolean }>): void {
        // Note: The actual run logic is likely handled by the top-level 'run' command via RunCommand.
        // This handler within 'brain run' might be redundant or could offer alternative run mechanisms.
        const brainName = argv.brainName;
        const verbose = argv.verbose ? ' with verbose output' : '';

        console.log(`(Brain Command) Running brain: ${brainName}${verbose}`);
        // Consider if this specific command should delegate to RunCommand or have its own logic.
         console.warn("Warning: Prefer using 'positronic run <brain-name>' for running brains.");
    }

    // Handler for brain watch
    watch(argv: ArgumentsCamelCase<{ brainName: string; runId: string }>): void {
        const brainName = argv.brainName;
        const runId = argv.runId;
        console.log(`Watching brain: ${brainName}, Run ID: ${runId}`);
        // TODO: Implement SSE connection logic using the API endpoint `/brains/runs/${runId}/watch` or `/brains/watch`
    }

    // Handler for brain new (Local Dev Mode only)
    // Adapted from WorkflowCommand's new handler
    new(argv: ArgumentsCamelCase<{ brainName: string; prompt?: string }>): void {
        // isLocalDevMode check is implicitly handled by command registration
        if (!this.isLocalDevMode || !this.projectRootPath) {
            console.error("Internal Error: 'brain new' command requires local dev mode and project root path.");
            process.exit(1);
        }

        const brainName = argv.brainName;
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