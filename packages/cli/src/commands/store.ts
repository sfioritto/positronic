import React from 'react';
import { StoreExplorer } from '../components/store-explorer.js';

export class StoreCommand {
  explore(): React.ReactElement {
    return React.createElement(StoreExplorer);
  }
}
