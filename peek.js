const xlsx = require('xlsx');

function peek(file) {
    const wb = xlsx.readFile(file, { sheetRows: 5 });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`\n--- ${file} ---`);
    console.dir(data, { depth: null });
}

peek('C:\\Users\\gomd9\\nbe\\한국산업단지공단_전국등록공장현황_20200229_정리1.xlsx');
peek('C:\\Users\\gomd9\\nbe\\china factory list(0131) 1.xlsx');
