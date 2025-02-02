import { createWorkflow, createExtension } from './new-dsl';
import type { Workflow } from './new-dsl';


export const simpleExtension = createExtension({
  simple: (message: string) => ({
    title: `Prints simple message: ${message}`,
    action: ({ context }) => ({
      message: `${message}: cool${context?.cool || '? ...not cool yet'}`
    }),
  })
});

export const anotherExtension = createExtension({
  another: () => async ({ context }) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
    return { another: 'another extension' };
  }
});

export const mathExtension = createExtension({
  math: {
    add: (a: number, b: number) => ({
      title: `Adding ${a} + ${b}...`,
      action: ({ context }) => {
        const result = (context.result as number ?? 0) + a + b;
        return {
          ...context,
          result
        };
      }
    }),
    multiply: (a: number, b: number) => ({
      title: `Multiplying ${a} * ${b}...`,
      action: ({ context }) => ({
        ...context,
        result: (context.result as number ?? 1) * a * b
      })
    })
  }
});

// Basic workflow example showing type inference with string name
const myWorkflow = createWorkflow("Coverage Analysis", [simpleExtension])
  .simple("Initial message")
  .step("Get coverage", ({ context }) => {
    return {
      ...context,
      coverage: { files: ["file1.ts", "file2.ts"] }
    };
  })
  .step("Find lowest coverage", ({ context }) => {
    return {
      ...context,
      lowestCoverageFile: { path: context.coverage.files[0] }
    };
  })
  .step("For hovering over context", ({ context }) => {
    return {
      ...context,
      hovered: !!context.lowestCoverageFile
    };
  });

// Example of running a workflow and handling events
await (async () => {
  console.log(myWorkflow.workflowTitle)
  console.log('--------------------------------')
  for await (const event of myWorkflow.run()) {
    if (event.type === 'workflow:update') {
      console.log(event.completedStep?.title)
    }
  }
  console.log('\n\n')
})();

// Example using multiple extensions with WorkflowConfig
const multiExtensionWorkflow = createWorkflow(
  {
    title: "Math Operations",
    description: "A workflow that performs math operations and async tasks"
  },
  [mathExtension, anotherExtension]
)
  .math.add(5, 3)
  .another()
  .step("Final step", ({ context }) => context);

// Run the multi-extension workflow
await (async () => {
  console.log(multiExtensionWorkflow.workflowTitle)
  console.log('--------------------------------')
  for await (const event of multiExtensionWorkflow.run()) {
    if (event.type === 'workflow:update') {
      console.log('Multi-extension event:', event.completedStep?.title);
    }
  }
  console.log('\n\n')
})();


// Example with workflow options - not yet supported in new DSL
const optionsExample = {
  features: ['speed', 'maneuver'],
}

const optionsWorkflow = createWorkflow<{ features: string[] }>("options test")
  .step("Check features", ({ context, options }) => {
    return {
      ...context,
      hasSpeed: options.features.includes('speed'),
      hasManeuver: options.features.includes('maneuver')
    };
  })
  .step("Process features", ({ context }) => {
    return {
      ...context,
      processed: true
    };
  });


/*
// Example using the files extension - not yet supported in new DSL
const fileWorkflow = createWorkflow<{}, FileExtension>("file example", [fileExtension, loggerExtension])
  .files.read("input.txt")
  .step("Process file content", (context) => {
    return {
      ...context,
      processedContent: context.content.toUpperCase()
    };
  })
  .files.write("output.txt")
  .logger.info("File processing complete");
*/

// Example builder with multiple steps and extensions using WorkflowConfig
const myBuilder = createWorkflow(
  {
    title: "Complex Builder Example",
    description: "A complex workflow demonstrating multiple extensions and steps"
  },
  [simpleExtension, anotherExtension, mathExtension]
)
  .simple('message')
  .math.add(1, 2)
  .math.multiply(3, 4)
  .another()
  .step('Add coolness', async ({ context }) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    })
    return {
      cool: 'ness', ...context
    }
  })
  .step('Identity', ({ context }) => ({ bad: 'news', ...context }))
  .step('final step', ({ context }) => context)
  .simple('maybe not')
  .step('final final step v3', ({ context }) => context);

async function executeWorkflow() {
  console.log(myBuilder.workflowTitle)
  console.log('--------------------------------')
  for await (const event of myBuilder.run()) {
    if (event.type === 'workflow:update') {
      console.log('Event:', event.completedStep?.title);
    }
  }
  console.log('\n\n')
}

await executeWorkflow();

// Type testing
type AssertEquals<T, U> =
  0 extends (1 & T) ? false : // fails if T is any
  0 extends (1 & U) ? false : // fails if U is any
  [T] extends [U] ? [U] extends [T] ? true : false : false;

// Expected final context type
type ExpectedFinalContext = {
  message: string;
  cool: string;
  bad: string;
  another: string;
  result: number;
};

// Type test - extract the raw context type from the final builder state
type ExtractContextType<T> = T extends Workflow<infer Context, infer _Options, infer _Extension> ? Context : never;

type TestFinalContext = ExtractContextType<typeof myBuilder>;

// This will show a type error if the types don't match
type TestResult = AssertEquals<TestFinalContext, ExpectedFinalContext>;

// If you want to be even more explicit, you can add a const assertion
const _typeTest: TestResult = true;
