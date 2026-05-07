import json
import sqlite3
import os

def convert():
    json_path = r'c:\Users\gomd9\nbe\new\public\data\factories.json'
    db_path = r'c:\Users\gomd9\nbe\new\public\data\factories.db'
    
    if os.path.exists(db_path):
        os.remove(db_path)
        
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create tables
    cursor.execute('''
    CREATE TABLE factories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country TEXT,
        name TEXT,
        name_en TEXT,
        name_cn TEXT,
        name_ja TEXT,
        product TEXT,
        product_en TEXT,
        product_ja TEXT,
        product_cn TEXT,
        industry TEXT,
        industry_en TEXT,
        industry_ja TEXT,
        industry_cn TEXT,
        industry_code TEXT,
        category TEXT,
        category_en TEXT,
        category_ja TEXT,
        category_cn TEXT,
        address TEXT,
        address_en TEXT,
        address_ja TEXT,
        address_cn TEXT,
        search_text TEXT
    )
    ''')
    
    print("Loading JSON...")
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    print("Inserting data...")
    
    def get_search_text(item):
        fields = [
            item.get('name'), item.get('name_en'), item.get('name_cn'),
            item.get('product'), item.get('product_en'), item.get('product_ja'), item.get('product_cn'),
            item.get('industry'), item.get('industry_en'), item.get('industry_ja'), item.get('industry_cn'),
            item.get('category'), item.get('category_en'), item.get('category_ja'), item.get('category_cn'),
            item.get('industry_code')
        ]
        return " ".join([str(f).lower() for f in fields if f]).strip()

    count = 0
    # Process KO
    for item in data.get('ko', []):
        search_text = get_search_text(item)
        cursor.execute('''
        INSERT INTO factories (
            country, name, name_en, name_cn, name_ja,
            product, product_en, product_ja, product_cn,
            industry, industry_en, industry_ja, industry_cn, industry_code,
            address, address_en, address_ja, address_cn,
            search_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            'KO', item.get('name'), item.get('name_en'), item.get('name_cn'), item.get('name_ja'),
            item.get('product'), item.get('product_en'), item.get('product_ja'), item.get('product_cn'),
            item.get('industry'), item.get('industry_en'), item.get('industry_ja'), item.get('industry_cn'), item.get('industry_code'),
            item.get('address'), item.get('address_en'), item.get('address_ja'), item.get('address_cn'),
            search_text
        ))
        count += 1
        if count % 10000 == 0:
            print(f"Processed {count} items...")

    # Process CN
    for item in data.get('cn', []):
        search_text = get_search_text(item)
        cursor.execute('''
        INSERT INTO factories (
            country, name, name_en, name_cn, name_ja,
            product, product_en, product_ja, product_cn,
            category, category_en, category_ja, category_cn,
            address, address_en, address_ja, address_cn,
            search_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            'CN', item.get('name'), item.get('name_en'), item.get('name_cn'), item.get('name_ja'),
            item.get('product'), item.get('product_en'), item.get('product_ja'), item.get('product_cn'),
            item.get('category'), item.get('category_en'), item.get('category_ja'), item.get('category_cn'),
            item.get('address'), item.get('address_en'), item.get('address_ja'), item.get('address_cn'),
            search_text
        ))
        count += 1
        if count % 10000 == 0:
            print(f"Processed {count} items...")

    print("Creating index...")
    cursor.execute('CREATE INDEX idx_search ON factories(search_text)')
    
    conn.commit()
    conn.close()
    print(f"Successfully converted {count} items to SQLite!")

if __name__ == '__main__':
    convert()
