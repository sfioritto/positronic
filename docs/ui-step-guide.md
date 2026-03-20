# UI Step Guide

This guide explains how to use the `.ui()` method to generate dynamic user interfaces in your Positronic brains.

## Overview

The UI step allows brains to generate React-based user interfaces dynamically using AI. When `.ui()` is called with an `outputSchema`, the brain generates a page, runs an optional `notify` callback (for side effects like Slack messages), then auto-suspends until the form is submitted. The form response is spread directly onto state.

## Basic Usage

```typescript
import { brain } from '../brain.js';
import { z } from 'zod';

const feedbackBrain = brain('Collect Feedback')
  .step('Initialize', ({ state }) => ({
    ...state,
    userName: 'John Doe',
  }))
  // Generate the form, notify, auto-suspend, auto-merge response
  .ui('Create Feedback Form', {
    template: ({ state }) => `
      Create a feedback form for ${state.userName}.
      Include fields for rating (1-5) and comments.
    `,
    outputSchema: z.object({
      rating: z.number().min(1).max(5),
      comments: z.string(),
    }),
    notify: async ({ page, slack }) => {
      await slack.post('#feedback', `Please fill out: ${page.url}`);
    },
  })
  // No .handle() needed — form data is spread directly onto state
  .step('Process Feedback', ({ state }) => ({
    ...state,
    feedbackReceived: true,
    // state.rating and state.comments are typed
  }));
```

## How It Works

1. **UI Generation**: The `.ui()` step calls an AI agent to generate UI components based on your prompt.

2. **Page Creation**: The components are rendered to an HTML page and stored. A webhook is automatically configured for form submissions. A CSRF token is generated and embedded as a hidden form field to protect against unauthorized submissions.

3. **Notify**: The optional `notify` callback runs with a `page` object containing `url` and `webhook`. Use it to notify users however you want (Slack, email, SMS, etc.).

4. **Auto-Suspend**: When `outputSchema` is provided, the brain automatically suspends and waits for the form to be submitted.

5. **Auto-Merge**: The form data is automatically spread directly onto state.

## Complete Example

Here's a full example showing a support ticket workflow:

```typescript
import { brain } from '../brain.js';
import { z } from 'zod';

const ticketSchema = z.object({
  subject: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  description: z.string(),
  contactEmail: z.string().email(),
});

const supportTicketBrain = brain('Support Ticket')
  .step('Initialize', ({ state }) => ({
    ...state,
    ticketId: `TICKET-${Date.now()}`,
    defaultEmail: 'user@example.com',
  }))

  // Generate the ticket form, notify, auto-suspend, auto-merge
  .ui('Create Ticket Form', {
    template: ({ state }) => `
      Create a support ticket form with:
      - A heading "Submit Support Ticket"
      - Subject line input (required)
      - Priority dropdown: low, medium, high (default medium)
      - Description textarea (required)
      - Contact email, pre-filled with "${state.defaultEmail}"
      - Submit button labeled "Create Ticket"
    `,
    outputSchema: ticketSchema,
    notify: async ({ page, state, email }) => {
      await email.send({
        to: state.defaultEmail,
        subject: 'Action Required: Submit Your Support Ticket',
        body: `Please submit your support ticket here: ${page.url}`,
      });
    },
  })

  // Form data is spread directly onto state
  .step('Process Ticket', ({ state }) => ({
    ...state,
    notificationSent: true,
    ticket: {
      id: state.ticketId,
      subject: state.subject,
      priority: state.priority,
      description: state.description,
      contactEmail: state.contactEmail,
      createdAt: new Date().toISOString(),
      status: 'open',
    },
  }))

  // Send confirmation
  .step('Send Confirmation', async ({ state, email }) => {
    await email.send({
      to: state.ticket.contactEmail,
      subject: `Ticket ${state.ticket.id}: ${state.ticket.subject}`,
      body: `Your support ticket has been created. We'll respond within 24 hours.`,
    });

    return { ...state, confirmationSent: true };
  });

