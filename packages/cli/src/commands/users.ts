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
  name: string;
  force: boolean;
}

interface UsersListKeysArgs {
  name: string;
}

interface UsersAddKeyArgs {
  name: string;
  pubkeyPath?: string;
  paste?: boolean;
  label?: string;
}

interface UsersRemoveKeyArgs {
  name: string;
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

  delete({
    name,
    force,
  }: ArgumentsCamelCase<UsersDeleteArgs>): React.ReactElement {
    return React.createElement(UsersDelete, { userName: name, force });
  }

  listKeys({
    name,
  }: ArgumentsCamelCase<UsersListKeysArgs>): React.ReactElement {
    return React.createElement(UsersKeysList, { userName: name });
  }

  addKey({
    name,
    pubkeyPath,
    paste,
    label,
  }: ArgumentsCamelCase<UsersAddKeyArgs>): React.ReactElement {
    return React.createElement(UsersKeysAdd, {
      userName: name,
      pubkeyPath,
      paste,
      label,
    });
  }

  removeKey({
    name,
    fingerprint,
    force,
  }: ArgumentsCamelCase<UsersRemoveKeyArgs>): React.ReactElement {
    return React.createElement(UsersKeysRemove, {
      userName: name,
      fingerprint,
      force,
    });
  }
}
