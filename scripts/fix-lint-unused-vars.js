const fs = require('fs');
const execSync = require('child_process').execSync;
console.log('Running ESLint...');
let output;
try {
  output = execSync('npx eslint src --format json', { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 }).toString();
} catch (e) {
  output = e.stdout.toString();
}
const startIndex = output.indexOf('[');
if (startIndex === -1) {
    console.log("No JSON array found in output");
    console.log(output.substring(0, 500));
    process.exit(1);
}
const data = JSON.parse(output.substring(startIndex));
let fixCount = 0;
for (const file of data) {
  let content = fs.readFileSync(file.filePath, 'utf8');
  let lines = content.split('\n');
  const unusedMsgs = file.messages.filter(m => m.ruleId === '@typescript-eslint/no-unused-vars' && m.message.includes('never used'));
  
  if (unusedMsgs.length > 0) {
    // Apply fixes from bottom to top to preserve line/col accuracy per line
    const fixesByLine = {};
    for (const msg of unusedMsgs) {
      if (!fixesByLine[msg.line]) fixesByLine[msg.line] = [];
      fixesByLine[msg.line].push(msg);
    }
    
    for (const lineNumStr of Object.keys(fixesByLine)) {
      const lineNum = parseInt(lineNumStr);
      let line = lines[lineNum - 1];
      const msgs = fixesByLine[lineNumStr].sort((a,b) => b.column - a.column);
      
      for (const msg of msgs) {
        const match = msg.message.match(/'([^']+)'/);
        if (match && match[1]) {
           const varName = match[1];
           if (!varName.startsWith('_')) {
             const before = line.substring(0, msg.column - 1);
             const after = line.substring(msg.column - 1);
             if (after.startsWith(varName)) {
                line = before + '_' + after;
                fixCount++;
             }
           }
        }
      }
      lines[lineNum - 1] = line;
    }
    fs.writeFileSync(file.filePath, lines.join('\n'), 'utf8');
  }
}
console.log('Fixed', fixCount, 'unused variables.');
