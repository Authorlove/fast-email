/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    getServerPort: () => Promise<number>;
  };
}
