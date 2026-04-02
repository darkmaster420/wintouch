export type LaunchableApp = {
  id: string;
  name: string;
  path: string;
  source: string;
  type: string;
};

export type LaunchResult = {
  ok: boolean;
  error?: string;
};

export type ScanConfig = {
  scanFolders: string[];
  setupComplete: boolean;
};

export type SuggestedFolder = {
  path: string;
  label: string;
  exists: boolean;
};