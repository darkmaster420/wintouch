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