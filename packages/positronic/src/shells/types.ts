import { Readable } from 'stream';

export interface ExecCommandOptions {
  cwd?: string;
  stdin?: string | Readable;
  env?: Record<string, string>;
  timeout?: number;
  shell?: 'sh' | 'bash' | 'zsh' | 'powershell';
  encoding?: BufferEncoding;
  noTrim?: boolean;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  stream?: 'stdout' | 'stderr' | 'both';
}

export interface ExecCommandResponse {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
}

export interface Shell {
  execCommand(givenCommand: string, options?: ExecCommandOptions): Promise<ExecCommandResponse>;
  exec(command: string, parameters: string[], options?: ExecCommandOptions): Promise<string | ExecCommandResponse>;
}
