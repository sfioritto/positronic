import type { ArgumentsCamelCase } from 'yargs';
import React from 'react';
import { SecretCreate } from '../components/secret-create.js';

interface SecretCreateArgs {
  name: string;
  value?: string;
}

export class SecretCommand {
  constructor() {}

  create({
    name,
    value,
  }: ArgumentsCamelCase<SecretCreateArgs>): React.ReactElement {
    return React.createElement(SecretCreate, {
      name,
      value,
    });
  }
}