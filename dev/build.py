#!/usr/bin/env python3
"""Builds the standalone app (index.html + app.js + config.js), the claude.ai preview page, and a test page."""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
OUT_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'dist', 'standalone')
OUT_PREVIEW = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'dist', 'preview.html')
OUT_TEST = os.path.join(HERE, 'dist', 'test.html')

def read(name, base=SRC):
    with open(os.path.join(base, name), encoding='utf-8') as f:
        return f.read()

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)

light, dark = read('tokens.light.css'), read('tokens.dark.css')
base, body, app = read('base.css'), read('body.html'), read('app.js')
fonts = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800'
         '&family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap">')

# Only scripts from this site and Google's Firebase servers may run. No inline scripts at all.
CSP = ("default-src 'self'; "
       "script-src 'self' https://www.gstatic.com https://apis.google.com; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; "
       "img-src 'self' data: https://*.googleusercontent.com; "
       "connect-src 'self' https://*.googleapis.com https://www.gstatic.com https://discord.com https://discordapp.com https://*.workers.dev; "
       "frame-src https://*.firebaseapp.com https://accounts.google.com https://apis.google.com; "
       "object-src 'none'; base-uri 'none'; form-action 'none'")

standalone_css = (
    ':root{\n' + light + '  color-scheme:light;\n}\n'
    '@media (prefers-color-scheme: dark){\n  :root{\n' + dark + '    color-scheme:dark;\n  }\n}\n'
    + base.replace('/*@@BODYPAD*/', 'margin:0;\n  padding-block:calc(28px + env(safe-area-inset-top,0px)) calc(56px + env(safe-area-inset-bottom,0px));'))

def head(extra=''):
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + extra +
            '<meta name="referrer" content="strict-origin-when-cross-origin">\n'
            '<meta name="color-scheme" content="light dark">\n<meta name="theme-color" content="#EFEEEC">\n'
            '<meta name="apple-mobile-web-app-capable" content="yes">\n<title>Pod Planner</title>\n' + fonts + '\n'
            '<style>\n' + standalone_css + '</style>\n</head>\n<body>\n' + body)

# Standalone (GitHub Pages): three files.
# The script tags carry a version tag so a browser never pairs a new page with an old, cached app.js.
import hashlib
app_js = ('// Pod Planner app. You should not need to edit this file; your settings go in config.js.\n'
          + read('backend.firebase.js') + '\n' + app)
ver = hashlib.sha256(app_js.encode('utf-8')).hexdigest()[:10]
write(os.path.join(OUT_DIR, 'index.html'),
      head('<meta http-equiv="Content-Security-Policy" content="' + CSP + '">\n') +
      '\n<script src="config.js?v=' + ver + '"></script>\n<script type="module" src="app.js?v=' + ver + '"></script>\n</body>\n</html>\n')
write(os.path.join(OUT_DIR, 'app.js'), app_js)
write(os.path.join(OUT_DIR, 'config.js'), read('config.js'))

# claude.ai preview page (no doctype/head/body: the Artifact tool wraps it)
preview_css = (
    ':root{\n' + light + '}\n'
    '@media (prefers-color-scheme: dark){\n  :root:not([data-theme="light"]){\n' + dark + '    color-scheme:dark;\n  }\n}\n'
    ':root[data-theme="dark"]{\n' + dark + '  color-scheme:dark;\n}\n'
    + base.replace('/*@@BODYPAD*/', 'padding-block:28px 56px;'))
write(OUT_PREVIEW, '<title>Pod Planner</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n' + fonts + '\n'
      '<style>\n' + preview_css + '</style>\n' + body + '\n<script>\n' + read('backend.claude.js') + '\n' + app + '</script>\n')

# Test page: standalone styling, in-memory backend, inline (file:// cannot load modules)
write(OUT_TEST, head() + '\n<script>\n' + read('backend.mem.js', os.path.join(HERE, 'test')) + '\n' + app + '</script>\n</body>\n</html>\n')
print('built', OUT_DIR, OUT_PREVIEW, OUT_TEST)
