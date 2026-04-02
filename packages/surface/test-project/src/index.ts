import { getSandbox, type Sandbox as SandboxDO } from '@cloudflare/sandbox';
import { createSurfaceSandbox } from '../../src/sandbox/index.js';

export { Sandbox } from '@cloudflare/sandbox';

type Env = {
  SANDBOX: DurableObjectNamespace<SandboxDO>;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const rawSandbox = getSandbox(env.SANDBOX, 'test-sandbox');
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

    return new Response(
      'Surface sandbox test worker.\n\nEndpoints:\n' +
        '  /sandbox/hello - basic connectivity\n' +
        '  /sandbox/typecheck/valid - valid component\n' +
        '  /sandbox/typecheck/invalid - component with type error\n' +
        '  /sandbox/typecheck/wrong-prop - wrong prop variant\n' +
        '  /sandbox/bundle - bundle a component with shadcn imports\n' +
        '  /sandbox/form/valid - form with all fields\n' +
        '  /sandbox/form/missing-field - form missing a required field\n'
    );
  },
};
