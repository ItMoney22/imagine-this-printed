const fs = require('fs');
const path = 'src/pages/AdminDashboard.tsx';
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

// 1. Restore the div at 2474 (index 2473)
// We deleted it, so we insert it back.
// Indentation: 18 spaces based on checking surrounding lines previously
lines.splice(2473, 0, '                  </div>');

// 2. Add the missing closing div for Root (1130).
// We have one closing div at the end (now around 2555).
// We need one more before it.
// Find the last closing div.
let lastDivIndex = -1;
for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === '</div>') {
        lastDivIndex = i;
        break;
    }
}

if (lastDivIndex !== -1) {
    // Insert before the last div
    lines.splice(lastDivIndex, 0, '    </div>');
    console.log('Restored line 2474 and added missing root closing div.');
    fs.writeFileSync(path, lines.join('\n'));
} else {
    console.error('Could not find last closing div.');
}
