import { spawn } from 'child_process';
import { Readable } from 'stream';

import type { Shell, ExecCommandOptions, ExecCommandResponse } from './types.js';

interface LocalShellOptions {
  cwd?: string;
  shell?: string;
  env?: NodeJS.ProcessEnv;
}

export class LocalShell implements Shell {
  constructor(private config: LocalShellOptions = {}) {}

  async execCommand(givenCommand: string, options: ExecCommandOptions = {}): Promise<ExecCommandResponse> {
    return new Promise((resolve, reject) => {
      const {
        cwd = this.config.cwd || process.cwd(),
        stdin,
        encoding = 'utf8',
        noTrim = false,
        onStdout,
        onStderr,
        env = this.config.env,
        timeout,
        shell = this.config.shell || 'bash'
      } = options;

      const childProcess = spawn(shell, ['-c', givenCommand], {
        cwd,
        env,
        timeout,
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString(encoding);
        stdout += chunk;
        onStdout?.(data);
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString(encoding);
        stderr += chunk;
        onStderr?.(data);
      });

      if (stdin) {
        if (typeof stdin === 'string') {
          childProcess.stdin.write(stdin);
          childProcess.stdin.end();
        } else if (stdin instanceof Readable) {
          stdin.pipe(childProcess.stdin);
        }
      }

      childProcess.on('close', (code, signal) => {
        if (!noTrim) {
          stdout = stdout.trim();
          stderr = stderr.trim();
        }
        resolve({
          stdout,
          stderr,
          code,
          signal,
        });
      });

      childProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  async exec(
    command: string,
    parameters: string[],
    options: ExecCommandOptions = {}
  ): Promise<string | ExecCommandResponse> {
    const { stream = 'stdout', ...execOptions } = options;
    const fullCommand = `${command} ${parameters.join(' ')}`;
    const result = await this.execCommand(fullCommand, execOptions);

    if (stream === 'both') {
      return result;
    }

    return stream === 'stdout' ? result.stdout : result.stderr;
  }
}