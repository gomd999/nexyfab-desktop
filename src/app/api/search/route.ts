export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

// Note: Ensure the 'data/factories.db' exists in the project root
const DB_PATH = path.join(process.cwd(), 'data', 'factories.db');

/**
 * Score calculation logic ported from search.php
 */
function getScore(item: any, query: string, keywords: string[]) {
    let score = 0;
    
    // Core searchable fields
    const searchFields = [
        item.name, item.name_en, item.name_cn,
        item.product, item.product_en, item.product_ja, item.product_cn,
        item.industry, item.industry_en, item.industry_ja, item.industry_cn,
        item.category, item.category_en, item.category_ja, item.category_cn
    ].map(f => (f ?? '').toLowerCase());

    const lowerQuery = query.toLowerCase();

    // 1. Exact full phrase match (Top priority)
    for (const field of searchFields) {
        if (field === lowerQuery) {
            score += 1000;
        } else if (field.startsWith(lowerQuery)) {
            score += 500;
        } else if (field.includes(lowerQuery)) {
            score += 300;
        }
    }

    // 2. Individual keyword hits frequency and combinations
    let hitCount = 0;
    for (const kw of keywords) {
        const lowerKw = kw.toLowerCase();
        let foundInItem = false;
        for (const field of searchFields) {
            if (field === lowerKw) {
                score += 200;
                foundInItem = true;
            } else if (field.startsWith(lowerKw)) {
                score += 100;
                foundInItem = true;
            } else if (field.includes(lowerKw)) {
                score += 50;
                foundInItem = true;
            }
        }
        if (foundInItem) hitCount++;
    }
    
    // Multi-keyword bonus
    if (hitCount === keywords.length && keywords.length > 1) {
        score += 400; 
    } else if (hitCount > 1) {
        score += (hitCount * 100);
    }

    // 3. Name Match Bonus
    const nameFields = [
        (item.name ?? '').toLowerCase(),
        (item.name_en ?? '').toLowerCase(),
        (item.name_cn ?? '').toLowerCase()
    ];
    for (const nf of nameFields) {
        if (nf === lowerQuery) score += 1000;
        else if (nf.startsWith(lowerQuery)) score += 500;
        else if (nf.includes(lowerQuery)) score += 300;
    }

    return score;
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim() || '';

    if (!q) {
        return NextResponse.json({ ko: [], cn: [] });
    }

    let db: Database.Database;
    try {
        db = new Database(DB_PATH, { readonly: true });
    } catch (err) {
        console.error('Database connection error:', err);
        return NextResponse.json({ error: 'Database error', ko: [], cn: [] }, { status: 500 });
    }

    try {
        const query = q.toLowerCase();
        const keywords = query.split(/\s+/).filter(kw => kw.length > 0);

        const performSearch = (country: 'KO' | 'CN') => {
            let results: any[] = [];
            
            // Attempt 1: Strict AND search (All keywords present)
            const andConditions = keywords.map(() => "search_text LIKE ?").join(' AND ');
            const andParams = keywords.map(kw => `%${kw}%`);
            
            const stmtAnd = db.prepare(`SELECT * FROM factories WHERE country = ? AND (${andConditions}) LIMIT 200`);
            const rowsAnd = stmtAnd.all(country, ...andParams);
            
            rowsAnd.forEach((row: any) => {
                const score = getScore(row, query, keywords);
                if (score > 0) {
                    row.score = score;
                    results.push(row);
                }
            });

            // Attempt 2: Broad OR search (If few results)
            if (results.length < 10 && keywords.length > 1) {
                const orConditions = keywords.map(() => "search_text LIKE ?").join(' OR ');
                const orParams = keywords.map(kw => `%${kw}%`);
                
                // Exclude the AND results to avoid duplicates
                const stmtOr = db.prepare(`SELECT * FROM factories WHERE country = ? AND (${orConditions}) AND NOT (${andConditions}) LIMIT 100`);
                const rowsOr = stmtOr.all(country, ...orParams, ...andParams);
                
                rowsOr.forEach((row: any) => {
                    const score = getScore(row, query, keywords);
                    if (score > 0) {
                        row.score = score;
                        results.push(row);
                    }
                });
            }

            // Sort and Cleanup
            results.sort((a, b) => b.score - a.score);
            return results.slice(0, 40).map(item => {
                const { score, search_text, id, ...rest } = item;
                return rest;
            });
        };

        const results_ko = performSearch('KO');
        const results_cn = performSearch('CN');

        db.close();
        return NextResponse.json({ ko: results_ko, cn: results_cn });

    } catch (err) {
        console.error('Search logic error:', err);
        if (db) db.close();
        return NextResponse.json({ error: 'Search execution error', ko: [], cn: [] }, { status: 500 });
    }
}


