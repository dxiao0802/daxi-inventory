import { cpSync, mkdirSync, rmSync } from 'fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/css',  { recursive: true });
mkdirSync('dist/js',   { recursive: true });
mkdirSync('dist/data', { recursive: true });

cpSync('index.html',          'dist/index.html');
cpSync('css/style.css',       'dist/css/style.css');
cpSync('public/js/app.js',    'dist/js/app.js');
cpSync('public/js/supabase.js', 'dist/js/supabase.js');
cpSync('public/data/data.js', 'dist/data/data.js');

console.log('Build complete: dist/ ready');
