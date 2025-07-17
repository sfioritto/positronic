import type { ArgumentsCamelCase } from 'yargs';
import React from 'react';
import type { PositronicDevServer } from '@positronic/spec';
import { SecretCreate } from '../components/secret-create.js';
import { SecretList } from '../components/secret-list.js';
import { SecretDelete } from '../components/secret-delete.js';

interface SecretCreateArgs {
  name: string;
  value?: string;
}

interface SecretDeleteArgs {
  name: string;
}

export class SecretCommand {
  constructor(private server?: PositronicDevServer) {}

  list(): React.ReactElement {
    return React.createElement(SecretList, { server: this.server });
  }

  create({
    name,
    value,
  }: ArgumentsCamelCase<SecretCreateArgs>): React.ReactElement {
    return React.createElement(SecretCreate, {
      name,
      value,
      server: this.server,
    });
  }

  delete({ name }: ArgumentsCamelCase<SecretDeleteArgs>): React.ReactElement {
    return React.createElement(SecretDelete, { name, server: this.server });
  }
}