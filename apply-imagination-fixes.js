// Script to apply Imagination Station UI fixes
// Run with: node apply-imagination-fixes.js

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'pages', 'ImaginationStation.tsx');
const canvasPath = path.join(__dirname, 'src', 'components', 'imagination', 'SheetCanvas.tsx');

console.log('Applying Imagination Station UI fixes...\n');

// Read the main file
let content = fs.readFileSync(filePath, 'utf8');

// Fix 1: Back button navigation
console.log('1. Fixing back button navigation...');
content = content.replace(
  /onClick=\{[()]\s*=>\s*navigate\(-1\)\s*\}/,
  "onClick={() => navigate('/product-catalog')}"
);

// Fix 2: Make ITC balance clickable and add Profile/Settings buttons
console.log('2. Adding clickable ITC balance, Profile, and Settings buttons...');
content = content.replace(
  /{\/\* ITC Balance \*\/}\s*<div className="flex items-center gap-2 px-3 py-1\.5 bg-purple-50 rounded-lg border border-purple-100">\s*<Coins className="w-4 h-4 text-amber-500" \/>\s*<span className="font-bold text-purple-700">\{itcBalance\}<\/span>\s*<span className="text-purple-600 text-sm">ITC<\/span>\s*<\/div>/,
  `{/* ITC Balance - Clickable */}
          <button
            onClick={() => navigate('/wallet')}
            className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 rounded-lg border border-purple-100 hover:bg-purple-100 transition-colors"
            title="Go to Wallet"
          >
            <Coins className="w-4 h-4 text-amber-500" />
            <span className="font-bold text-purple-700">{itcBalance}</span>
            <span className="text-purple-600 text-sm">ITC</span>
          </button>

          {/* Profile Button */}
          <button
            onClick={() => navigate('/profile')}
            className="w-8 h-8 flex items-center justify-center text-stone-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
            title="Profile"
          >
            <User className="w-5 h-5" />
          </button>

          {/* Settings Button - Opens settings panel */}
          <button
            onClick={() => setActivePanel('export')}
            className={\`w-8 h-8 flex items-center justify-center rounded-lg transition-colors \${
              activePanel === 'export'
                ? 'text-purple-600 bg-purple-50'
                : 'text-stone-600 hover:text-purple-600 hover:bg-purple-50'
            }\`}
            title="Settings & Export"
          >
            <Settings className="w-5 h-5" />
          </button>`
);

// Fix 3a: Left sidebar toggle
console.log('3. Adding sidebar toggle buttons...');
content = content.replace(
  /{\/\* Left Sidebar - Tools \*\/}\s*<aside className="w-64 bg-white border-r border-stone-200 flex flex-col shrink-0">/,
  `{/* Left Sidebar - Tools */}
        {leftSidebarVisible && (
        <aside className="w-64 bg-white border-r border-stone-200 flex flex-col shrink-0 relative">
          {/* Hide button */}
          <button
            onClick={() => setLeftSidebarVisible(false)}
            className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-stone-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors z-10"
            title="Hide panel"
          >
            <PanelLeft className="w-4 h-4" />
          </button>`
);

// Find the closing tag for left sidebar and wrap it
content = content.replace(
  /(<\/div>\s*<\/aside>)(\s*{\/\* Canvas Area \*\/})/,
  `$1
        )}

        {/* Show Left Sidebar Button */}
        {!leftSidebarVisible && (
          <button
            onClick={() => setLeftSidebarVisible(true)}
            className="w-8 bg-white border-r border-stone-200 flex items-center justify-center text-stone-400 hover:text-purple-600 hover:bg-purple-50 transition-colors shrink-0"
            title="Show left panel"
          >
            <PanelRight className="w-4 h-4" />
          </button>
        )}

        $2`
);

// Fix 3b: Right sidebar toggle
content = content.replace(
  /{\/\* Right Sidebar - Context Panel \*\/}\s*<aside className="w-80 bg-white border-l border-stone-200 flex flex-col shrink-0">/,
  `{/* Right Sidebar - Context Panel */}
        {/* Show Right Sidebar Button */}
        {!rightSidebarVisible && (
          <button
            onClick={() => setRightSidebarVisible(true)}
            className="w-8 bg-white border-l border-stone-200 flex items-center justify-center text-stone-400 hover:text-purple-600 hover:bg-purple-50 transition-colors shrink-0"
            title="Show right panel"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        {rightSidebarVisible && (
        <aside className="w-80 bg-white border-l border-stone-200 flex flex-col shrink-0 relative">
          {/* Hide button */}
          <button
            onClick={() => setRightSidebarVisible(false)}
            className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-stone-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors z-10"
            title="Hide panel"
          >
            <PanelRight className="w-4 h-4" />
          </button>`
);

// Find the last closing tag before the ending of the component and add the closing brace
const lastAsideClose = content.lastIndexOf('</aside>');
if (lastAsideClose !== -1) {
  const beforeAside = content.substring(0, lastAsideClose + '</aside>'.length);
  const afterAside = content.substring(lastAsideClose + '</aside>'.length);
  content = beforeAside + '\n        )}' + afterAside;
}

// Write back the main file
fs.writeFileSync(filePath, content, 'utf8');
console.log('✓ Main page fixes applied');

// Fix 4: Lock layer functionality in SheetCanvas
console.log('4. Adding lock layer functionality to SheetCanvas...');
let canvasContent = fs.readFileSync(canvasPath, 'utf8');

// Fix draggable property
canvasContent = canvasContent.replace(
  /draggable\s*$/m,
  'draggable={!(layer.metadata?.locked ?? false)}'
);

// Fix onDragEnd
canvasContent = canvasContent.replace(
  /onDragEnd=\{[()]\s*e\s*\)\s*=>\s*\{/,
  'onDragEnd={(e) => {\n    if (layer.metadata?.locked) return;'
);

// Fix onTransformEnd
canvasContent = canvasContent.replace(
  /onTransformEnd=\{[()]\s*e\s*\)\s*=>\s*\{\s*const node = shapeRef\.current;/,
  'onTransformEnd={(e) => {\n    if (layer.metadata?.locked) return;\n    const node = shapeRef.current;'
);

// Fix Transformer visibility
canvasContent = canvasContent.replace(
  /{isSelected && \(/,
  '{isSelected && !(layer.metadata?.locked ?? false) && ('
);

fs.writeFileSync(canvasPath, canvasContent, 'utf8');
console.log('✓ SheetCanvas fixes applied');

console.log('\n✅ All fixes applied successfully!');
console.log('\nPlease run the following to verify:');
console.log('  npm run dev');
console.log('\nAnd test:');
console.log('  1. Back button navigation');
console.log('  2. ITC/Profile/Settings buttons');
console.log('  3. Sidebar toggle buttons');
console.log('  4. Lock layer functionality');
