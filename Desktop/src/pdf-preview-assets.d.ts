/// <reference types="vite/client" />

declare module 'virtual:pdf-preview-fonts' {
  const data: Record<string, Record<string, string>>;
  export default data;
}

declare module '*?url&no-inline' {
  const url: string;
  export default url;
}
