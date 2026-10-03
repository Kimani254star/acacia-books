#!/usr/bin/env python3
"""
Apply the locale fix to the Acacia Books files.

    python3 patch_locale.py  <folder with index.html, app.js, app-2.js, app-3.js>  [output folder]

Without an output folder the files are patched in place (a .bak copy of each is kept).
Every step reports how many places it changed and stops if something it expects is missing.

What it changes
  1. Removes the old "script 267" block (DOM currency text rewriter + 38-word translator + reload-on-language-change).
     That block re-converted amounts that had already been converted, and fought with the new language module.
  2. `${window.__fmtBase(x)} KES`  ->  `${window.__fmtBase(x)} <base currency>`
     (the number was already converted to the base currency, only the label still said KES, so the old rewriter
     converted it a second time).
  3. `input.value = window.__fmtBase(x)`  ->  `window.__rawAmt(x)`  (inputs get a plain number, not "1,234.50").
  4. `rates[bank.currency] || 1`  ->  uses the shared rate table (a missing rate used to be treated as 1 KES per unit).
  5. index.html: adds <script defer src="locale.js"></script> after coa-ledger.js.
"""
import os, re, shutil, sys

src = sys.argv[1] if len(sys.argv) > 1 else '.'
out = sys.argv[2] if len(sys.argv) > 2 else src
os.makedirs(out, exist_ok=True)

def read(n):
    with open(os.path.join(src, n), encoding='utf-8', errors='surrogateescape', newline='') as f:
        return f.read()

def write(n, s):
    p = os.path.join(out, n)
    if out == src and os.path.exists(p) and not os.path.exists(p + '.bak'):
        shutil.copyfile(p, p + '.bak')
    with open(p, 'w', encoding='utf-8', errors='surrogateescape', newline='') as f:
        f.write(s)

def sub(pattern, repl, s, name, flags=0):
    s2, n = re.subn(pattern, repl, s, flags=flags)
    print('   %-46s %d change(s)' % (name, n))
    return s2

LABEL = r'(__fmtBase\([^`]*?\)\}) KES'
LABEL_R = r'\1 ${window.__getBaseCurrencyEarly()}'
INPUT = r'\.(value|max)(\s*=\s*)window\.__fmtBase\('
INPUT_R = r'.\1\2window.__rawAmt('
RATE = r'\b(\w+)\[(\w+)\.currency\]\s*\|\|\s*1(?![\d.])'
RATE_R = r'(window.acxKesPer?window.acxKesPer(\2.currency):\1[\2.currency]||1)'
RATE2 = r'parseFloatSafe\((\w+)\[(\w+)\.currency\]\)\s*\|\|\s*1'
RATE2_R = r'parseFloatSafe(\1[\2.currency]) || (window.acxKesPer?window.acxKesPer(\2.currency):1)'

for name in ('app.js', 'app-2.js', 'app-3.js'):
    if not os.path.exists(os.path.join(src, name)):
        print('skip', name, '(not found)'); continue
    print(name)
    s = read(name)

    if name == 'app.js':
        a = s.find('/* ---- script 267 ---- */'); b = s.find('/* ---- script 268 ---- */')
        if a < 0 or b < a: sys.exit('app.js: script 267 block not found')
        s = s[:a] + '/* ---- script 267: legacy currency text rewriter + 38-word translator removed (see locale.js) ---- */\ntry{}catch(e){}\n\n' + s[b:]
        print('   %-46s removed %d chars' % ('legacy script 267', b - a))
    if name == 'app-3.js':
        a = s.find('try{!function(){const e="appBaseCurrency",t="appLanguage"')
        endm = 'catch(e){console.error("[app.js script 267]",e)}'
        b = s.find(endm, a)
        if a < 0 or b < 0: sys.exit('app-3.js: script 267 block not found')
        b += len(endm)
        s = s[:a] + 'try{}catch(e){}' + s[b:]
        print('   %-46s removed %d chars' % ('legacy script 267', b - a))

    s = sub(LABEL, LABEL_R, s, 'KES label after __fmtBase', re.S)
    s = sub(INPUT, INPUT_R, s, 'input value = __fmtBase')
    s = sub(RATE2, RATE2_R, s, 'rate lookup (parseFloatSafe)')
    s = sub(RATE, RATE_R, s, 'rate lookup || 1')
    write(name, s)

if os.path.exists(os.path.join(src, 'index.html')):
    print('index.html')
    h = read('index.html')
    tag = '<script defer src="locale.js"></script>'
    if tag in h:
        print('   locale.js already included')
    else:
        m = '<script defer src="coa-ledger.js"></script>'
        if m not in h: sys.exit('index.html: coa-ledger.js tag not found; add ' + tag + ' as the LAST script yourself')
        h = h.replace(m, m + '\n' + tag, 1)
        print('   locale.js tag added')
    write('index.html', h)
print('done. Copy locale.js next to index.html.')
