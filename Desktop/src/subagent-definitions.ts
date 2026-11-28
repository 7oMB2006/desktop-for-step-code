export type SubagentToolProfile = 'read' | 'command' | 'edit';
export type SubagentDefinitionDraft = {
  slug: string;
  description: string;
  prompt: string;
  model: string | null;
  profile: SubagentToolProfile;
};

type Definition = Pick<SubagentDefinitionDraft, 'description' | 'prompt' | 'model'> & {
  id: string;
  tools: string[] | null;
};

export type PersonalSubagent = Definition & SubagentDefinitionDraft & { source: 'personal'; revision: string };
export type SubagentDefinition = PersonalSubagent |
  (Definition & { source: 'builtin' | 'file' });
export type SubagentDefinitionCatalog = { available: boolean; roles: SubagentDefinition[] };
