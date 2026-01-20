# UI Step Guide

This guide explains how to use the `.ui()` method to generate dynamic user interfaces in your Positronic brains.

## Overview

The UI step allows brains to generate React-based user interfaces dynamically using AI. When a brain reaches a UI step, it uses the provided components and prompt to generate a form or page that can collect user input.

## Basic Usage

```typescript
import { brain } from '../brain.js';
import { z } from 'zod';

const formBrain = brain('Contact Form')
  .step('Initialize', ({ state }) => ({
    ...state,
    userName: 'John Doe',
    userEmail: 'john@example.com',
  }))
  .ui('Collect Feedback', {
    template: (state) => `
      Create a feedback form for ${state.userName}.
      Pre-fill the email field with ${state.userEmail}.
      Include fields for rating (1-5) and comments.
    `,
    responseSchema: z.object({
      rating: z.number().min(1).max(5),
      comments: z.string(),
    }),
  })
  .step('Process Feedback', ({ state, page }) => ({
    ...state,
    feedbackReceived: true,
    rating: page.rating,
    comments: page.comments,
  }));
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
- **`config.template`**: A function that generates the prompt for the AI to create the UI. Receives the current state and resources.
- **`config.responseSchema`**: (Optional) A Zod schema defining the expected form submission data. When provided, the generated form will be validated to ensure it can collect all required fields.

## How It Works

1. **Template Execution**: When the brain reaches a UI step, it calls the template function with the current state and resources to generate a prompt.

2. **UI Generation**: The AI uses the prompt and available components to generate a component tree (placements) that creates the desired interface.

3. **Validation**: If a `responseSchema` is provided, the system validates that the generated form can collect all required fields.

4. **Page Rendering**: The placements are rendered into a complete HTML page with React, Tailwind CSS, and the component library.

5. **User Interaction**: The user fills out the form and submits it.

6. **Data Flow**: The submitted data is available in the next step via the `page` parameter, typed according to the `responseSchema`.

## Complete Example

Here's a full example showing how to create a support ticket form and process the submitted data:

```typescript
import { brain } from '../brain.js';
import { z } from 'zod';

// Define the schema for form data
const ticketSchema = z.object({
  subject: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  description: z.string(),
  contactEmail: z.string().email(),
});

const supportTicketBrain = brain('Support Ticket')
  // Step 1: Initialize with any data needed for the form
  .step('Initialize', ({ state }) => ({
    ...state,
    ticketId: `TICKET-${Date.now()}`,
    userEmail: 'user@example.com', // Could come from auth
  }))

  // Step 2: Generate and display the form
  .ui('Create Ticket Form', {
    template: (state) => `
      Create a support ticket form with:
      - A heading "Submit Support Ticket"
      - Subject line input (required)
      - Priority dropdown with options: low, medium, high (default to medium)
      - Description textarea for the issue details (required)
      - Contact email input, pre-filled with "${state.userEmail}"
      - A submit button labeled "Create Ticket"

      Use a clean card layout with proper spacing.
    `,
    responseSchema: ticketSchema,
  })

  // Step 3: Process the form submission
  // The `page` parameter contains the typed form data
  .step('Process Ticket', ({ state, page }) => {
    // `page` is fully typed based on ticketSchema:
    // - page.subject: string
    // - page.priority: 'low' | 'medium' | 'high'
    // - page.description: string
    // - page.contactEmail: string

    return {
      ...state,
      ticket: {
        id: state.ticketId,
        subject: page.subject,
        priority: page.priority,
        description: page.description,
        contactEmail: page.contactEmail,
        createdAt: new Date().toISOString(),
        status: 'open',
      },
    };
  })

  // Step 4: Send confirmation (example with services)
  .step('Send Confirmation', async ({ state, email }) => {
    // Use the processed ticket data
    await email.send({
      to: state.ticket.contactEmail,
      subject: `Ticket ${state.ticket.id}: ${state.ticket.subject}`,
      body: `Your support ticket has been created. We'll respond within 24 hours.`,
    });

    return {
      ...state,
      confirmationSent: true,
    };
  });

