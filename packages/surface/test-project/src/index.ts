import { getSandbox, type Sandbox as SandboxDO } from '@cloudflare/sandbox';
import { typeCheck } from '../../src/sandbox/type-check.js';
import { bundle } from '../../src/sandbox/bundle.js';

export { Sandbox } from '@cloudflare/sandbox';

type Env = {
  SANDBOX: DurableObjectNamespace<SandboxDO>;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const sandbox = getSandbox(env.SANDBOX, 'test-sandbox');

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

    return new Response(
      'Surface sandbox test worker.\n\nEndpoints:\n' +
        '  /sandbox/hello - basic connectivity\n' +
        '  /sandbox/typecheck/valid - valid component\n' +
        '  /sandbox/typecheck/invalid - component with type error\n' +
        '  /sandbox/typecheck/wrong-prop - wrong prop variant\n' +
        '  /sandbox/bundle - bundle a component with shadcn imports\n'
    );
  },
};
