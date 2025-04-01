export default ({ workflowName }: { workflowName: string }) => {
  const workflowTitle = workflowName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return `import { defineWorkflow } from '@positronic/core';

export default defineWorkflow({
  title: '${workflowTitle}',
  description: 'A workflow for ${workflowTitle}',
  type: 'workflow',
  blocks: [
    {
      title: 'First step',
      prompt: \`
        # First Step Instructions

        This is the first step of the ${workflowTitle} workflow.

        ## Task

        Describe what needs to be done in this step.

        ## Context

        Provide any context that would be helpful for completing this task.
      \`
    },
    {
      title: 'Second step',
      prompt: \`
        # Second Step Instructions

        This is the second step of the ${workflowTitle} workflow.

        ## Task

        Describe what needs to be done in this step.

        ## Context

        Provide any context that would be helpful for completing this task.
      \`
    }
  ]
});
`;
};