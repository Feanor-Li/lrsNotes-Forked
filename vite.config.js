import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import {ElementPlusResolver} from 'unplugin-vue-components/resolvers';

import {fileURLToPath, URL} from 'url';
import svgLoader from 'vite-svg-loader';

export default defineConfig(({command}) => ({
    server: {
        host: '0.0.0.0',
        port: 8080,
    },
    // 本地开发用根路径；构建（部署到 GitHub Pages 项目页）用仓库名作为子路径
    base: command === 'build' ? '/lrsNotes-Forked/' : '/',
    plugins: [
        vue(),
        AutoImport({
            resolvers: [ElementPlusResolver()],
        }),
        Components({
            resolvers: [ElementPlusResolver()],
        }),
        svgLoader({
            svgoConfig: {
                multipass: true,
            },
        }),
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },

    build: {
        outDir: 'dist',
    },
    optimizeDeps: {
        include: ['element-plus/es'],
    },
}));