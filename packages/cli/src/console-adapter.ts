import { Adapter, WORKFLOW_EVENTS, WorkflowEvent } from '@positronic/core';

export class ConsoleAdapter extends Adapter {
  private stepNumber = 1;
  private currentStepTitle: string | null = null;

  public async dispatch(event: WorkflowEvent) {
    switch (event.type) {
      case WORKFLOW_EVENTS.STEP_START:
        this.currentStepTitle = event.stepTitle;
        process.stdout.write(`\r${this.stepNumber}. ${this.currentStepTitle}...`);
        break;

      case WORKFLOW_EVENTS.STEP_COMPLETE:
        if (this.currentStepTitle === event.stepTitle) {
          // \x1b[K clears from cursor to end of line
          process.stdout.write(`\r${this.stepNumber}. ${event.stepTitle} ✅\x1b[K\n`);
          this.stepNumber++;
        }
        break;
    }
  }
}