export default supportTicketBrain;
```

## The `.ui()` Method

### Signature

```typescript
// With outputSchema — auto-spreads response onto state, returns Brain
.ui(title: string, config: {
  template: (context: { state: TState; options: TOptions; resources: Resources }) => string | Promise<string>;
  outputSchema: z.ZodObject<any>;
  notify?: (context: { page: GeneratedPage } & StepContext & Services) => void | Promise<void>;
}): Brain

// Without outputSchema — returns Brain, continue chaining with .step()
.ui(title: string, config: {
  template: (context: { state: TState; options: TOptions; resources: Resources }) => string | Promise<string>;
  notify?: (context: { page: GeneratedPage } & StepContext & Services) => void | Promise<void>;
}): Brain
```

### Parameters

- **`title`**: A descriptive name for this UI step (shown in logs and events)
- **`config.template`**: A function that generates the prompt for the AI to create the UI
- **`config.outputSchema`**: A Zod schema defining expected form data. When provided, the brain auto-suspends and the response is spread directly onto state.
- **`config.notify`**: Optional callback for side effects (Slack, email, etc.) that need the `page` object

### The `page` Object

The `page` object is available inside the `notify` callback:

```typescript
interface GeneratedPage<TSchema> {
  url: string; // URL to the generated page
  webhook: WebhookRegistration<TSchema>; // Pre-configured form webhook
}
```

## Template Best Practices

### Be Specific About Layout

```typescript
.ui('User Profile Form', {
  template: ({ state }) => `
    Create a user profile form with:
    - A header showing "Edit Profile"
    - Name field (required)
    - Email field (required, pre-filled with "${state.email}")
    - Bio textarea (optional)
    - A submit button labeled "Save Profile"

    Use a clean, single-column layout with proper spacing.
  `,
  outputSchema: z.object({
    name: z.string(),
    email: z.string().email(),
    bio: z.string().optional(),
  }),
})
```

### Use Data Bindings for Display

The template can reference state values that will be resolved at render time using `{{path}}` syntax:

```typescript
.ui('Order Review', {
  template: ({ state }) => `
    Create an order review form showing:
    - List of items from {{cart.items}}
    - Total price: {{cart.total}}
    - Shipping address input
    - Confirm order button
  `,
  outputSchema: z.object({
    shippingAddress: z.string(),
  }),
})
```

### Load Resources for Complex Templates

```typescript
.ui('Survey Form', {
  template: async ({ state, resources }) => {
    const surveyTemplate = await resources.prompts.surveyTemplate.loadText();
    return surveyTemplate
      .replace('{{userName}}', state.userName)
      .replace('{{questions}}', JSON.stringify(state.questions));
  },
  outputSchema: z.object({
    answers: z.array(z.string()),
  }),
})
```

## Output Schema

The `outputSchema` defines what data the form collects. This provides:

1. **Validation**: The AI-generated form is validated to ensure it has inputs for all required fields
2. **Type Safety**: The response is spread directly onto state with full type inference

### Schema Examples

```typescript
// Simple form
const contactSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  message: z.string(),
});

// Form with optional fields
const profileSchema = z.object({
  displayName: z.string(),
  bio: z.string().optional(),
  website: z.string().url().optional(),
});