export default supportTicketBrain;
```

### Key Points About Form Data Flow

1. **The `page` parameter**: After a UI step, the next step receives the form submission data through the `page` parameter in its action function.

2. **Type inference**: When you provide a `responseSchema`, TypeScript automatically infers the type of `page`. In the example above, `page.priority` is typed as `'low' | 'medium' | 'high'`, not just `string`.

3. **The `page` parameter is only available in the step immediately following a UI step**. If you need the form data in later steps, save it to state:

```typescript
// Save form data to state so it's available in all subsequent steps
.step('Process Ticket', ({ state, page }) => ({
  ...state,
  formData: page,  // Now available as state.formData in all later steps
}))
```

4. **Without a responseSchema**: If you don't provide a `responseSchema`, the `page` parameter will be typed as `Record<string, unknown>` and you'll need to handle the types yourself.

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

    Use a clean, single-column layout.
  `,
  responseSchema: z.object({
    name: z.string(),
    email: z.string().email(),
    bio: z.string().optional(),
  }),
})
```

### Use Data Bindings

The template can reference state values that will be resolved at render time:

```typescript
.ui('Order Review', {
  template: (state) => `
    Create an order review form showing:
    - Order items from the cart (use {{cart.items}} for the list)
    - Total price: {{cart.total}}
    - Shipping address input
    - Confirm order button
  `,
  responseSchema: z.object({
    shippingAddress: z.string(),
    confirmed: z.boolean(),
  }),
})
```

### Load Resources for Complex Templates

```typescript
.ui('Survey Form', {
  template: async (state, resources) => {
    const surveyTemplate = await resources.prompts.surveyTemplate.loadText();
    return surveyTemplate
      .replace('{{questions}}', JSON.stringify(state.questions))
      .replace('{{userName}}', state.userName);
  },
  responseSchema: z.object({
    answers: z.array(z.string()),
  }),
})
```

## Response Schema

The `responseSchema` defines what data the form should collect. This serves two purposes:

1. **Validation**: The AI-generated form is validated to ensure it has inputs for all required fields
2. **Type Safety**: The `page` parameter in the next step is typed according to the schema

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

// Form with complex types
const surveySchema = z.object({
  rating: z.number().min(1).max(5),
  wouldRecommend: z.boolean(),
  feedback: z.string(),
});
```

## Available Components

The UI step uses a pre-built component library that includes:

- **Form**: Container for form elements with submission handling
- **Input**: Text input field with label
- **TextArea**: Multi-line text input
- **Checkbox**: Boolean checkbox input
- **Select**: Dropdown selection
- **Button**: Action buttons (submit, etc.)
- **Text**: Static text display
- **Heading**: Section headers
- **Card**: Container for grouping related content
- **List**: Display lists of items with data binding support

All components use Tailwind CSS for styling and are designed to work together seamlessly.

## Data Binding Syntax

Props can use the `{{path}}` syntax to bind to runtime data:

- `{{user.name}}` - Access nested properties
- `{{items}}` - Bind to arrays (useful with List component)
- `{{count}}` - Bind to primitive values

Data bindings are resolved at render time when the page is displayed to the user.

## Generated Page Structure

The generated HTML page includes:

- React 18 and ReactDOM from CDN
- Tailwind CSS from CDN
- Pre-bundled component library
- Bootstrap runtime that resolves data bindings and renders the component tree

The page is self-contained and can be served directly to users.

## Example: Multi-Step Workflow

```typescript
const onboardingBrain = brain('User Onboarding')
  .step('Start', () => ({
    step: 'personal',
    userData: {},
  }))
  .ui('Personal Info', {
    template: () => `
      Create a personal information form with:
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
  .step('Save Personal', ({ state, page }) => ({
    ...state,
    step: 'preferences',
    userData: {
      ...state.userData,
      ...page,
    },
  }))
  .ui('Preferences', {
    template: (state) => `
      Create a preferences form for ${state.userData.firstName}:
      - Newsletter subscription (checkbox)
      - Preferred contact method (select: email, phone, sms)
      - Complete signup button
    `,
    responseSchema: z.object({
      newsletter: z.boolean(),
      contactMethod: z.enum(['email', 'phone', 'sms']),
    }),
  })
  .step('Complete', ({ state, page }) => ({
    ...state,
    step: 'complete',
    userData: {
      ...state.userData,
      preferences: page,
    },
    onboardingComplete: true,
  }));
```

## Configuration

To use UI steps, you need to configure the BrainRunner with:

1. **Component Bundle**: The pre-built JavaScript containing the component library
2. **Components**: The component definitions for the AI to use

```typescript
import { BrainRunner } from '@positronic/core';
import * as components from '@positronic/gen-ui-components';
import componentBundle from '@positronic/gen-ui-components/dist/components.js';

const runner = new BrainRunner({
  client: aiClient,
  // ... other config
})
  .withComponents(components)
  .withComponentBundle(componentBundle);

const result = await runner.run(myBrain);
```

## Handling Form Submissions

When a user submits a form generated by a UI step:

1. The form data is validated against the `responseSchema`
2. The brain resumes execution with the form data available via the `page` parameter
3. The next step can access the typed form data

The submission handling is automatic - you just need to process the data in the next step.

## Error Handling

If the AI generates a form that doesn't satisfy the schema requirements:

- Validation errors are reported
- The AI can retry with the validation feedback
- Multiple validation attempts ensure the form meets requirements

## Tips

1. **Be Descriptive**: The more detail in your template, the better the generated UI
2. **Use Schema Validation**: Always provide a `responseSchema` for forms that collect data
3. **Leverage State**: Pre-fill forms with data from previous steps
4. **Keep It Simple**: Start with basic forms and add complexity as needed
5. **Test Incrementally**: Test each UI step independently before combining into complex workflows
