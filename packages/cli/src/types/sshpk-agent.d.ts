declare module 'sshpk-agent' {
  import type sshpk from 'sshpk';

  interface ClientOptions {
    socketPath?: string;
    timeout?: number;
  }

  class Client {
    constructor(options?: ClientOptions);

    listKeys(callback: (err: Error | null, keys: sshpk.Key[]) => void): void;

    sign(
      key: sshpk.Key,
      data: Buffer,
      callback: (err: Error | null, signature: sshpk.Signature) => void
    ): void;
    sign(
      key: sshpk.Key,
      data: Buffer,
      options: { algorithm?: string },
      callback: (err: Error | null, signature: sshpk.Signature) => void
    ): void;

    addKey(
      key: sshpk.PrivateKey,
      callback: (err: Error | null) => void
    ): void;
    addKey(
      key: sshpk.PrivateKey,
      options: { expires?: number; confirm?: boolean },
      callback: (err: Error | null) => void
    ): void;

    removeKey(
      key: sshpk.Key,
      callback: (err: Error | null) => void
    ): void;

    removeAllKeys(callback: (err: Error | null) => void): void;

    lock(
      password: Buffer | string,
      callback: (err: Error | null) => void
    ): void;

    unlock(
      password: Buffer | string,
      callback: (err: Error | null) => void
    ): void;
  }

  export { Client, ClientOptions };
}
