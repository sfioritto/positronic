import { workflow } from './blocks';
import { AnthropicClient } from '../clients/anthropic';
import { z } from 'zod';
import '../extensions/slack';
import '../extensions/fetch';

const client = new AnthropicClient();

// Basic workflow example showing context type inference
const coverageWorkflow = workflow("Coverage Analysis", client)
  .step("Get coverage", ({ context }) => ({
    ...context,
    coverage: { files: ["file1.ts", "file2.ts"] }
  }))
  .slack.message("Notify Coverage Start", {
    channel: "#workflows",
    message: ctx => `Starting coverage analysis for ${ctx.coverage.files.length} files`
  })
  .step("Find lowest coverage", ({ context }) => ({
    ...context,
    lowestCoverageFile: { path: context.coverage.files[0] }
  }))
  .slack.notify("Alert Team", {
    users: ['@alice', '@bob'],
    message: ctx => `Low coverage found in: ${ctx.lowestCoverageFile.path}`
  });

// Example using fetch extension
const userDataWorkflow = workflow(
  {
    title: "User Data Operations",
    description: "Fetches and processes user data"
  },
  client
)
  .step("Initialize user", ({ context }) => ({
    ...context,
    userId: "user123"
  }))
  .fetch("Get User Data", {
    url: ctx => `https://api.example.com/users/${ctx.userId}`,
    schema: z.object({
      name: z.string(),
      email: z.string().email(),
      preferences: z.object({
        theme: z.string(),
        notifications: z.boolean()
      })
    })
  })
  .slack.message("User Data Retrieved", {
    channel: "#user-updates",
    message: ctx => `Retrieved data for ${ctx.name} (${ctx.email})`
  });

const asyncWorkflow = workflow("Async Example", client)
  // Synchronous step
  .step("Initialize", ({ context }) => ({
    ...context,
    userId: "123"
  }))
  // Asynchronous step
  .step("Fetch User Data", async ({ context }) => {
    const response = await fetch(`https://api.example.com/users/${context.userId}`);
    const userData = await response.json();
    return {
      ...context,
      userData
    };
  })
  .step("simple step", ({ context }) => (context))


// Example with workflow options
interface FeatureOptions {
  features: string[];
  apiKey: string;
}

const optionsWorkflow = workflow<FeatureOptions>("Options Workflow", client)
  .step("Check features", ({ context, options }) => ({
    ...context,
    hasSpeed: options.features.includes('speed'),
    hasManeuver: options.features.includes('maneuver')
  }))
  .fetch("Get Feature Details", {
    url: ctx => `https://api.example.com/features`,
    schema: z.object({
      features: z.array(z.string())
    })
  })
  .step("Process features", ({ context }) => ({
    ...context,
    processed: context.hasSpeed && context.hasManeuver
  }));

// Example of nested workflows
const nestedWorkflow = workflow<FeatureOptions>("Nested Workflow Example", client)
  .step("Initialize", ({ context }) => ({
    ...context,
    initialized: true
  }))
  .workflow(
    "Process Options",
    optionsWorkflow,
    ({ context, workflowContext }) => ({
      ...context,
      featureResults: {
        hasSpeed: workflowContext.hasSpeed,
        hasManeuver: workflowContext.hasManeuver,
        processed: workflowContext.processed
      }
    })
  )
  .slack.notify("Feature Processing Complete", {
    users: ['@devteam'],
    message: ctx => `Feature processing completed with results: ${JSON.stringify(ctx.featureResults)}`
  });

// Execute workflows
async function executeWorkflow(wf: any, options?: any) {
  console.log(`Executing: ${wf.title}`);
  console.log('--------------------------------');
  for await (const event of wf.run({ options })) {
    if (event.type === 'workflow:update') {
      console.log('Step completed:', event.completedStep?.title);
    }
  }
  console.log('\n');
}

// Run the workflows
(async () => {
  await executeWorkflow(coverageWorkflow);
  await executeWorkflow(userDataWorkflow);
  await executeWorkflow(optionsWorkflow, {
    features: ['speed', 'maneuver'],
    apiKey: 'test-api-key'
  });
  await executeWorkflow(nestedWorkflow, {
    features: ['speed', 'maneuver'],
    apiKey: 'test-api-key'
  });
})();

