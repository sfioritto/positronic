import sshpk from 'sshpk';
import { Client as AgentClient } from 'sshpk-agent';

/**
 * Wrapper for ssh-agent operations using sshpk-agent
 */
export class AgentSigner {
  private client: AgentClient | null = null;
  private keys: sshpk.Key[] | null = null;

  /**
   * Check if ssh-agent is available (SSH_AUTH_SOCK environment variable exists)
   */
  isAvailable(): boolean {
    return !!process.env.SSH_AUTH_SOCK;
  }

  /**
   * Get the agent client, creating it lazily
   */
  private getClient(): AgentClient {
    if (!this.client) {
      this.client = new AgentClient();
    }
    return this.client;
  }

  /**
   * List all keys available in the ssh-agent
   */
  async getKeys(): Promise<sshpk.Key[]> {
    if (this.keys) {
      return this.keys;
    }

    const client = this.getClient();

    return new Promise((resolve, reject) => {
      client.listKeys((err, keys) => {
        if (err) {
          reject(err);
          return;
        }
        this.keys = keys;
        resolve(keys);
      });
    });
  }

  /**
   * Check if the agent has a key with the given fingerprint
   * Returns the key if found, null otherwise
   */
  async hasKey(fingerprint: string): Promise<sshpk.Key | null> {
    const keys = await this.getKeys();

    for (const key of keys) {
      const keyFingerprint = key.fingerprint('sha256').toString();
      if (keyFingerprint === fingerprint) {
        return key;
      }
    }

    return null;
  }

  /**
   * Sign data with a key from the agent
   * Returns the sshpk.Signature object
   */
  async sign(key: sshpk.Key, data: Buffer): Promise<sshpk.Signature> {
    const client = this.getClient();

    return new Promise((resolve, reject) => {
      client.sign(key, data, (err, signature) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(signature);
      });
    });
  }
}
