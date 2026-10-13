import { fileURLToPath } from 'url';
import { defineConfig, type Plugin } from 'vite';

import { sourceHash } from './source-hash';

const root = fileURLToPath(new URL('.', import.meta.url));

/** Record what this build was made from; see source-hash.ts. */
function recordSourceHash(): Plugin {
    return {
        name: 'record-source-hash',
        apply: 'build',
        generateBundle() {
            this.emitFile({ type: 'asset', fileName: 'source-hash.txt', source: `${sourceHash(root)}\n` });
        },
    };
}

export default defineConfig({
    base: './',
    esbuild: {
        jsx: 'automatic',
        jsxImportSource: 'preact',
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('/node_modules/monaco-editor/')) {
                        return 'vendor';
                    }
                },
            },
        },
    },
    plugins: [recordSourceHash()],
    server: {
        allowedHosts: true,
        host: true, // Accept all hosts (0.0.0.0)
    },
});
