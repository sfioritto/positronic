import { Adapter, WORKFLOW_EVENTS, WorkflowEvent } from '@positronic/core';

export class ConsoleAdapter extends Adapter {
  private stepNumber: number;
  private currentStepTitle: string | null = null;

  // Track workflow hierarchy using run IDs
  private workflowHierarchy: Map<string, string> = new Map(); // child -> parent
  private topLevelWorkflowId: string | null = null;

  constructor(startingStep: number = 1) {
    super();
    this.stepNumber = startingStep;
  }

  private getWorkflowDepth(runId: string): number {
    let depth = 0;
    let currentId = runId;

    while (this.workflowHierarchy.has(currentId)) {
      depth++;
      currentId = this.workflowHierarchy.get(currentId)!;
    }

    return depth;
  }

  private isNestedWorkflow(runId: string): boolean {
    return this.workflowHierarchy.has(runId);
  }

  private getIndentation(runId: string): string {
    const depth = this.getWorkflowDepth(runId);
    if (depth === 0) return '';
    return '  '.repeat(depth - 1) + '└─ ';
  }

  public async dispatch(event: WorkflowEvent) {
    switch (event.type) {
      case WORKFLOW_EVENTS.START:
      case WORKFLOW_EVENTS.RESTART:
        // Only set top level workflow ID if we don't have one
        if (!this.topLevelWorkflowId) {
          this.topLevelWorkflowId = event.workflowRunId;
        } else if (this.topLevelWorkflowId !== event.workflowRunId) {
          // This is a nested workflow start
          this.workflowHierarchy.set(event.workflowRunId, this.topLevelWorkflowId);
        }
        break;

      case WORKFLOW_EVENTS.COMPLETE:
        if (event.workflowRunId === this.topLevelWorkflowId) {
          this.topLevelWorkflowId = null;
        }
        this.workflowHierarchy.delete(event.workflowRunId);
        break;

      case WORKFLOW_EVENTS.STEP_START:
        this.currentStepTitle = event.stepTitle;
        const isNested = this.isNestedWorkflow(event.workflowRunId);
        const startPrefix = isNested
          ? this.getIndentation(event.workflowRunId)
          : `${this.stepNumber}. `;
        process.stdout.write(`\r${startPrefix}${this.currentStepTitle}...`);
        break;

      case WORKFLOW_EVENTS.STEP_COMPLETE:
        if (this.currentStepTitle === event.stepTitle) {
          const isNested = this.isNestedWorkflow(event.workflowRunId);
          const completePrefix = isNested
            ? this.getIndentation(event.workflowRunId)
            : `${this.stepNumber}. `;
          // \x1b[K clears from cursor to end of line
          process.stdout.write(`\r${completePrefix}${event.stepTitle} ✅\x1b[K\n`);
          if (!isNested) {
            this.stepNumber++;
          }
        }
        break;
    }
  }
}