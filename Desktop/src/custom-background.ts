export interface BackgroundOptions {
  enabled: boolean;
  fit: 'cover' | 'contain';
  positionX: number;
  positionY: number;
  zoom: number;
  brightness: number;
  blur: number;
  parallax: number;
  contentTransparency: number;
  sidebarTransparency: number;
  panelTransparency: number;
  composerTransparency: number;
  surfaceBlur: number;
}

export interface BackgroundImageDescriptor {
  revision: string;
  width: number;
  height: number;
}

export interface StoredBackgroundState {
  options: BackgroundOptions;
  image?: BackgroundImageDescriptor;
  issue?: 'missing' | 'invalid' | 'storage';
}

export interface CustomBackgroundState extends StoredBackgroundState {
  available: boolean;
  ref?: string;
}

export const DEFAULT_BACKGROUND_OPTIONS: Readonly<BackgroundOptions> = Object.freeze({
  enabled: false,
  fit: 'cover',
  positionX: 50,
  positionY: 50,
  zoom: 100,
  brightness: 90,
  blur: 0,
  parallax: 0,
  contentTransparency: 30,
  sidebarTransparency: 20,
  panelTransparency: 20,
  composerTransparency: 10,
  surfaceBlur: 8,
});

const ranges = {
  positionX: [0, 100],
  positionY: [0, 100],
  zoom: [100, 200],
  brightness: [40, 120],
  blur: [0, 24],
  parallax: [0, 12],
  contentTransparency: [0, 100],
  sidebarTransparency: [0, 100],
  panelTransparency: [0, 100],
  composerTransparency: [0, 100],
  surfaceBlur: [0, 24],
} as const;

const record = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
};
const validOption = (key: string, value: unknown) => {
  if (key === 'enabled') return typeof value === 'boolean';
  if (key === 'fit') return value === 'cover' || value === 'contain';
  if (!Object.hasOwn(ranges, key)) return false;
  const [minimum, maximum] = ranges[key as keyof typeof ranges];
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
};

export function validateBackgroundPatch(value: unknown): Partial<BackgroundOptions> {
  if (!record(value)) throw new Error('custom-background:invalid-input');
  const patch: Record<string, unknown> = {};
  for (const [key, option] of Object.entries(value)) {
    if (!Object.hasOwn(DEFAULT_BACKGROUND_OPTIONS, key) || !validOption(key, option))
      throw new Error('custom-background:invalid-input');
    patch[key] = option;
  }
  return patch as Partial<BackgroundOptions>;
}

export function normalizeBackgroundOptions(value: unknown): BackgroundOptions {
  const options: BackgroundOptions = { ...DEFAULT_BACKGROUND_OPTIONS };
  if (!record(value)) return options;
  for (const key of Object.keys(DEFAULT_BACKGROUND_OPTIONS)) {
    if (Object.hasOwn(value, key) && validOption(key, value[key]))
      Object.assign(options, { [key]: value[key] });
  }
  return options;
}
