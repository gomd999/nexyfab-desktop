const xlsx = require('xlsx');
const fs = require('fs');

console.log('Reading Excel file...');
const inputFile = 'C:\\Users\\gomd9\\nbe\\한국산업단지공단_전국등록공장현황_20200229_정리1.xlsx';
const wb = xlsx.readFile(inputFile);
const sheetName = wb.SheetNames[0];
const sheet = wb.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

console.log(`Total rows read: ${data.length}`);

function calculateSimilarity(str1, str2) {
    if (!str1 && !str2) return 1.0;
    if (!str1 || !str2) return 0.0;

    const getBigrams = (str) => {
        const bg = new Set();
        const s = String(str).replace(/\s+/g, '').toLowerCase();
        for (let i = 0; i < s.length - 1; i++) {
            bg.add(s.slice(i, i + 2));
        }
        // if only 1 character
        if (s.length === 1) bg.add(s);
        return bg;
    }
    const bg1 = getBigrams(str1);
    const bg2 = getBigrams(str2);
    if (bg1.size === 0 && bg2.size === 0) return str1 === str2 ? 1 : 0;

    let intersection = 0;
    for (const item of bg1) {
        if (bg2.has(item)) intersection++;
    }
    const union = bg1.size + bg2.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

function isSimilar(r1, r2) {
    const prod1 = String(r1[11] || '').trim();
    const prod2 = String(r2[11] || '').trim();
    const ind1 = String(r1[21] || '').trim();
    const ind2 = String(r2[21] || '').trim();

    if (prod1 === prod2 && ind1 === ind2) return true;

    const prodSim = calculateSimilarity(prod1, prod2);
    const indSim = calculateSimilarity(ind1, ind2);

    // If both product and industry are somewhat similar, or one of them is highly similar
    return (prodSim > 0.4 && indSim > 0.4) || (prodSim > 0.7) || (indSim > 0.7);
}

const groups = new Map();

for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // Key: 회사명|시도명|시군구명
    const key = `${row[0]}|${row[1]}|${row[5]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ row, index: i });
}

console.log(`Unique company-location groups: ${groups.size}`);

const keptIndices = new Set();
let removedCount = 0;

for (const [key, items] of groups) {
    for (let i = 0; i < items.length; i++) {
        let isDupeOfFuture = false;
        // Check if there is a later row that is similar
        for (let j = i + 1; j < items.length; j++) {
            if (isSimilar(items[i].row, items[j].row)) {
                isDupeOfFuture = true;
                break;
            }
        }
        if (!isDupeOfFuture) {
            keptIndices.add(items[i].index);
        } else {
            removedCount++;
        }
    }
}

console.log(`Identified ${removedCount} duplicates to remove.`);

const finalRows = [];
finalRows.push(data[0]); // header

for (let i = 1; i < data.length; i++) {
    if (keptIndices.has(i)) {
        finalRows.push(data[i]);
    }
}

console.log(`Final row count: ${finalRows.length}`);

console.log('Writing back to new Excel file...');
const newWb = xlsx.utils.book_new();
const newWs = xlsx.utils.aoa_to_sheet(finalRows);
xlsx.utils.book_append_sheet(newWb, newWs, sheetName);
const outputFile = 'C:\\Users\\gomd9\\nbe\\한국산업단지공단_전국등록공장현황_20200229_정리1_중복제거.xlsx';
xlsx.writeFile(newWb, outputFile);

console.log(`Successfully saved to ${outputFile}`);
