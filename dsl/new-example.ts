import { workflow, type Workflow } from './blocks';
import type { SlackMessage, SlackNotification } from '../extensions/slack';
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

// Type testing utilities
type AssertEquals<T, U> =
  0 extends (1 & T) ? false : // fails if T is any
  0 extends (1 & U) ? false : // fails if U is any
  [T] extends [U] ? [U] extends [T] ? true : false : false;

// Extract types from workflows
type ExtractContextType<T> = T extends Workflow<infer Context> ? Context : never;
type ExtractOptionsType<T> = T extends Workflow<any, infer Options> ? Options : never;

// Expected types for coverageWorkflow
type ExpectedCoverageContext = {
  coverage: { files: string[] };
  lowestCoverageFile: { path: string };
  lastSlackMessage: SlackMessage;
  lastSlackNotification: SlackNotification;
};
type TestCoverageContext = ExtractContextType<typeof coverageWorkflow>;
const _coverageTypeTest: AssertEquals<TestCoverageContext, ExpectedCoverageContext> = true;

// Expected types for userDataWorkflow
type ExpectedUserDataContext = {
  userId: string;
  name: string;
  email: string;
  preferences: {
    theme: string;
    notifications: boolean;
  };
  lastSlackMessage: SlackMessage;
};
type TestUserDataContext = ExtractContextType<typeof userDataWorkflow>;
const _userDataTypeTest: AssertEquals<TestUserDataContext, ExpectedUserDataContext> = true;

// Expected types for asyncWorkflow
type ExpectedAsyncContext = {
  userId: string;
  userData: any;
};
type TestAsyncContext = ExtractContextType<typeof asyncWorkflow>;
const _asyncTypeTest: AssertEquals<TestAsyncContext, ExpectedAsyncContext> = true;

// Expected types for optionsWorkflow
type ExpectedOptionsContext = {
  hasSpeed: boolean;
  hasManeuver: boolean;
  features: string[];
  processed: boolean;
};
type TestOptionsOptions = ExtractOptionsType<typeof optionsWorkflow>;
type TestOptionsContext = ExtractContextType<typeof optionsWorkflow>;
const _optionsContextTypeTest: AssertEquals<TestOptionsContext, ExpectedOptionsContext> = true;
const _optionsOptionsTypeTest: AssertEquals<TestOptionsOptions, FeatureOptions> = true;

// Expected types for nestedWorkflow
type ExpectedNestedContext = {
  initialized: boolean;
  featureResults: {
    hasSpeed: boolean;
    hasManeuver: boolean;
    processed: boolean;
  };
  lastSlackNotification: SlackNotification;
};
type TestNestedContext = ExtractContextType<typeof nestedWorkflow>;
type TestNestedOptions = ExtractOptionsType<typeof nestedWorkflow>;
const _nestedContextTypeTest: AssertEquals<TestNestedContext, ExpectedNestedContext> = true;
const _nestedOptionsTypeTest: AssertEquals<TestNestedOptions, FeatureOptions> = true;

// Debug type inference
type WorkflowType = typeof optionsWorkflow;
type OptionsType = WorkflowType extends Workflow<any, infer O> ? O : never;
type TestOptionsOptions = OptionsType;

