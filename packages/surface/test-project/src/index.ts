import { getSandbox, type Sandbox as SandboxDO } from '@cloudflare/sandbox';

export { Sandbox } from '@cloudflare/sandbox';

type Env = {
  SANDBOX: DurableObjectNamespace<SandboxDO>;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const sandbox = getSandbox(env.SANDBOX, 'test-sandbox');

    if (url.pathname === '/sandbox/hello') {
      await sandbox.writeFile('/workspace/hello.txt', 'Hello from sandbox!');
      const file = await sandbox.readFile('/workspace/hello.txt');
      return Response.json({ content: file.content });
    }

    if (url.pathname === '/sandbox/exec') {
      const result = await sandbox.exec('node --version');
      return Response.json({
        stdout: result.stdout,
        exitCode: result.exitCode,
        success: result.success,
      });
    }

    if (url.pathname === '/sandbox/tsc') {
      const result = await sandbox.exec('npx tsc --version');
      return Response.json({
        stdout: result.stdout,
        exitCode: result.exitCode,
        success: result.success,
      });
    }

    return new Response(
      'Surface sandbox test worker. Try /sandbox/hello, /sandbox/exec, /sandbox/tsc'
    );
  },
};
