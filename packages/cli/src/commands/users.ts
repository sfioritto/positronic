import type { ArgumentsCamelCase } from 'yargs';
import React from 'react';
import { UsersList } from '../components/users-list.js';
import { UsersCreate } from '../components/users-create.js';
import { UsersDelete } from '../components/users-delete.js';
import { UsersKeysList } from '../components/users-keys-list.js';
import { UsersKeysAdd } from '../components/users-keys-add.js';
import { UsersKeysRemove } from '../components/users-keys-remove.js';

interface UsersCreateArgs {
  name: string;
}

interface UsersDeleteArgs {
  id: string;
  force: boolean;
}

interface UsersKeysListArgs {
  id: string;
}

interface UsersKeysAddArgs {
  id: string;
  pubkeyPath: string;
  label?: string;
}

interface UsersKeysRemoveArgs {
  id: string;
  fingerprint: string;
  force: boolean;
}

export class UsersCommand {
  constructor() {}

  list(): React.ReactElement {
    return React.createElement(UsersList);
  }

  create({ name }: ArgumentsCamelCase<UsersCreateArgs>): React.ReactElement {
    return React.createElement(UsersCreate, { name });
  }

  delete({ id, force }: ArgumentsCamelCase<UsersDeleteArgs>): React.ReactElement {
    return React.createElement(UsersDelete, { userId: id, force });
  }

  keysList({ id }: ArgumentsCamelCase<UsersKeysListArgs>): React.ReactElement {
    return React.createElement(UsersKeysList, { userId: id });
  }

  keysAdd({
    id,
    pubkeyPath,
    label,
  }: ArgumentsCamelCase<UsersKeysAddArgs>): React.ReactElement {
    return React.createElement(UsersKeysAdd, {
      userId: id,
      pubkeyPath,
      label,
    });
  }

  keysRemove({
    id,
    fingerprint,
    force,
  }: ArgumentsCamelCase<UsersKeysRemoveArgs>): React.ReactElement {
    return React.createElement(UsersKeysRemove, {
      userId: id,
      fingerprint,
      force,
    });
  }
}
