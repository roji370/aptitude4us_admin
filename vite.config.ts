import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@mui/material',
      '@mui/icons-material',
      '@emotion/react',
      '@emotion/styled'
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return;
          if (id.includes('@mui/icons-material')) return 'mui-icons';
          if (id.includes('@mui/material') || id.includes('@emotion/react') || id.includes('@emotion/styled')) return 'mui';
          if (id.includes('firebase/auth') || id.includes('@firebase/auth')) return 'firebase-auth';
          if (id.includes('firebase/firestore') || id.includes('@firebase/firestore')) return 'firebase-firestore';
          if (id.includes('firebase/storage') || id.includes('@firebase/storage')) return 'firebase-storage';
          if (id.includes('firebase/messaging') || id.includes('@firebase/messaging')) return 'firebase-messaging';
          if (id.includes('firebase')) return 'firebase-core';
          if (id.includes('react-dom')) return 'react-dom';
          if (id.includes('react-router')) return 'react-router';
          if (id.includes('react')) return 'react';
        }
      }
    }
  },
  server: {
    port: 5174,
    strictPort: true,
    hmr: {
      port: 5174,
      protocol: 'ws'
    },
    proxy: {
      // Proxy Firebase Storage requests to avoid CORS issues in development
      '/api/firebase-storage': {
        target: 'https://firebasestorage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/firebase-storage/, ''),
        headers: {
          'Access-Control-Allow-Origin': '*'
        }
      }
    }
  },
  base: './' // Use relative paths
})