// Form with enums and numbers
const surveySchema = z.object({
  rating: z.number().min(1).max(5),
  recommend: z.boolean(),
  category: z.enum(['bug', 'feature', 'question']),
  feedback: z.string(),
});
```

## Multi-Step Form Workflows

You can chain multiple UI steps for multi-page forms:

```typescript
brain('User Onboarding')
  .step('Start', () => ({ step: 1, userData: {} }))

  // Step 1: Personal info
  .ui('Personal Info Form', {
    template: () => `
      Create a personal information form:
      - First name (required)
      - Last name (required)
      - Date of birth (required)
      - Next button
    `,
    outputSchema: z.object({
      firstName: z.string(),
      lastName: z.string(),
      dateOfBirth: z.string(),
    }),
    notify: async ({ page, notify }) => {
      await notify(`Complete step 1: ${page.url}`);
    },
  })
  // No .handle() needed — form data is spread directly onto state

  // Step 2: Preferences
  .ui('Preferences Form', {
    template: ({ state }) => `
      Create a preferences form for ${state.firstName}:
      - Newsletter subscription (checkbox)
      - Contact method (select: email, phone, sms)
      - Complete button
    `,
    outputSchema: z.object({
      newsletter: z.boolean(),
      contactMethod: z.enum(['email', 'phone', 'sms']),
    }),
    notify: async ({ page, notify }) => {
      await notify(`Complete step 2: ${page.url}`);
    },
  })
  // No .handle() needed — form data is spread directly onto state
  .step('Complete Onboarding', ({ state }) => ({
    ...state,
    step: 'complete',
    onboardingComplete: true,
  }));
```

## Available Components

The UI step uses a pre-built component library:

- **Form**: Container for form elements with submission handling
- **Input**: Text input field with label
- **TextArea**: Multi-line text input
- **Checkbox**: Boolean checkbox input (supports `value` prop for multi-select scenarios)
- **Select**: Dropdown selection
- **MultiTextInput**: Dynamic list of text inputs where users can add/remove items
- **Button**: Action buttons (required inside Form for submission)
- **Text**: Static text display
- **Heading**: Section headers
- **Container**: Layout container for grouping and organizing content
- **HiddenInput**: Hidden form field for passing IDs or metadata

All components use Tailwind CSS for styling.

## Data Binding Syntax

Props can use `{{path}}` syntax to bind to runtime data:

- `{{user.name}}` - Access nested properties
- `{{items}}` - Bind to arrays (for List component)
- `{{count}}` - Bind to primitive values

Data bindings are resolved when the page is rendered.

## Key Concepts

### The `page` Object

- Available inside the `notify` callback, not as a step parameter
- Contains `url` and `webhook`
- Use `page.url` to notify users where to go

### Auto-Merge Behavior

- When `outputSchema` is provided, form data is spread directly onto state
- The merged data is fully typed based on the schema
- No `.handle()` step is needed
- To namespace results, wrap them in the schema itself (e.g., `z.object({ feedback: z.object({ rating: z.number() }) })`)

### Separation of Concerns

The `.ui()` step generates the page and auto-suspends. You control:

- **How** users are notified (Slack, email, SMS, push notification, etc.) via the `notify` callback
- **What** to do with the auto-merged form data in subsequent steps

This gives you flexibility to integrate with any notification system your brain uses.

## CSRF Protection

Forms generated by `.ui()` steps include automatic CSRF token protection. A unique token is included as a query parameter on the form's action URL and stored alongside the webhook registration. When the form is submitted, the server validates that the submitted token matches the stored token. Submissions with missing or invalid tokens are rejected.

This is handled entirely by the framework — no action is needed from brain authors when using `.ui()` steps.

If you build custom HTML pages with forms — whether they submit to the built-in `ui-form` endpoint or to a custom webhook — you must include a CSRF token manually. The three required pieces are:

1. Generate a token with `generateFormToken()` from `@positronic/core`
2. Include the token as a **query parameter** on the form's action URL (e.g., `action="${webhookUrl}?token=${formToken}"`)
3. Include the token in your webhook registration — either as the second argument to a custom webhook function (e.g., `myWebhook(identifier, token)`) or in the registration object for `ui-form`

See the Brain DSL Guide's "Custom Pages with Forms" section for full examples.

## Tips

1. **Be Descriptive**: The more detail in your prompt, the better the generated UI
2. **Always Provide Schema**: The `outputSchema` ensures type safety and validation
3. **Use `notify`**: Put notification logic in the `notify` callback, not in a separate step
4. **Test Incrementally**: Test each UI step independently before combining
5. **Use Meaningful Titles**: Step titles appear in logs and help with debugging
