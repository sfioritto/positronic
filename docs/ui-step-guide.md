# UI Step Guide

This guide explains how to use the `.ui()` method to generate dynamic user interfaces in your Positronic brains.

## Overview

The UI step allows brains to generate React-based user interfaces dynamically using AI. When a brain reaches a UI step, it generates a page and provides a `page` object to the next step. The brain author is responsible for:
1. Notifying users about the page (via Slack, email, etc.)
2. Using `waitFor` to pause until the form is submitted
3. Processing the form data in the step after `waitFor`

## Basic Usage

```typescript
import { brain } from '../brain.js';
import { z } from 'zod';

const feedbackBrain = brain('Collect Feedback')
  .step('Initialize', ({ state }) => ({
    ...state,
    userName: 'John Doe',
  }))
  // Generate the form
  .ui('Create Feedback Form', {
    template: (state) => `
      Create a feedback form for ${state.userName}.
      Include fields for rating (1-5) and comments.
    `,
    responseSchema: z.object({
      rating: z.number().min(1).max(5),
      comments: z.string(),
    }),
  })
  // Notify user and wait for submission
  .step('Notify and Wait', async ({ state, page, slack }) => {
    await slack.post('#feedback', `Please fill out: ${page.url}`);
    return {
      state,
      waitFor: [page.webhook],
    };
  })
  // Process the form submission
  .step('Process Feedback', ({ state, response }) => ({
    ...state,
    feedbackReceived: true,
    rating: response.rating,       // typed as number
    comments: response.comments,   // typed as string
  }));
```

## How It Works

1. **UI Generation**: The `.ui()` step calls an AI agent to generate UI components based on your template prompt.

2. **Page Creation**: The components are rendered to an HTML page and stored. A webhook is automatically configured for form submissions.

3. **Page Object**: The next step receives a `page` object with:
   - `url`: Where users can access the form
   - `webhook`: A pre-configured webhook for form submissions

4. **Notification**: You notify users about the page however you want (Slack, email, SMS, etc.).

5. **Waiting**: You use `waitFor: [page.webhook]` to pause the brain until the form is submitted.

