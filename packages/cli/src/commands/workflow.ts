import type { ArgumentsCamelCase } from 'yargs';
import * as path from 'path';
import * as fsPromises from 'fs/promises';

export class WorkflowCommand {
    private projectRootPath: string | null;
    private workflowTemplateDir: string;

    constructor(projectRootPath: string | null, workflowTemplateDir: string) {
        this.projectRootPath = projectRootPath;
        this.workflowTemplateDir = workflowTemplateDir;
    }

    // Handler for workflow list (placeholder)
    // list(argv: ArgumentsCamelCase<any>): void {
    //     console.log('Listing all workflows...');
    // }

    // Handler for workflow history
    history(argv: ArgumentsCamelCase<{ workflowName: string; limit: number }>): void {
        const workflowName = argv.workflowName;
        const limit = argv.limit;

        console.log(`Listing ${limit} recent runs for workflow: ${workflowName} (including output and state information)`);
        // Actual implementation would go here
    }

    // Handler for workflow show (placeholder)
    show(argv: ArgumentsCamelCase<{ workflowName: string }>): void {
        console.log(`Showing details for workflow: ${argv.workflowName}`);
        // Actual implementation would go here
    }

    // Handler for workflow rerun
    rerun(argv: ArgumentsCamelCase<{ workflowName: string; workflowRunId?: string; startsAt?: number; stopsAfter?: number; verbose?: boolean }>): void {
        const workflowName = argv.workflowName;
        const workflowRunId = argv.workflowRunId || 'most recent run';
        const startsAt = argv.startsAt ? ` starting at step ${argv.startsAt}` : '';
        const stopsAfter = argv.stopsAfter ? ` stopping after step ${argv.stopsAfter}` : '';
        const verbose = argv.verbose ? ' with verbose output' : '';

        console.log(`Rerunning workflow: ${workflowName} (run: ${workflowRunId})${startsAt}${stopsAfter}${verbose}`);
         // Actual implementation would go here
    }

    // Handler for workflow run
    run(argv: ArgumentsCamelCase<{ workflowName: string; verbose?: boolean }>): void {
        // Note: The actual run logic is handled by the top-level 'run' command via RunCommand.
        // This handler within 'workflow run' might be redundant or could offer alternative run mechanisms in the future.
        const workflowName = argv.workflowName;
        const verbose = argv.verbose ? ' with verbose output' : '';

        console.log(`(Workflow Command) Running workflow: ${workflowName}${verbose}`);
        // Actual implementation (potentially different from top-level run) would go here
        // Consider if this specific command should delegate to RunCommand or have its own logic.
         console.warn("Warning: Prefer using 'positronic run <workflow-name>' for running workflows locally.");
    }

    // Handler for workflow watch
    watch(argv: ArgumentsCamelCase<{ workflowName: string; runId: string }>): void {
        const workflowName = argv.workflowName;
        const runId = argv.runId;
        console.log(`Watching workflow: ${workflowName}, Run ID: ${runId}`);
        // TODO: Implement SSE connection logic
    }

    // Handler for workflow new (Local Dev Mode only)
    new(argv: ArgumentsCamelCase<{ workflowName: string; prompt?: string }>): void {
        // No need to check isLocalDevMode here as the command is only registered in that mode
        if (!this.projectRootPath) {
            // Should theoretically not happen if called correctly, but good practice
            console.error("Internal Error: Project root path not available for workflow new command.");
            process.exit(1);
        }

        const workflowName = argv.workflowName;
        const workflowFileName = `${workflowName}.ts`;
        const workflowsDir = path.join(this.projectRootPath, 'workflows');
        const destinationPath = path.join(workflowsDir, workflowFileName);
        const templatePath = path.join(this.workflowTemplateDir, 'new.ts.tpl');

        console.log(`Creating new workflow '${workflowName}' in ${workflowsDir}...`);

        fsPromises.mkdir(workflowsDir, { recursive: true })
            .then(() => fsPromises.copyFile(templatePath, destinationPath))
            .then(() => {
                console.log(`Workflow file created: ${destinationPath}`);
            })
            .catch((err) => {
                console.error(`Error creating workflow file:`, err);
                process.exit(1);
            });
    }
}