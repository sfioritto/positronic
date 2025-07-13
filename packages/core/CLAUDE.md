# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

This is the `@positronic/core` package - the core framework for building AI-powered "brains" with stateful workflows. It provides:

- A fluent DSL for defining AI workflows (Brain DSL)
- Event-driven state management using JSON patches
- Resource management system with type-safe access
- Integration with AI clients for structured object generation
- Adapter pattern for extensibility

## Key Commands

### Development

- `npm test` - Run all tests silently
- `npm run build` - Build the package (runs TypeScript compilation then SWC)
- `npm run clean` - Clean build artifacts and dependencies
- `npm run tsc` - Run TypeScript compiler only (generates type declarations)
- `npm run swc` - Run SWC transpilation only

### Testing

Tests use Jest and are located alongside source files and must be run from the monorepo root (`*.test.ts`):

- Run from monorepo root: `npm test -- packages/core`
- Run specific test: `npm test -- brain.test.ts`
- Run with pattern: `npm test -- -t "should create a brain"`

## Core Architecture

### Brain DSL (`src/dsl/brain.ts`)

**Implementation Details:**

- **Block System**: The DSL builds an internal array of `Block` objects (union type of `StepBlock` and `BrainBlock`)
- **Type Chain**: Each method returns `this.nextBrain<TNewState>()` which creates a new Brain instance with updated state type
- **State Type Inference**: Uses TypeScript generics to thread state types through the chain:
  ```typescript
  class Brain<TOptions, TState, TServices> {
    step<TNewState>(...): Brain<TOptions, TNewState, TServices>
  }
  ```
- **Brain Name Uniqueness**: Enforced at runtime via global `brainNames` Set (disabled in tests)
- **Services Pattern**: Services are stored in a private field and passed through the chain via `nextBrain()`
- **Default Options**: Merged with runtime options in the `run()` method
- **Prompt Step**: Special step type that wraps `generateObject` call and merges response into state

### Event System

**Implementation Details:**

- **Event Types**: Defined as const object `BRAIN_EVENTS` in `constants.ts`
- **Event Hierarchy**: Base `BaseEvent` → `BrainBaseEvent` (includes title/description) → specific event types
- **BrainEventStream**: Internal class that manages event generation during execution
- **Step Execution**: Generates events in sequence: STEP_STATUS → STEP_START → (execution) → STEP_COMPLETE → STEP_STATUS
- **Error Handling**: Errors emit ERROR event but execution continues to COMPLETE
- **Nested Brain Events**: Inner brain events are yielded directly, maintaining full event stream

### State Management

**Implementation Details:**

- **JSON Patch Library**: Uses `fast-json-patch` for RFC 6902 operations
- **Patch Creation**: `createPatch()` filters out non-standard operations to ensure compatibility
- **Patch Application**: `applyPatches()` handles both single patches and arrays of patches
- **State Cloning**: Uses `structuredClone()` for deep copying state objects
- **Patch Storage**: Each `Step` object stores its patch after execution
- **State Reconstruction**: BrainRunner applies patches sequentially to rebuild state

### Resources System (`src/resources/`)

**Implementation Details:**

- **Proxy Magic**: Uses ES6 Proxy to create dynamic property access from manifest
- **Path Resolution**: `findResourceByPath()` handles both exact matches and extension-optional lookup
- **Ambiguity Handling**: Throws helpful errors when multiple files match without extension
- **Lazy Loading**: Resources are not loaded until `load()`, `loadText()`, or `loadBinary()` is called
- **Type Checking**: Runtime validation ensures correct method usage (e.g., `loadText()` on binary resources throws)
- **Recursive Proxies**: Nested manifests create nested proxy objects for directory-like access
- **Special Methods**: `loadText(path)` and `loadBinary(path)` are available at every level for direct path access

### Client Integration (`src/clients/types.ts`)

**Implementation Details:**

- **Interface Design**: Single method interface for easy mocking and implementation
- **Parameter Handling**: Implementations should merge `prompt` with `messages` array
- **Schema Usage**: `schemaName` and `schemaDescription` are for client-specific features (e.g., Claude's tool use)
- **Type Safety**: Return type uses `z.infer<T>` for compile-time type inference

### BrainRunner (`src/dsl/brain-runner.ts`)

**Implementation Details:**

- **Immutable Configuration**: Each `with*` method returns a new BrainRunner instance
- **Event Dispatch**: Uses `Promise.all()` to dispatch events to adapters concurrently
- **State Tracking**: Maintains `currentState` and applies patches as steps complete
- **Step Counting**: Tracks step number for `endAfter` early termination
- **Restart Logic**: Applies patches from `initialCompletedSteps` before execution begins
- **Type Parameters**: Properly threads through brain's generic types for type safety
- **Return Value**: Returns final state after all events processed (or early termination)

### Adapter Pattern (`src/adapters/types.ts`)

**Implementation Details:**

- **Simple Interface**: Single `dispatch(event)` method for maximum flexibility
- **Async Support**: Can return `void` or `Promise<void>` for async operations
- **Generic Options**: `Adapter<Options>` allows type-safe event options
- **Event Handling**: Adapters receive ALL events - must filter if only interested in specific types
- **Error Handling**: BrainRunner doesn't catch adapter errors - adapters must handle their own errors

## Testing

See the comprehensive testing guide: @docs/core-testing-guide.md

## Type System Implementation

- **Module System**: Pure ESM with `.js` extensions in imports (even for `.ts` files)
- **Type Exports**: Separate type declarations in `dist/types` via `tsc`
- **Generic Threading**: Brain class uses 3 generic parameters: `<TOptions, TState, TServices>`
- **Type Inference Chain**: Each step method returns `Brain<TOptions, TNewState, TServices>`
- **Zod Integration**: Exported as peer dependency to avoid version conflicts
- **Type Guards**: `isResourceEntry()` for discriminating union types in resources

## Critical Implementation Details

- **Immutable State**: Steps MUST return new objects - mutating state breaks patch generation
- **Brain Name Registry**: Global `brainNames` Set prevents duplicates (disabled via `NODE_ENV=test`)
- **Lazy Resource Loading**: `ResourceLoader.load()` only called when `loadText()`/`loadBinary()` invoked
- **Event Correlation**: All events include `brainRunId` (generated via `uuid.v4()` if not provided)
- **Patch Optimization**: `createPatch()` produces minimal diffs - empty patches for identical states
- **Options Merging**: Runtime options override default options set via `.withOptions()`
- **Services Timing**: `.withServices()` must be called before steps - services stored in private field
- **Step ID Generation**: Each step gets UUID via `Step` constructor for tracking
- **Error Serialization**: Errors converted to `SerializedError` with name/message/stack
- **Clone Strategy**: Uses `structuredClone()` for deep state copies (not JSON parse/stringify)
