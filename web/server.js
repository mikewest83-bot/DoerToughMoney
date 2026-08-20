import express from 'express';
import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 5173;

// Serve static files from dist
const distPath = join(__dirname, 'dist');
app.use(express.static(distPath, {
  etag: false,
  lastModified: false,
  setHeaders: (res, path) => {
    // Cache assets with hash in name forever
    if (/\.(js|css|woff2|woff|eot|ttf)$/.test(path)) {
      res.setHeader('Cache-Control', 'max-age=31536000, immutable');
    } else {
      // Cache other static files briefly
      res.setHeader('Cache-Control', 'max-age=3600');
    }
  }
}));

// SPA fallback: any non-existent route goes to index.html
app.get('*', (req, res) => {
  res.sendFile(join(distPath, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});

