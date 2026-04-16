const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

function cleanRegionEn(text) {
    if (!text) return '';
    let s = text.toString();
    s = s.replace(/\s*(Special City|Metropolitan City|Province|City|District|County|-gu|-do|-si|-gun)\b/gi, '');
    return s.trim();
}

function cleanIndustryEn(text) {
    if (!text) return '';
    let s = text.toString().toLowerCase();

    // Remove "and X other types"
    s = s.replace(/,\s*and\s+\d+\s+other\s+(types|items|kinds|products)/gi, '');
    s = s.replace(/\s+and\s+\d+\s+other\s+(types|items|kinds|products)/gi, '');

    // Remove industry terms
    s = s.replace(/\b(industry|manufacturing|manufacture|manufacturing of|manufacture of)\b/gi, '');

    // Trim and remove leading "of"
    s = s.trim().replace(/^of\s+/i, '');

    // Capitalize Each Word
    return s.split(/\s+/).filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function processKoreanFile(file) {
    console.log('Processing Korean file...');
    const wb = xlsx.readFile(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    // Skip header (row 0)
    const results = [];
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row[0]) continue;

        const regionEn = cleanRegionEn(row[2]);
        const districtEn = cleanRegionEn(row[6]);
        const addressEn = [regionEn, districtEn].filter(Boolean).join(', ');

        results.push({
            country: 'KO',
            name: row[0] || '',
            name_en: '',
            name_ja: '',
            name_cn: '',
            product: row[11] || '',
            product_en: cleanIndustryEn(row[12]),
            product_ja: row[13] || '',
            product_cn: row[14] || '',
            industry: row[21] || '',
            industry_en: cleanIndustryEn(row[22]),
            industry_ja: row[23] || '',
            industry_cn: row[24] || '',
            industry_code: row[20] || '',
            address: row[9] || '',
            address_en: addressEn,
            address_ja: (row[3] || '') + ' ' + (row[7] || ''),
            address_cn: (row[4] || '') + ' ' + (row[8] || '')
        });
    }
    return results;
}

function processChineseFile(file) {
    console.log('Processing Chinese file...');
    const wb = xlsx.readFile(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    const results = [];
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row[4]) continue;
        results.push({
            country: 'CN',
            name: row[4] || '',
            nameEn: row[5] || '',
            name_en: row[5] || '',
            name_cn: row[4] || '',
            category: row[3] || '',
            category_cn: row[0] || '',
            category_en: cleanIndustryEn(row[1]),
            category_ja: row[2] || '',
            product: row[19] || '', // Korean description of product
            product_cn: row[18] || '',
            product_en: cleanIndustryEn(row[20]),
            product_ja: row[21] || '',
            address: (row[11] || '') + ' ' + (row[12] || ''),
            address_en: [cleanRegionEn(row[13]), cleanRegionEn(row[14])].filter(Boolean).join(', ')
        });
    }
    return results;
}

const koFile = 'C:\\Users\\gomd9\\nbe\\한국산업단지공단_전국등록공장현황_20200229_최종번역.xlsx';
const cnFile = 'C:\\Users\\gomd9\\nbe\\china factory list(0131) 1.xlsx';

const koData = processKoreanFile(koFile);
const cnData = processChineseFile(cnFile);

const allData = {
    ko: koData,
    cn: cnData
};

const outputDir = path.join(__dirname, 'public', 'data');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(path.join(outputDir, 'factories.json'), JSON.stringify(allData));
console.log('Processed successfully!');
