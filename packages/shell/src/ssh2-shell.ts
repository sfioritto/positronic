import { Client, ClientChannel } from 'ssh2';
import type { Shell, ExecCommandOptions, ExecCommandResponse } from './types.js';
import type { ConnectConfig } from 'ssh2';

interface SSH2ShellOptions extends ConnectConfig {
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  shell?: 'bash' | 'sh' | 'zsh';
  noTrim?: boolean;
  cwd?: string;
}

export class SSH2Shell implements Shell {
  private client: Client;
  private defaultCwd?: string;

  constructor(private config: SSH2ShellOptions) {
    this.client = new Client();
    this.defaultCwd = config.cwd;
  }

  async connect() {
    return new Promise<void>((resolve, reject) => {
      this.client.on('ready', () => {
        resolve();
      });

      this.client.on('error', (err) => {
        reject(err);
      });

      this.client.connect(this.config);
    });
  }

  async execCommand(
    givenCommand: string,
    options: ExecCommandOptions = {}
  ) {
    return new Promise<ExecCommandResponse>((resolve, reject) => {
      const env = { ...this.config.env, ...options.env };
      const shell = this.config.shell || options.shell || null;
      const shellCommand = shell ? `${shell} -c "${givenCommand}"` : givenCommand;
      const cwd = options.cwd || this.defaultCwd;

      if (cwd) {
        // Prepend cd command if cwd is specified
        const fullCommand = `cd ${cwd} && ${shellCommand}`;
        this.client.exec(fullCommand, { env }, (err: Error | undefined, stream: ClientChannel) => {
          if (err) {
            reject(err);
            return;
          }

          const {
            noTrim = false
          } = options;

          let stdout: string[] = [];
          let stderr: string[] = [];

          stream.on('data', (data: Buffer) => {
            stdout.push(data.toString());
          });

          stream.stderr.on('data', (data: Buffer) => {
            stderr.push(data.toString());
          });

          stream.on('close', (code: number, signal: string | null) => {
            const response: ExecCommandResponse = {
              stdout: noTrim ? stdout.join('') : stdout.join('').trim(),
              stderr: noTrim ? stderr.join('') : stderr.join('').trim(),
              code,
              signal
            };
            resolve(response);
          });

          stream.on('error', (err: Error) => {
            reject(err);
          });
        });
      } else {
        this.client.exec(shellCommand, { env }, (err: Error | undefined, stream: ClientChannel) => {
          if (err) {
            reject(err);
            return;
          }

          const {
            noTrim = false
          } = options;

          let stdout: string[] = [];
          let stderr: string[] = [];

          stream.on('data', (data: Buffer) => {
            stdout.push(data.toString());
          });

          stream.stderr.on('data', (data: Buffer) => {
            stderr.push(data.toString());
          });

          stream.on('close', (code: number, signal: string | null) => {
            const response: ExecCommandResponse = {
              stdout: noTrim ? stdout.join('') : stdout.join('').trim(),
              stderr: noTrim ? stderr.join('') : stderr.join('').trim(),
              code,
              signal
            };
            resolve(response);
          });

          stream.on('error', (err: Error) => {
            reject(err);
          });
        });
      }
    });
  }

  async exec(command: string, parameters: string[], options: ExecCommandOptions = {}) {
    const { stream = 'stdout', ...execOptions } = options;
    const fullCommand = `${command} ${parameters.join(' ')}`;
    const result = await this.execCommand(fullCommand, execOptions);

    if (stream === 'both') {
      return result;
    }

    return stream === 'stdout' ? result.stdout : result.stderr;
  }

  async disconnect() {
    this.client.end();
  }
}