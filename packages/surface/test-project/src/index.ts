import { getSandbox, type Sandbox as SandboxDO } from '@cloudflare/sandbox';
import {
  typeCheck,
  typeCheckData,
  bundle,
  validateForm,
  buildBundle,
  makeRender,
  type SandboxInstance,
} from '../../src/sandbox.js';
import { screenshot } from '../../src/screenshot.js';
import { generate, type ProgressEvent } from '../../src/generate.js';
import { VercelClient } from '@positronic/client-vercel';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import systemPromptRaw from '../../src/system-prompt.md';

export { Sandbox } from '@cloudflare/sandbox';

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function streamGenerate(
  generateParams: Parameters<typeof generate>[0]
): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = async (event: Record<string, unknown>) => {
    await writer.write(encoder.encode(JSON.stringify(event) + '\n'));
  };

  let previewData: Record<string, unknown> = {};
  const onProgress = (event: ProgressEvent) => {
    if (event.type === 'fake_data_done') {
      // Mirror the generator's dataset for the final render so the caller
      // sees the same shape the component was designed against.
      previewData = event.data;
    }
    send(event);
  };

  (async () => {
    try {
      const result = await generate({ ...generateParams, onProgress });
      const html = result.render({ data: previewData });
      // result.screenshots is an array of { mobile, tablet, desktop } PNGs,
      // one entry per preview call. Base64-encode each viewport.
      const screenshotBase64 = result.screenshots?.map((shots) => ({
        mobile: uint8ToBase64(shots.mobile),
        tablet: uint8ToBase64(shots.tablet),
        desktop: uint8ToBase64(shots.desktop),
      }));
      await send({
        type: 'complete',
        html,
        htmlSize: html.length,
        screenshots: screenshotBase64,
        log: result.log,
      });
    } catch (err) {
      const payload: Record<string, unknown> = {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      if (err instanceof Error) {
        payload.name = err.name;
        if (err.stack) payload.stack = err.stack;
        if (err.cause !== undefined) {
          payload.cause =
            err.cause instanceof Error
              ? {
                  name: err.cause.name,
                  message: err.cause.message,
                  stack: err.cause.stack,
                }
              : err.cause;
        }
      }
      // Surface diagnostic data attached to fake-data convergence failures
      // so run.sh can save the LLM conversation to disk.
      const errWithExtras = err as {
        responseMessages?: unknown;
        variant?: unknown;
      };
      if (errWithExtras?.responseMessages) {
        payload.responseMessages = errWithExtras.responseMessages;
        payload.variant = errWithExtras.variant;
      }
      await send(payload);
    } finally {
      writer.close();
    }
  })();

  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

type Env = {
  SANDBOX: DurableObjectNamespace<SandboxDO>;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
};

function getGenerateContext(rawEnv: Env) {
  if (
    !rawEnv.GOOGLE_GENERATIVE_AI_API_KEY ||
    !rawEnv.CLOUDFLARE_ACCOUNT_ID ||
    !rawEnv.CLOUDFLARE_API_TOKEN
  ) {
    return null;
  }
  const google = createGoogleGenerativeAI({
    apiKey: rawEnv.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  const generatorModel = google('gemini-flash-lite-latest');
  const reviewerModel = google('gemini-flash-lite-latest');
  const client = new VercelClient(
    generatorModel,
    rawEnv.GOOGLE_GENERATIVE_AI_API_KEY
  );
  const reviewClient = new VercelClient(
    reviewerModel,
    rawEnv.GOOGLE_GENERATIVE_AI_API_KEY
  );
  const systemPrompt = systemPromptRaw.replaceAll(
    '__IMPORT_PATH__',
    '@surface/components'
  );
  return {
    client,
    reviewClient,
    systemPrompt,
    accountId: rawEnv.CLOUDFLARE_ACCOUNT_ID,
    apiToken: rawEnv.CLOUDFLARE_API_TOKEN,
  };
}

export default {
  async fetch(request: Request, rawEnv: Env): Promise<Response> {
    const url = new URL(request.url);
    const sandbox: SandboxInstance = getSandbox(rawEnv.SANDBOX, 'test-sandbox');

    // Basic sandbox connectivity test
    if (url.pathname === '/sandbox/hello') {
      await sandbox.writeFile('/workspace/hello.txt', 'Hello from sandbox!');
      const file = await sandbox.readFile('/workspace/hello.txt');
      return Response.json({ content: file.content });
    }

    // Type-check a valid component
    if (url.pathname === '/sandbox/typecheck/valid') {
      const dataShape = `export interface Data {
  name: string;
  count: number;
}`;

      const source = `import { Card, CardHeader, CardTitle, CardContent } from '@surface/components';
import type { Data } from './types';

interface Props {
  data: Data;
}

export default function Page({ data }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{data.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>Count: {data.count}</p>
      </CardContent>
    </Card>
  );
}`;

      const result = await typeCheck(sandbox, source, dataShape);
      return Response.json(result);
    }

    // Type-check a component with a type error
    if (url.pathname === '/sandbox/typecheck/invalid') {
      const dataShape = `export interface Data {
  name: string;
  count: number;
}`;

      const source = `import { Card, CardHeader, CardTitle, CardContent } from '@surface/components';
import type { Data } from './types';

interface Props {
  data: Data;
}

export default function Page({ data }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{data.nonExistentField}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>Count: {data.count}</p>
      </CardContent>
    </Card>
  );
}`;

      const result = await typeCheck(sandbox, source, dataShape);
      return Response.json(result);
    }

    // Type-check with wrong prop type
    if (url.pathname === '/sandbox/typecheck/wrong-prop') {
      const dataShape = `export interface Data {
  title: string;
}`;

      // Pass a number where Button expects ReactNode children
      const source = `import { Button } from '@surface/components';
import type { Data } from './types';

interface Props {
  data: Data;
}

export default function Page({ data }: Props) {
  return <Button variant="nonexistent">{data.title}</Button>;
}`;

      const result = await typeCheck(sandbox, source, dataShape);
      return Response.json(result);
    }

    // Bundle a component that imports shadcn components
    if (url.pathname === '/sandbox/bundle') {
      const dataShape = `export interface Data {
  name: string;
  count: number;
}`;

      const source = `import { Card, CardHeader, CardTitle, CardContent, Badge } from '@surface/components';
import type { Data } from './types';

interface Props {
  data: Data;
}

export default function Page({ data }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{data.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <Badge>{data.count}</Badge>
      </CardContent>
    </Card>
  );
}`;

      // Write the files first (typeCheck does this)
      await typeCheck(sandbox, source, dataShape);

      // Then bundle
      const result = await bundle(sandbox);
      if (result.success) {
        return Response.json({
          success: true,
          jsLength: result.js?.length,
          // Include first 200 chars to verify it's real JS
          jsPreview: result.js?.substring(0, 200),
        });
      }
      return Response.json(result);
    }

    // Validate a form with all required fields
    if (url.pathname === '/sandbox/form/valid') {
      const dataShape = `export interface Data {}`;

      const formSchemaSource = `import { z } from 'zod';
export const formSchema = z.object({
  name: z.string(),
  email: z.string(),
});`;

      const source = `import React from 'react';
import type { Data } from './types';

interface Props {
  data: Data;
}

export default function Page({ data }: Props) {
  return (
    <form>
      <input name="name" type="text" defaultValue="" />
      <input name="email" type="email" defaultValue="" />
      <button type="submit">Submit</button>
    </form>
  );
}`;

      await typeCheck(sandbox, source, dataShape, formSchemaSource);
      await bundle(sandbox);
      const result = await validateForm(sandbox, formSchemaSource, {
        name: 'Alice Johnson',
        email: 'alice@example.com',
      });
      return Response.json(result);
    }

    // Validate a form missing a required field
    if (url.pathname === '/sandbox/form/missing-field') {
      const dataShape = `export interface Data {}`;

      const formSchemaSource = `import { z } from 'zod';
export const formSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
});`;

      // Missing the phone field
      const source = `import React from 'react';
import type { Data } from './types';

interface Props {
  data: Data;
}

export default function Page({ data }: Props) {
  return (
    <form>
      <input name="name" type="text" defaultValue="" />
      <input name="email" type="email" defaultValue="" />
      <button type="submit">Submit</button>
    </form>
  );
}`;

      await typeCheck(sandbox, source, dataShape, formSchemaSource);
      await bundle(sandbox);
      const result = await validateForm(sandbox, formSchemaSource, {
        name: 'Alice Johnson',
        email: 'alice@example.com',
        phone: '555-0123',
      });
      return Response.json(result);
    }

    // Validate a form using shadcn Checkbox with name attributes (Radix hidden input)
    if (url.pathname === '/sandbox/form/checkbox-array') {
      const dataShape = `export interface Data {
  items: Array<{ id: string; label: string }>;
}`;

      const formSchemaSource = `import { z } from 'zod';
export const formSchema = z.object({
  selectedIds: z.array(z.string()),
});`;

      const source = `import { Checkbox } from '@surface/components';
import type { Data } from './types';

interface Props {
  data: Data;
}

export default function Page({ data }: Props) {
  return (
    <form>
      {data.items.map((item) => (
        <label key={item.id}>
          <Checkbox name="selectedIds" value={item.id} />
          {item.label}
        </label>
      ))}
      <button type="submit">Submit</button>
    </form>
  );
}`;

      await typeCheck(sandbox, source, dataShape, formSchemaSource);
      await bundle(sandbox, 'external-react');
      const result = await validateForm(sandbox, formSchemaSource, {
        items: [
          { id: 'a', label: 'Item A' },
          { id: 'b', label: 'Item B' },
          { id: 'c', label: 'Item C' },
        ],
      });
      return Response.json(result);
    }

    // Build self-contained HTML and screenshot it
    if (url.pathname === '/sandbox/preview') {
      const dataShape = `export interface Data {
  name: string;
  count: number;
}`;

      const source = `import { Card, CardHeader, CardTitle, CardContent, Badge } from '@surface/components';
import type { Data } from './types';

interface Props {
  data: Data;
}

export default function Page({ data }: Props) {
  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <CardTitle>{data.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge>{data.count} items</Badge>
        </CardContent>
      </Card>
    </div>
  );
}`;

      // Type-check
      const tcResult = await typeCheck(sandbox, source, dataShape);
      if (!tcResult.success) return Response.json(tcResult);

      // Build self-contained HTML
      const bundleResult = await buildBundle(sandbox);
      if (!bundleResult.success) return Response.json(bundleResult);

      const html = makeRender(bundleResult.bundle!)({
        data: { name: 'Test Dashboard', count: 42 },
      });

      // If CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are available, screenshot
      if (rawEnv.CLOUDFLARE_ACCOUNT_ID && rawEnv.CLOUDFLARE_API_TOKEN) {
        const jpeg = await screenshot({
          html,
          accountId: rawEnv.CLOUDFLARE_ACCOUNT_ID,
          apiToken: rawEnv.CLOUDFLARE_API_TOKEN,
        });
        return new Response(jpeg, {
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }

      // No browser rendering credentials — just return the HTML
      return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Full generation loop with LLM
    if (url.pathname === '/sandbox/generate') {
      const ctx = getGenerateContext(rawEnv);
      if (!ctx) {
        return Response.json(
          {
            error:
              'Missing GOOGLE_GENERATIVE_AI_API_KEY, CLOUDFLARE_ACCOUNT_ID, or CLOUDFLARE_API_TOKEN in .dev.vars',
          },
          { status: 500 }
        );
      }

      const inputSchema = z.object({
        title: z.string(),
        metrics: z.object({
          totalUsers: z.number(),
          activeUsers: z.number(),
          revenue: z.number(),
        }),
        recentUsers: z
          .array(
            z.object({
              name: z.string(),
              email: z.string(),
              status: z.enum(['active', 'inactive']),
            })
          )
          .meta({ count: 8 }),
      });

      return streamGenerate({
        ...ctx,
        sandbox,
        prompt:
          'Create a dashboard page showing key metrics at the top and a list of recent users below. Pick the layout primitives that fit — you do not have to use cards.',
        inputSchema,
        debug: true,
      });
    }

    // HN Reader test — realistic page with form
    if (url.pathname === '/sandbox/hn-reader') {
      const ctx = getGenerateContext(rawEnv);
      if (!ctx) {
        return Response.json({ error: 'Missing env vars' }, { status: 500 });
      }

      // This mirrors what .page() would pass to generate() for the HN reader brain
      const article = z.object({
        id: z.string(),
        title: z.string(),
        url: z.string(),
        score: z.number(),
        commentCount: z.number(),
      });
      const inputSchema = z.object({
        recommended: z.array(article).meta({ count: 5 }),
        remaining: z.array(article).meta({ count: 20 }),
      });

      const outputSchema = z.object({
        readArticleIds: z
          .array(z.string())
          .describe('Array of article IDs marked as read'),
      });

      const prompt = `Create a reading list page for Hacker News articles.

Show TWO sections:

**Recommended For You** (top section)
- Show the recommended articles with a subtle highlight or accent to distinguish them

**All Articles** (below recommendations)
- Show the remaining articles

For each article show:
- Title as a clickable link to the article URL
- Points count (e.g., "142 points")
- Comment count with link to HN comments (https://news.ycombinator.com/item?id={id})
- A checkbox to mark as "read"

Include a "Mark Selected as Read" submit button at the bottom.
Keep the UI clean and scannable — this is a reading list, not a dashboard.`;

      return streamGenerate({
        ...ctx,
        sandbox,
        prompt,
        inputSchema,
        outputSchema,
        debug: true,
      });
    }

    // Email digest test — complex multi-section page with enrichment tuples
    if (url.pathname === '/sandbox/email-digest') {
      const ctx = getGenerateContext(rawEnv);
      if (!ctx) {
        return Response.json({ error: 'Missing env vars' }, { status: 500 });
      }

      // This mirrors the state shape at the .page() step of the email-digest brain.
      // IterateResult<Thread, T> serializes as [Thread, T][] tuples via toJSON().
      const thread = z.object({
        threadId: z.string(),
        subject: z.string(),
        from: z.string(),
        snippet: z.string(),
        date: z.string(),
        messageCount: z.number(),
      });
      const emailCategory = z.enum([
        'children',
        'amazon',
        'billing',
        'receipts',
        'investments',
        'kickstarter',
        'newsletters',
        'marketing',
        'notifications',
        'npm',
        'securityAlerts',
        'confirmationCodes',
        'reminders',
        'financialNotifications',
        'shipping',
      ]);
      const enriched = <T extends z.ZodType>(schema: T) =>
        z.array(z.object({ thread, value: schema }));
      const inputSchema = z.object({
        emails: z
          .array(z.object({ thread, category: emailCategory }))
          .meta({ count: 12 }),
        childrenEnriched: enriched(
          z.object({ summary: z.string(), actionItem: z.string().nullable() })
        ).meta({ count: 3 }),
        billingEnriched: enriched(
          z.object({
            description: z.string(),
            amount: z.string(),
            dueDate: z.string().nullable(),
          })
        ).meta({ count: 4 }),
        receiptsEnriched: enriched(
          z.object({
            merchant: z.string(),
            amount: z.string(),
            items: z.array(z.string()),
          })
        ).meta({ count: 6 }),
        newslettersEnriched: enriched(
          z.object({ summary: z.string(), keyTopics: z.array(z.string()) })
        ).meta({ count: 5 }),
        financialEnriched: enriched(
          z.object({
            description: z.string(),
            amount: z.string(),
            direction: z.enum(['credit', 'debit']),
          })
        ).meta({ count: 5 }),
        shippingEnriched: enriched(
          z.object({
            carrier: z.string(),
            trackingStatus: z.string(),
            estimatedDelivery: z.string().nullable(),
          })
        ).meta({ count: 3 }),
        npmSummary: z.string(),
        securityAlertsSummary: z.string(),
        confirmationCodesSummary: z.string(),
        remindersSummary: z.string(),
        financialSummary: z.string(),
        shippingSummary: enriched(z.object({ summary: z.string() })).meta({
          count: 2,
        }),
      });

      const outputSchema = z.object({
        threadIds: z
          .array(z.string())
          .describe('Thread IDs the user wants to keep in inbox (not archive)'),
      });

      const prompt = `Create an email digest page that summarizes a user's inbox.

Each *Enriched array (childrenEnriched, billingEnriched, etc.) contains entries shaped as { thread, value } — thread carries the email metadata, value carries the category-specific payload (summary, amount, etc.).

The page should have these sections, each with a colored header/accent:

**Priority: Children** (red accent)
- Show each enriched children email with its summary and action item (if any)
- Action items should be visually prominent (bold, icon, or badge)

**Billing & Receipts** (green accent)
- Two subsections side by side or stacked
- Billing: show description, amount, and due date for each
- Receipts: show merchant, amount, and purchased items

**Newsletters** (indigo accent)
- Show summary and key topics as tags/badges for each newsletter

**Financial Activity** (cyan accent)
- Show each transaction with amount, description, and credit/debit indicator
- Credits should be green, debits red

**Shipping** (orange accent)
- Show carrier, tracking status, and estimated delivery for each package

**Notifications Summary** (purple accent, collapsed/compact)
- Show the text summaries for npm, security alerts, confirmation codes, reminders, and financial notifications
- These are pre-summarized strings, so just display them in a clean readable format

**Thread Management**
- Each email thread across ALL sections should have a checkbox
- The checkbox name should be "threadIds" with the thread's threadId as value
- Checked = keep in inbox, unchecked = archive
- Include a "Archive Unchecked" submit button at the bottom

Make the overall layout clean and scannable. Pick whichever layout primitives fit the content — typography and whitespace, separators, plain containers, or cards where they genuinely help. The page should feel like a morning email briefing — scannable in 30 seconds, not an enterprise dashboard.`;

      return streamGenerate({
        ...ctx,
        sandbox,
        prompt,
        inputSchema,
        outputSchema,
        debug: true,
      });
    }

    // Weekly dev summary — read-only page rendering GitHub PR activity
    // summaries for each developer on the team. Mirrors the state shape at
    // the page-generation step of the `weekly-dev-summary` brain in
    // seans-bots. Uses iterate tuples like email-digest.
    if (url.pathname === '/sandbox/dev-summary') {
      const ctx = getGenerateContext(rawEnv);
      if (!ctx) {
        return Response.json({ error: 'Missing env vars' }, { status: 500 });
      }

      const developerInput = z.object({
        name: z.string(),
        meta: z.object({
          totalPRs: z.number(),
          prsReviewed: z.number(),
          prComments: z.number(),
        }),
      });

      const developerResult = z.object({
        summary: z
          .string()
          .describe('One sentence about what they focused on this period'),
        accomplishments: z
          .array(
            z.object({
              text: z
                .string()
                .describe('Complete sentence explaining what was done and why'),
              relatedPRs: z
                .array(
                  z.object({
                    repo: z.string(),
                    number: z.number(),
                  })
                )
                .meta({ count: 2 }),
            })
          )
          .meta({ count: 3 }),
      });

      const inputSchema = z.object({
        org: z
          .string()
          .describe('GitHub organization slug (used to build PR URLs)'),
        weekStart: z.string().describe('ISO date of period start'),
        weekEnd: z.string().describe('ISO date of period end'),
        periodLabel: z
          .string()
          .describe('Human-readable label, e.g. "last week"'),
        developerSummaries: z
          .array(z.object({ input: developerInput, result: developerResult }))
          .meta({ count: 6 })
          .describe(
            'One entry per developer: { input: stats, result: generated summary }'
          ),
      });

      const prompt = `Create a weekly developer activity summary page for a software team.

The page shows each developer's work across a reporting period. Each entry in developerSummaries is an object { input, result } pairing the developer's stats (input) with the generated summary (result).

**Header**
- Clear title like "Weekly Dev Summary" or "Developer Activity"
- Display the date range prominently (format weekStart and weekEnd as readable dates, e.g. "Oct 14 – Oct 20, 2024")
- Show the periodLabel somewhere for context (e.g. as a subtle subtitle or badge)

**Per-Developer Section** (one section per entry in developerSummaries — skip any where entry.result.summary is an empty string)
Each section should include:
- Developer name (entry.input.name) as a prominent heading
- Three small stat signals from entry.input.meta: totalPRs merged, prsReviewed, prComments — compact and visually grouped (badges, inline metadata, or a small stat row; your call)
- The summary sentence (entry.result.summary), set apart visually — consider italic, muted color, or a quote-style treatment
- An accomplishments list from entry.result.accomplishments — each list item shows the accomplishment text followed by small pill-shaped PR links. Each related PR renders as "#{number}" and links to https://github.com/{org}/{repo}/pull/{number}. If an accomplishment has no relatedPRs, just show the text.

How you visually separate developers from each other is up to you — a Separator with typographic hierarchy, a subtle background alternation, bordered cards if that genuinely fits, or just spacing. Pick what best reads as an editorial digest rather than an enterprise dashboard. Do not reflexively wrap each developer in a bordered Card; a stack of seven identical bordered boxes is usually the wrong choice for this kind of report.

**Empty State**
If developerSummaries is empty OR every entry has an empty entry.result.summary, show a clean empty state that says something like "No developer activity this period." (Pick a component that fits — Empty, a simple centered text block, whatever reads well.)

The overall feel should be that of a scannable internal team digest — think Notion or Linear's weekly summary emails. Quiet, professional, strong typography hierarchy, generous whitespace. This is a read-only report, NOT a dashboard with charts and NOT a marketing page. No buttons, no forms — just content.`;

      return streamGenerate({
        ...ctx,
        sandbox,
        prompt,
        inputSchema,
        debug: true,
      });
    }

    // Company OS overview — deeply nested ERP-style schema stress test.
    // Mirrors the company-os schema from generate-fake-data to exercise
    // four-level array-of-object nesting and wide multi-section layouts.
    if (url.pathname === '/sandbox/company-os') {
      const ctx = getGenerateContext(rawEnv);
      if (!ctx) {
        return Response.json({ error: 'Missing env vars' }, { status: 500 });
      }

      const address = z.object({
        street: z.string(),
        city: z.string(),
        state: z.string(),
        postalCode: z.string(),
        country: z.enum(['US', 'CA', 'UK', 'DE', 'FR', 'JP', 'AU', 'IN']),
      });

      const money = z.object({
        amount: z.number(),
        currency: z.enum(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD']),
      });

      const inputSchema = z.object({
        organization: z.object({
          id: z.string(),
          legalName: z.string(),
          dba: z.string().nullable(),
          foundedYear: z.number(),
          taxId: z.string(),
          website: z.string(),
          supportEmail: z.string(),
          mainPhone: z.string(),
          mission: z.string(),
          vision: z.string(),
          structure: z.enum([
            'llc',
            'c-corp',
            's-corp',
            'partnership',
            'non-profit',
          ]),
          headquarters: address,
          logoUrls: z.object({
            light: z.string(),
            dark: z.string(),
            mono: z.string(),
          }),
        }),

        employees: z
          .array(
            z.object({
              id: z.string(),
              firstName: z.string(),
              lastName: z.string(),
              preferredName: z.string().nullable(),
              email: z.string(),
              phone: z.string().nullable(),
              title: z.string(),
              department: z.enum([
                'engineering',
                'product',
                'design',
                'sales',
                'marketing',
                'finance',
                'operations',
                'people',
              ]),
              managerId: z.string().nullable(),
              startDate: z.string(),
              employmentType: z.enum([
                'full-time',
                'part-time',
                'contract',
                'intern',
              ]),
              status: z.enum([
                'active',
                'on-leave',
                'terminated',
                'pending-start',
              ]),
              compensation: z.object({
                baseSalary: money,
                bonusTargetPercentage: z.number().nullable(),
                equityShares: z.number().nullable(),
                benefits: z.object({
                  healthPlan: z.enum([
                    'basic',
                    'standard',
                    'premium',
                    'opt-out',
                  ]),
                  vacationDays: z.number(),
                  sickDays: z.number(),
                  stockOptionsGranted: z.number(),
                  retirementMatchPercentage: z.number(),
                }),
              }),
              location: z.object({
                office: z.enum(['hq', 'nyc', 'london', 'tokyo', 'remote']),
                remotePercentage: z.number(),
                timezone: z.string(),
                address: address.nullable(),
              }),
              profile: z.object({
                bio: z.string(),
                linkedinUrl: z.string().nullable(),
                githubUrl: z.string().nullable(),
                pronouns: z.string().nullable(),
                languagesSpoken: z.array(z.string()).meta({ count: 3 }),
                hobbies: z.array(z.string()),
              }),
              emergencyContacts: z
                .array(
                  z.object({
                    name: z.string(),
                    relationship: z.enum([
                      'spouse',
                      'parent',
                      'sibling',
                      'child',
                      'friend',
                      'other',
                    ]),
                    phone: z.string(),
                    email: z.string().nullable(),
                    primary: z.boolean(),
                  })
                )
                .meta({ count: 2 }),
              certifications: z
                .array(
                  z.object({
                    name: z.string(),
                    issuingOrg: z.string(),
                    issueDate: z.string(),
                    expirationDate: z.string().nullable(),
                    credentialId: z.string(),
                  })
                )
                .meta({ count: 2 }),
            })
          )
          .meta({ count: 5 }),

        projects: z
          .array(
            z.object({
              id: z.string(),
              code: z.string(),
              name: z.string(),
              description: z.string(),
              status: z.enum([
                'proposed',
                'planning',
                'in-progress',
                'paused',
                'completed',
                'cancelled',
              ]),
              priority: z.enum(['low', 'medium', 'high', 'critical']),
              phase: z.enum([
                'discovery',
                'design',
                'build',
                'launch',
                'maintenance',
              ]),
              startDate: z.string(),
              targetEndDate: z.string(),
              actualEndDate: z.string().nullable(),
              budget: money,
              actualSpend: money,
              confidenceLevel: z.enum(['low', 'medium', 'high']),
              ownerId: z.string(),
              sponsorId: z.string(),
              clientId: z.string().nullable(),
              tags: z.array(z.string()).meta({ count: 4 }),
              milestones: z
                .array(
                  z.object({
                    id: z.string(),
                    name: z.string(),
                    description: z.string(),
                    targetDate: z.string(),
                    actualDate: z.string().nullable(),
                    status: z.enum([
                      'pending',
                      'in-progress',
                      'complete',
                      'missed',
                    ]),
                    deliverables: z.array(z.string()),
                    acceptanceCriteria: z.array(z.string()),
                  })
                )
                .meta({ count: 3 }),
              tasks: z
                .array(
                  z.object({
                    id: z.string(),
                    title: z.string(),
                    description: z.string(),
                    status: z.enum([
                      'backlog',
                      'todo',
                      'in-progress',
                      'in-review',
                      'done',
                      'cancelled',
                    ]),
                    priority: z.enum(['low', 'medium', 'high', 'urgent']),
                    type: z.enum([
                      'feature',
                      'bug',
                      'chore',
                      'spike',
                      'incident',
                    ]),
                    assigneeId: z.string().nullable(),
                    reporterId: z.string(),
                    estimateHours: z.number(),
                    actualHours: z.number().nullable(),
                    createdAt: z.string(),
                    updatedAt: z.string(),
                    completedAt: z.string().nullable(),
                    labels: z.array(z.string()),
                    dependencies: z.array(z.string()),
                    subtasks: z
                      .array(
                        z.object({
                          id: z.string(),
                          title: z.string(),
                          done: z.boolean(),
                          estimateHours: z.number(),
                          actualHours: z.number().nullable(),
                        })
                      )
                      .meta({ count: 2 }),
                    comments: z
                      .array(
                        z.object({
                          id: z.string(),
                          authorId: z.string(),
                          createdAt: z.string(),
                          body: z.string(),
                          edited: z.boolean(),
                        })
                      )
                      .meta({ count: 2 }),
                  })
                )
                .meta({ count: 3 }),
              risks: z
                .array(
                  z.object({
                    id: z.string(),
                    description: z.string(),
                    category: z.enum([
                      'technical',
                      'schedule',
                      'budget',
                      'scope',
                      'resource',
                      'external',
                    ]),
                    probability: z.enum([
                      'unlikely',
                      'possible',
                      'likely',
                      'almost-certain',
                    ]),
                    impact: z.enum([
                      'negligible',
                      'minor',
                      'moderate',
                      'major',
                      'severe',
                    ]),
                    mitigation: z.string(),
                    ownerId: z.string(),
                    dueDate: z.string(),
                  })
                )
                .meta({ count: 2 }),
            })
          )
          .meta({ count: 3 }),

        clients: z
          .array(
            z.object({
              id: z.string(),
              legalName: z.string(),
              tier: z.enum(['platinum', 'gold', 'silver', 'bronze', 'trial']),
              industry: z.string(),
              website: z.string(),
              accountManagerId: z.string(),
              headquarters: address,
              primaryContact: z.object({
                name: z.string(),
                title: z.string(),
                email: z.string(),
                phone: z.string(),
              }),
              secondaryContacts: z
                .array(
                  z.object({
                    name: z.string(),
                    title: z.string(),
                    email: z.string(),
                    phone: z.string().nullable(),
                    department: z.string(),
                  })
                )
                .meta({ count: 2 }),
              contracts: z
                .array(
                  z.object({
                    id: z.string(),
                    type: z.enum(['msa', 'sow', 'nda', 'license', 'retainer']),
                    title: z.string(),
                    startDate: z.string(),
                    endDate: z.string(),
                    totalValue: money,
                    autoRenew: z.boolean(),
                    renewalTerms: z.string().nullable(),
                    keyTerms: z.array(z.string()),
                    paymentSchedule: z
                      .array(
                        z.object({
                          id: z.string(),
                          amount: money,
                          dueDate: z.string(),
                          paidDate: z.string().nullable(),
                          invoiceNumber: z.string(),
                          status: z.enum([
                            'scheduled',
                            'sent',
                            'paid',
                            'overdue',
                            'disputed',
                          ]),
                        })
                      )
                      .meta({ count: 3 }),
                  })
                )
                .meta({ count: 2 }),
            })
          )
          .meta({ count: 3 }),

        meetings: z
          .array(
            z.object({
              id: z.string(),
              title: z.string(),
              scheduledAt: z.string(),
              durationMinutes: z.number(),
              location: z.enum(['in-person', 'video', 'phone', 'hybrid']),
              organizerId: z.string(),
              status: z.enum([
                'scheduled',
                'completed',
                'cancelled',
                'rescheduled',
              ]),
              relatedProjectId: z.string().nullable(),
              agenda: z.array(z.string()),
              attendeeIds: z.array(z.string()).meta({ count: 4 }),
              actionItems: z
                .array(
                  z.object({
                    description: z.string(),
                    ownerId: z.string(),
                    dueDate: z.string().nullable(),
                    status: z.enum(['open', 'in-progress', 'done']),
                  })
                )
                .meta({ count: 3 }),
            })
          )
          .meta({ count: 4 }),

        generatedAt: z.string(),
        reportPeriodStart: z.string(),
        reportPeriodEnd: z.string(),
        totalActiveEmployees: z.number(),
        totalOpenProjects: z.number(),
        totalActiveClients: z.number(),
        quarterlyRevenueUsd: z.number(),
        quarterlyExpensesUsd: z.number(),
      });

      const prompt = `Create a company operations overview page — a quarterly briefing that an executive could scan in a few minutes to understand the state of the business.

**Header**
- Organization name (organization.legalName, with dba as a subtle subtitle if present) and mission
- Report period (format reportPeriodStart and reportPeriodEnd as a readable range)
- Four headline KPIs in a compact row: totalActiveEmployees, totalOpenProjects, totalActiveClients, and quarterly net (quarterlyRevenueUsd − quarterlyExpensesUsd shown with revenue and expenses as context)

**People** (section)
- A roster of employees grouped or sorted by department — show name (preferredName or firstName + lastName), title, department, office location, and status
- Surface on-leave and pending-start statuses visibly (badge or accent) — don't hide them in small text
- Keep each row compact; this is a directory, not a profile page

**Projects** (section — the most detail-rich section)
- One block per project. Show: code + name, status, priority, phase, confidence level, owner, date range, budget vs actual spend (visual treatment showing over/under budget)
- Nested: milestones as a compact list with status indicators, tasks as a compact list with status + assignee, and risks with probability/impact signals
- Give critical priority or high-severity risks visual weight

**Clients** (section)
- One block per client. Show: legal name, tier (visually distinguish platinum/gold/silver/bronze), industry, account manager, primary contact
- Contracts as a compact sub-list per client — type, title, value, date range, autoRenew indicator
- Payment schedule rollup per contract — just totals and count of overdue/disputed payments; don't enumerate every single payment line

**Meetings** (section)
- Upcoming and recent meetings grouped by status
- Show: title, scheduled time, duration, location mode, organizer, related project (if any)
- Action items as a compact sub-list with status + owner

The page is read-only — no forms, no buttons, no checkboxes. Think internal quarterly report: dense enough to be informative, visual enough to scan. Prioritize typographic hierarchy and whitespace over heavy card borders. Don't reflexively wrap every item in a bordered card — a stack of dozens of identical bordered boxes is almost always the wrong choice. Separators, headings, and spacing do most of the work.`;

      return streamGenerate({
        ...ctx,
        sandbox,
        prompt,
        inputSchema,
        debug: true,
      });
    }

    return new Response(
      'Surface sandbox test worker.\n\nEndpoints:\n' +
        '  /sandbox/hello - basic connectivity\n' +
        '  /sandbox/typecheck/valid - valid component\n' +
        '  /sandbox/typecheck/invalid - component with type error\n' +
        '  /sandbox/typecheck/wrong-prop - wrong prop variant\n' +
        '  /sandbox/bundle - bundle a component with shadcn imports\n' +
        '  /sandbox/form/valid - form with all fields\n' +
        '  /sandbox/form/missing-field - form missing a required field\n' +
        '  /sandbox/form/checkbox-array - shadcn Checkbox with name attrs (Radix hidden input test)\n' +
        '  /sandbox/preview - build HTML and screenshot\n' +
        '  /sandbox/generate - full LLM generation loop\n' +
        '  /sandbox/hn-reader - HN reader test (form + 50 articles)\n' +
        '  /sandbox/email-digest - email digest with enrichment tuples\n' +
        '  /sandbox/dev-summary - weekly developer activity summary (read-only)\n' +
        '  /sandbox/company-os - company operations overview (read-only, deeply nested schema)\n'
    );
  },
};
