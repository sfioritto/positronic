import { LocalResourceLoader } from './local-resource-loader';

// Export the local implementation as the default ResourceLoader
export const ResourceLoader = LocalResourceLoader;

// Also export the named implementation for those who need the specific class
export { LocalResourceLoader };
