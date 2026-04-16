const postcss = require('postcss');
const fs = require('fs');
try {
  postcss.parse(fs.readFileSync('src/app/custom.css', 'utf8'));
  console.log('No parse errors!');
} catch (e) {
  console.log('Error at line', e.line, e.message);
}
