# Plan: Refactor Component Bundle Architecture

## Goal

Simplify how UI components and bundles work:
- Components are just React component definitions
- Bundle is built by the project (not shipped with package)
- Page references bundle via script src (not inlined)
- Brain owns components (not runner)

## Changes

### 1. Move components from Runner to Brain

**brain.ts:**
- Add `.withComponents(components)` method to Brain DSL
- Components stored on brain, passed through to BrainEventStream
- Remove components from BaseRunParams

**brain-runner.ts:**
- Remove `.withComponents()` method
- Remove components/componentBundle from options
- Runner no longer knows about components at all

### 2. Remove componentBundle infrastructure

**brain.ts:**
- Remove `componentBundle` from BaseRunParams
- Remove `componentBundle` field from BrainEventStream
- Remove componentBundle validation in executeUIStep

**ui/types.ts:**
- Remove `BUNDLE_KEY` Symbol
- Remove `ComponentRegistry` type
- Remove `createComponentRegistry()` function
- Remove `getComponentBundle()` function

**core/index.ts:**
- Remove exports for BUNDLE_KEY, createComponentRegistry, getComponentBundle, ComponentRegistry

### 3. Update page generation to use script src

**ui/generate-page-html.ts:**
- Remove `componentBundle` parameter
- Change from inlining bundle to: `<script src="/bundle/components.js"></script>`

**brain.ts (executeUIStep):**
- Remove componentBundle from generatePageHtml call

### 4. Simplify gen-ui-components package

**gen-ui-components/src/index.ts:**
- Remove `createComponentRegistry` usage
- Just export components directly as a plain object
- Remove componentBundle import

**gen-ui-components:**
- Remove `generated-bundle.ts` and generation script
- Remove esbuild config (bundling moves to generated projects)
- Update package.json build scripts

### 5. Update generated project template

**template-new-project:**
- Add `components/index.ts` that re-exports from @positronic/gen-ui-components
- Add esbuild.config.mjs for bundling components
- Add build script to package.json
- Bundle outputs to `dist/components.js` (or wherever dev server expects)

### 6. Dev server builds and serves bundle

**cli (dev server):**
- On startup, build bundle from `components/index.ts` using esbuild
- Watch `components/` directory for changes, rebuild on change
- Serve bundle at `/bundle/components.js`

### 7. Update tests

- Remove tests that depend on componentBundle being passed
- Update generate-page-html tests (no componentBundle param)
- Brain tests need to use .withComponents() on brain

## Migration for existing code

- Any code using `runner.withComponents()` changes to `brain.withComponents()`
- Any code importing componentBundle or createComponentRegistry needs updating
- Backends need to serve `/bundle/components.js`

## Open questions

- Spec test for bundle endpoint - just verify it returns JS?
- How does cloudflare backend build/serve the bundle? (future problem)

## Order of implementation

1. Add `.withComponents()` to Brain, wire through to BrainEventStream
2. Update generatePageHtml to use script src
3. Remove componentBundle from brain/runner/params
4. Remove Symbol infrastructure from ui/types.ts
5. Simplify gen-ui-components package
6. Update generated project template with esbuild
7. Add bundle building/serving to dev server
8. Update tests throughout