6. **Form Data**: After submission, the step following `waitFor` receives the form data via the `response` parameter, typed according to your `responseSchema`.

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

  // Generate the ticket form
  .ui('Create Ticket Form', {
    template: (state) => `
      Create a support ticket form with:
      - A heading "Submit Support Ticket"
      - Subject line input (required)
      - Priority dropdown: low, medium, high (default medium)
      - Description textarea (required)
      - Contact email, pre-filled with "${state.defaultEmail}"
      - Submit button labeled "Create Ticket"
    `,
    responseSchema: ticketSchema,
  })

  // Notify user and wait for form submission
  .step('Send Notification', async ({ state, page, email }) => {
    // Send email with link to the form
    await email.send({
      to: state.defaultEmail,
      subject: 'Action Required: Submit Your Support Ticket',
      body: `Please submit your support ticket here: ${page.url}`,
    });

    return {
      state: { ...state, notificationSent: true },
      waitFor: [page.webhook],
    };
  })

  // Process the submitted form data
  .step('Process Ticket', ({ state, response }) => {
    // response is fully typed based on ticketSchema:
    // - response.subject: string
    // - response.priority: 'low' | 'medium' | 'high'
    // - response.description: string
    // - response.contactEmail: string

    return {
      ...state,
      ticket: {
        id: state.ticketId,
        subject: response.subject,
        priority: response.priority,
        description: response.description,
        contactEmail: response.contactEmail,
        createdAt: new Date().toISOString(),
        status: 'open',
      },
    };
  })

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
.ui(title: string, config: {
  template: (state: TState, resources: Resources) => string | Promise<string>;
  responseSchema?: z.ZodObject<any>;
})
```

### Parameters

- **`title`**: A descriptive name for this UI step (shown in logs and events)
- **`config.template`**: A function that generates the prompt for the AI to create the UI
- **`config.responseSchema`**: A Zod schema defining the expected form submission data

### The `page` Object

After a `.ui()` step, the next step receives a `page` parameter:

```typescript
interface GeneratedPage<TSchema> {
  url: string;                        // URL to the generated page
  webhook: WebhookRegistration<TSchema>;  // Pre-configured form webhook
}
```

## Template Best Practices

### Be Specific About Layout

```typescript
.ui('User Profile Form', {
  template: (state) => `
    Create a user profile form with:
    - A header showing "Edit Profile"
    - Name field (required)
    - Email field (required, pre-filled with "${state.email}")
    - Bio textarea (optional)
    - A submit button labeled "Save Profile"

    Use a clean, single-column layout with proper spacing.
  `,
  responseSchema: z.object({
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
  template: (state) => `
    Create an order review form showing:
    - List of items from {{cart.items}}
    - Total price: {{cart.total}}
    - Shipping address input
    - Confirm order button
  `,
  responseSchema: z.object({
    shippingAddress: z.string(),
  }),
})
```

### Load Resources for Complex Templates

```typescript
.ui('Survey Form', {
  template: async (state, resources) => {
    const surveyTemplate = await resources.prompts.surveyTemplate.loadText();
    return surveyTemplate
      .replace('{{userName}}', state.userName)
      .replace('{{questions}}', JSON.stringify(state.questions));
  },
  responseSchema: z.object({
    answers: z.array(z.string()),
  }),
})
```

## Response Schema

The `responseSchema` defines what data the form collects. This provides:

1. **Validation**: The AI-generated form is validated to ensure it has inputs for all required fields
2. **Type Safety**: The `response` parameter is typed according to the schema

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
    responseSchema: z.object({
      firstName: z.string(),
      lastName: z.string(),
      dateOfBirth: z.string(),
    }),
  })
  .step('Wait for Personal Info', async ({ state, page, notify }) => {
    await notify(`Complete step 1: ${page.url}`);
    return { state, waitFor: [page.webhook] };
  })
  .step('Save Personal Info', ({ state, response }) => ({
    ...state,
    step: 2,
    userData: { ...state.userData, ...response },
  }))

  // Step 2: Preferences
  .ui('Preferences Form', {
    template: (state) => `
      Create a preferences form for ${state.userData.firstName}:
      - Newsletter subscription (checkbox)
      - Contact method (select: email, phone, sms)
      - Complete button
    `,
    responseSchema: z.object({
      newsletter: z.boolean(),
      contactMethod: z.enum(['email', 'phone', 'sms']),
    }),
  })
  .step('Wait for Preferences', async ({ state, page, notify }) => {
    await notify(`Complete step 2: ${page.url}`);
    return { state, waitFor: [page.webhook] };
  })
  .step('Complete Onboarding', ({ state, response }) => ({
    ...state,
    step: 'complete',
    userData: { ...state.userData, preferences: response },
    onboardingComplete: true,
  }));
```

## Available Components

The UI step uses a pre-built component library:

- **Form**: Container for form elements with submission handling
- **Input**: Text input field with label
- **TextArea**: Multi-line text input
- **Checkbox**: Boolean checkbox input
- **Select**: Dropdown selection
- **Button**: Action buttons
- **Text**: Static text display
- **Heading**: Section headers
- **Card**: Container for grouping content
- **List**: Display lists with data binding support

All components use Tailwind CSS for styling.

## Data Binding Syntax

Props can use `{{path}}` syntax to bind to runtime data:

- `{{user.name}}` - Access nested properties
- `{{items}}` - Bind to arrays (for List component)
- `{{count}}` - Bind to primitive values

Data bindings are resolved when the page is rendered.

## Key Concepts

### The `page` Parameter

- Available only in the step immediately following a `.ui()` step
- Contains `url` and `webhook`
- Use `page.url` to notify users
- Use `page.webhook` with `waitFor` to pause for submission

### The `response` Parameter

- Available in the step following a `waitFor`
- Contains the submitted form data
- Typed according to `responseSchema`

### Separation of Concerns

The `.ui()` step only generates the page. You control:
- **How** users are notified (Slack, email, SMS, push notification, etc.)
- **When** to pause for submission (`waitFor`)
- **What** to do with the form data

This gives you flexibility to integrate with any notification system your brain uses.

## Tips

1. **Be Descriptive**: The more detail in your template, the better the generated UI
2. **Always Provide Schema**: The `responseSchema` ensures type safety and validation
3. **Handle Notifications**: Choose the right channel for your users
4. **Test Incrementally**: Test each UI step independently before combining
5. **Use Meaningful Titles**: Step titles appear in logs and help with debugging
