export type LaunchableApp = {
  id: string;
  name: string;
  path: string;
  source: string;
  type: string;
  icon?: string;
};

export type LaunchResult = {
  ok: boolean;
  error?: string;
};

export type ScanConfig = {
  scanFolders: string[];
  setupComplete: boolean;
  approvedApps: string[];
  rejectedApps: string[];
};

export type SuggestedFolder = {
  path: string;
  label: string;
  exists: boolean;
};