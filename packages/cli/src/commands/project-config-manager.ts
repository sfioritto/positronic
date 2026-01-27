import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface Project {
  name: string;
  url: string;
  addedAt: string;
  privateKeyPath?: string; // Per-project key override
}

export interface ProjectConfig {
  version: string;
  currentProject: string | null;
  projects: Project[];
  defaultPrivateKeyPath?: string; // Global default key
}

export class ProjectConfigManager {
  private configPath: string;
  private configDir: string;

  constructor(customConfigDir?: string) {
    // Priority: customConfigDir > env variable > default home directory
    this.configDir =
      customConfigDir ||
      process.env.POSITRONIC_CONFIG_DIR ||
      path.join(os.homedir(), '.positronic');
    this.configPath = path.join(this.configDir, 'config.json');
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  private getDefaultConfig(): ProjectConfig {
    return {
      version: '1',
      currentProject: null,
      projects: [],
    };
  }

  read(): ProjectConfig {
    this.ensureConfigDir();

    if (!fs.existsSync(this.configPath)) {
      const defaultConfig = this.getDefaultConfig();
      this.write(defaultConfig);
      return defaultConfig;
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      return JSON.parse(content) as ProjectConfig;
    } catch (error) {
      console.error('Error reading config file:', error);
      // Return default config if file is corrupted
      return this.getDefaultConfig();
    }
  }

  write(config: ProjectConfig): void {
    this.ensureConfigDir();
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  addProject(name: string, url: string): { success: boolean; error?: string } {
    const config = this.read();

    // Check for duplicate names
    if (config.projects.some((p) => p.name === name)) {
      return {
        success: false,
        error: `A project named "${name}" already exists`,
      };
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return { success: false, error: 'Invalid URL format' };
    }

    const newProject: Project = {
      name,
      url,
      addedAt: new Date().toISOString(),
    };

    config.projects.push(newProject);

    // If this is the first project, make it current
    if (config.projects.length === 1) {
      config.currentProject = name;
    }

    this.write(config);
    return { success: true };
  }

  selectProject(name: string): { success: boolean; error?: string } {
    const config = this.read();

    const project = config.projects.find((p) => p.name === name);
    if (!project) {
      return { success: false, error: `Project "${name}" not found` };
    }

    config.currentProject = name;
    this.write(config);
    return { success: true };
  }

  removeProject(name: string): { success: boolean; error?: string } {
    const config = this.read();

    const projectIndex = config.projects.findIndex((p) => p.name === name);
    if (projectIndex === -1) {
      return { success: false, error: `Project "${name}" not found` };
    }

    config.projects.splice(projectIndex, 1);

    // If we removed the current project, clear it
    if (config.currentProject === name) {
      config.currentProject =
        config.projects.length > 0 ? config.projects[0].name : null;
    }

    this.write(config);
    return { success: true };
  }

  getCurrentProject(): Project | null {
    const config = this.read();
    if (!config.currentProject) return null;

    return (
      config.projects.find((p) => p.name === config.currentProject) || null
    );
  }

  listProjects(): { projects: Project[]; current: string | null } {
    const config = this.read();
    return {
      projects: config.projects,
      current: config.currentProject,
    };
  }

  /**
   * Get the resolved private key path following the priority order:
   * 1. POSITRONIC_PRIVATE_KEY environment variable (highest)
   * 2. Project-specific privateKeyPath (if project selected and has override)
   * 3. Global defaultPrivateKeyPath from config
   * 4. ~/.ssh/id_rsa fallback (lowest)
   */
  getPrivateKeyPath(): string | null {
    // Priority 1: Environment variable
    if (process.env.POSITRONIC_PRIVATE_KEY) {
      return process.env.POSITRONIC_PRIVATE_KEY;
    }

    const config = this.read();

    // Priority 2: Project-specific key
    if (config.currentProject) {
      const project = config.projects.find((p) => p.name === config.currentProject);
      if (project?.privateKeyPath) {
        return project.privateKeyPath;
      }
    }

    // Priority 3: Global default key
    if (config.defaultPrivateKeyPath) {
      return config.defaultPrivateKeyPath;
    }

    // Priority 4: No configured key (return null, let caller use fallback)
    return null;
  }

  /**
   * Set the global default private key path
   */
  setDefaultPrivateKeyPath(keyPath: string): { success: boolean; error?: string } {
    const config = this.read();
    config.defaultPrivateKeyPath = keyPath;
    this.write(config);
    return { success: true };
  }

  /**
   * Set the private key path for a specific project
   */
  setProjectPrivateKeyPath(projectName: string, keyPath: string): { success: boolean; error?: string } {
    const config = this.read();
    const project = config.projects.find((p) => p.name === projectName);

    if (!project) {
      return { success: false, error: `Project "${projectName}" not found` };
    }

    project.privateKeyPath = keyPath;
    this.write(config);
    return { success: true };
  }

  /**
   * Clear the global default private key path
   */
  clearDefaultPrivateKeyPath(): void {
    const config = this.read();
    delete config.defaultPrivateKeyPath;
    this.write(config);
  }

  /**
   * Clear the private key path for a specific project
   */
  clearProjectPrivateKeyPath(projectName: string): { success: boolean; error?: string } {
    const config = this.read();
    const project = config.projects.find((p) => p.name === projectName);

    if (!project) {
      return { success: false, error: `Project "${projectName}" not found` };
    }

    delete project.privateKeyPath;
    this.write(config);
    return { success: true };
  }

  /**
   * Get the default private key path (global config only, no env var or project override)
   */
  getDefaultPrivateKeyPath(): string | undefined {
    const config = this.read();
    return config.defaultPrivateKeyPath;
  }

  /**
   * Get the private key path for a specific project
   */
  getProjectPrivateKeyPath(projectName: string): string | undefined {
    const config = this.read();
    const project = config.projects.find((p) => p.name === projectName);
    return project?.privateKeyPath;
  }
}
