# Webhook Implementation To-Do List

## 1. Remove `action` property from webhook responses

**Status**: Pending
**Priority**: TBD

### Description
The `action` property (`'resumed'` | `'queued'`) is currently returned in POST `/webhooks/:slug` responses, but it's primarily used by tests and unclear if developers actually need it.

### Tasks
- [ ] Remove `action` property from webhook POST response
- [ ] Restructure integration tests to not rely on `action`
- [ ] Use webhook response data or brain events to validate flow instead
- [ ] Consider using WEBHOOK events for test validation

### Notes
- **UNCERTAIN**: Not sure if we should actually do this
- Currently only used in tests (`packages/cloudflare/test-project/tests/api.test.ts`)
- No clear developer use case identified
- May be able to achieve same test validation by monitoring brain events

---

## 2. Add webhook integration specs to spec package

**Status**: Pending
**Priority**: High

### Description
Current webhook specs in `packages/spec/src/api.ts` don't validate the full integration flow (pause → webhook → resume). Need comprehensive specs that backends must implement.

### Requirements
- Specs should test with a webhook-enabled brain
- Should verify:
  - Brain starts and emits WEBHOOK event
  - Brain pauses correctly
  - POST to webhook endpoint succeeds
  - Brain resumes with webhook response data
  - Brain completes successfully
- Should be achievable via API calls and event monitoring
- Backends provide a test brain that uses webhooks

### Tasks
- [ ] Design spec API for webhook integration testing
- [ ] Implement spec function in `packages/spec/src/api.ts`
- [ ] Update Cloudflare backend to pass new spec tests
- [ ] Document webhook spec requirements

---

## 3. Rename `restart()` to `resume()` in BrainRunnerDO

**Status**: ✅ Complete
**Priority**: Low

### Description
The method `restart()` in `packages/cloudflare/src/brain-runner-do.ts` should be renamed to `resume()` for clearer semantics. "Restart" implies starting from the beginning, but this method resumes a paused brain from where it left off.

### Tasks
- [x] Rename `BrainRunnerDO.restart()` to `BrainRunnerDO.resume()`
- [x] Update call site in `packages/cloudflare/src/api.ts` (webhook endpoint)
- [x] Update any related comments/documentation
- [x] Remove unnecessary `brainTitle` parameter (extract from stored event instead)
- [x] Simplify webhook endpoint to not fetch brain title from MonitorDO

---

## 4. Reconsider webhook serialization approach

**Status**: Pending
**Priority**: Low

### Description
The current approach to webhook serialization in `packages/core/src/dsl/brain.ts` feels off - code smell detected:

```typescript
// In packages/core/src/dsl/brain.ts
const serializedWaitFor: SerializedWebhookRegistration[] = result.waitFor.map(
  (registration: WebhookRegistration) => ({
    slug: registration.slug,
    identifier: registration.identifier,
  })
);
```

The brain's `executeStep()` method manually strips out Zod schemas from webhook registrations. This approach needs some thought - something probably isn't quite right about having the brain do this serialization manually.

### Initial Thought
One possibility: webhooks could have a `serialize()` method so they know how to serialize themselves. But this is just one idea - there might be better approaches.

### Questions to Consider
- Should serialization be a method on the webhook/registration object?
- Should the webhook function return both full and serialized forms?
- Is there a cleaner architectural pattern that avoids this manual mapping?
- Does this add unnecessary complexity, or is the current approach actually fine?
- Is the real issue that we're mixing concerns (brain execution + serialization)?

---

## 5. Change singleton Durable Object IDs from "singleton" to descriptive names

**Status**: Pending
**Priority**: Low

### Description
Singleton Durable Objects currently use `idFromName('singleton')`, but should use descriptive IDs like `'monitor'` or `'schedule'` instead.

### Changes Needed

#### MonitorDO
- [ ] Change `MONITOR_DO.idFromName('singleton')` → `MONITOR_DO.idFromName('monitor')`
- Files to update:
  - `packages/cloudflare/src/brain-runner-do.ts` (lines 230, 350)
  - `packages/cloudflare/src/api.ts` (multiple locations)
  - Any other references

#### ScheduleDO
- [ ] Change `SCHEDULE_DO.idFromName('singleton')` → `SCHEDULE_DO.idFromName('schedule')`
- Files to update:
  - `packages/cloudflare/src/brain-runner-do.ts` (lines 235, 355)
  - `packages/cloudflare/src/api.ts` (multiple locations)
  - Any other references

#### Other Singletons
- [ ] Identify any other singleton Durable Objects
- [ ] Apply same pattern (descriptive ID instead of "singleton")

### Notes
- This is primarily for code clarity and consistency
- No functional change, just better naming
