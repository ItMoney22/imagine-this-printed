const fs = require('fs');
const path = 'src/pages/AdminDashboard.tsx';
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

// Line 2474 is index 2473
if (lines.length >= 2474) {
    const lineToRemove = lines[2473];
    console.log('Removing line 2474:', lineToRemove);
    lines.splice(2473, 1);
    fs.writeFileSync(path, lines.join('\n'));
    console.log('File updated successfully.');
} else {
    console.error('File too short:', lines.length);
}
