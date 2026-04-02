import { getSandbox, type Sandbox as SandboxDO } from '@cloudflare/sandbox';
import { createSurfaceSandbox } from '../../src/sandbox/index.js';
import { screenshot } from '../../src/screenshot.js';
import { generate } from '../../src/generate.js';
import { VercelClient } from '@positronic/client-vercel';
import { google } from '@ai-sdk/google';
import systemPromptRaw from '../../src/system-prompt.md';

export { Sandbox } from '@cloudflare/sandbox';

type Env = {
  SANDBOX: DurableObjectNamespace<SandboxDO>;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
};

export default {
  async fetch(request: Request, rawEnv: Env): Promise<Response> {
    const url = new URL(request.url);
    const rawSandbox = getSandbox(rawEnv.SANDBOX, 'test-sandbox');
    const sandbox = createSurfaceSandbox(rawSandbox);

    // Basic sandbox connectivity test
    if (url.pathname === '/sandbox/hello') {
      await rawSandbox.writeFile('/workspace/hello.txt', 'Hello from sandbox!');
      const file = await rawSandbox.readFile('/workspace/hello.txt');
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

      const result = await sandbox.typeCheck(source, dataShape);
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

      const result = await sandbox.typeCheck(source, dataShape);
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

      const result = await sandbox.typeCheck(source, dataShape);
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
      await sandbox.typeCheck(source, dataShape);

      // Then bundle
      const result = await sandbox.bundle();
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

      await sandbox.typeCheck(source, dataShape, formSchemaSource);
      await sandbox.bundle();
      const result = await sandbox.validateForm(formSchemaSource);
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

      await sandbox.typeCheck(source, dataShape, formSchemaSource);
      await sandbox.bundle();
      const result = await sandbox.validateForm(formSchemaSource);
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
      const tcResult = await sandbox.typeCheck(source, dataShape);
      if (!tcResult.success) return Response.json(tcResult);

      // Build self-contained HTML
      const htmlResult = await sandbox.buildHtml({
        name: 'Test Dashboard',
        count: 42,
      });
      if (!htmlResult.success) return Response.json(htmlResult);

      // If CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are available, screenshot
      if (rawEnv.CLOUDFLARE_ACCOUNT_ID && rawEnv.CLOUDFLARE_API_TOKEN) {
        const png = await screenshot({
          html: htmlResult.html!,
          accountId: rawEnv.CLOUDFLARE_ACCOUNT_ID,
          apiToken: rawEnv.CLOUDFLARE_API_TOKEN,
        });
        return new Response(png, {
          headers: { 'Content-Type': 'image/png' },
        });
      }

      // No browser rendering credentials — just return the HTML
      return new Response(htmlResult.html, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Full generation loop with LLM
    if (url.pathname === '/sandbox/generate') {
      if (
        !rawEnv.GOOGLE_GENERATIVE_AI_API_KEY ||
        !rawEnv.CLOUDFLARE_ACCOUNT_ID ||
        !rawEnv.CLOUDFLARE_API_TOKEN
      ) {
        return Response.json(
          {
            error:
              'Missing GOOGLE_GENERATIVE_AI_API_KEY, CLOUDFLARE_ACCOUNT_ID, or CLOUDFLARE_API_TOKEN in .dev.vars',
          },
          { status: 500 }
        );
      }

      const model = google('gemini-2.5-flash', {
        apiKey: rawEnv.GOOGLE_GENERATIVE_AI_API_KEY,
      });
      const client = new VercelClient(
        model,
        rawEnv.GOOGLE_GENERATIVE_AI_API_KEY
      );

      const inputSchema = `export interface Data {
  title: string;
  metrics: {
    totalUsers: number;
    activeUsers: number;
    revenue: number;
  };
  recentUsers: Array<{
    name: string;
    email: string;
    status: 'active' | 'inactive';
  }>;
}`;

      const systemPrompt = systemPromptRaw.replaceAll(
        '__IMPORT_PATH__',
        '@surface/components'
      );

      const result = await generate({
        client,
        sandbox,
        systemPrompt,
        accountId: rawEnv.CLOUDFLARE_ACCOUNT_ID,
        apiToken: rawEnv.CLOUDFLARE_API_TOKEN,
        prompt:
          'Create a dashboard page showing key metrics at the top in cards, and a table of recent users below.',
        inputSchema,
        debug: true,
      });

      // Return JSON with the full log and HTML
      const screenshotBase64 = result.screenshots?.map((png) =>
        btoa(String.fromCharCode(...png))
      );

      return Response.json({
        success: true,
        html: result.html,
        htmlSize: result.html.length,
        screenshots: screenshotBase64,
        log: result.log
          ? {
              userPrompt: result.log.userPrompt,
              systemPromptLength: result.log.systemPrompt.length,
              fakeData: result.log.fakeData,
              toolCalls: result.log.toolCalls,
              totalDurationMs: result.log.totalDurationMs,
            }
          : undefined,
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
        '  /sandbox/preview - build HTML and screenshot\n' +
        '  /sandbox/generate - full LLM generation loop\n'
    );
  },
};
