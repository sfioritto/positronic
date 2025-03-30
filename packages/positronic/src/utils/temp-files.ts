import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Writes content to a temporary file and opens it in cursor
 */
export async function writeAndOpenTemp(
  content: string,
  prefix: string,
  extension: string = 'txt'
): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'positronic-'));
  const filename = `${prefix}-${Date.now()}.${extension}`;
  const filepath = path.join(tempDir, filename);

  await fs.writeFile(filepath, content, 'utf8');

  // Open in cursor using the cursor command
  await execAsync(`cursor ${filepath}`);

  return filepath;
}

/**
 * Writes both prompt and response to temp files and opens them in cursor
 */
export async function writePromptAndResponse(
  prompt: string,
  response: unknown,
  prefix: string = 'debug'
): Promise<{ promptPath: string, responsePath: string }> {
  const promptPath = await writeAndOpenTemp(prompt, `${prefix}-prompt`, 'md');
  const responsePath = await writeAndOpenTemp(
    typeof response === 'string' ? response : JSON.stringify(response, null, 2),
    `${prefix}-response`,
    'tsx'
  );

  return { promptPath, responsePath };
}