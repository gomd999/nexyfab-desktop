import os
import re

pages = ['project-inquiry', 'partner-register', 'component-order', 'auto-order']
base_dir = r"c:\Users\gomd9\nbe\new\src\app"

for p in pages:
    with open(os.path.join(base_dir, p, f"{p}_html.txt"), 'r', encoding='utf-8') as f:
        html = f.read()

    # Convert classes and standard HTML to React DOM properties
    html = html.replace('class=\"', 'className=\"')
    html = html.replace('for=\"', 'htmlFor=\"')
    html = html.replace('autocomplete=\"', 'autoComplete=\"')
    html = html.replace('tabindex=\"-1\"', 'tabIndex={-1}')
    html = html.replace('enctype=\"', 'encType=\"')
    html = html.replace('required=\"\"', 'required')
    html = html.replace('multiple=\"\"', 'multiple')
    html = html.replace('<br>', '<br />')
    
    html = re.sub(r'rows=\"(\d+)\"', r'rows={\1}', html)
    html = re.sub(r'cols=\"(\d+)\"', r'cols={\1}', html)

    # Convert self-closing tags
    html = re.sub(r'<input([^>]*?[^/])>', r'<input\1 />', html)
    html = re.sub(r'<img([^>]*?[^/])>', r'<img\1 />', html)

    # Remove inline styles and event handlers completely to let custom.css handle it
    html = re.sub(r'style=\"[^\"]*\"', '', html)
    html = re.sub(r'onclick=\"[^\"]*\"', '', html, flags=re.IGNORECASE)
    html = re.sub(r'onsubmit=\"[^\"]*\"', '', html, flags=re.IGNORECASE)
    
    # Restore honeypot hidden style
    html = re.sub(r'<div\s*>\s*<label>Website</label>', r'<div style={{ display: "none" }}>\n<label>Website</label>', html)
    
    # Remove HTML comments (JSX doesn't support them natively)
    html = re.sub(r'<!--.*?-->', '', html, flags=re.DOTALL)

    # Re-wire forms
    if p not in ['component-order', 'auto-order']:
        html = re.sub(r'<form[^>]*>', r'<form className="hat-form" onSubmit={handleSubmit}>', html)
    else:
        html = re.sub(r'<form[^>]*>', r'<form className="hat-form" onSubmit={(e) => e.preventDefault()}>', html)

    comp_name = "".join(word.capitalize() for word in p.split('-')) + "Page"
    
    tsx_lines = [
        "'use client';",
        "",
        "import React, { useState } from 'react';",
        "",
        f"export default function {comp_name}() {{"
    ]

    if p == 'component-order':
        html = re.sub(r'<button className="hat-btn-primary"[^>]*>.*?</button>', 
                      r'<button type="button" className="hat-btn-primary" onClick={handleAddToCart}>➕ BOM 장바구니 추가</button>', 
                      html, flags=re.DOTALL)
        
        tbody_block = """<tbody>
  {cart.length === 0 ? (
    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px' }}>장바구니에 항목이 없습니다.</td></tr>
  ) : (
    cart.map((item, idx) => (
      <tr key={item.id}>
        <td>{idx + 1}</td>
        <td>{item.category}</td>
        <td>{item.itemName}</td>
        <td>{item.specification || '-'}</td>
        <td>{item.quantity}</td>
        <td><button type="button" onClick={() => setCart(cart.filter(c => c.id !== item.id))} className="hat-btn-secondary" style={{padding:'4px 8px'}}>삭제</button></td>
      </tr>
    ))
  )}
</tbody>"""
        html = re.sub(r'<tbody>.*?</tbody>', tbody_block, html, flags=re.DOTALL)
        
        custom_logic = """  const [cart, setCart] = useState<any[]>([]);
  const handleAddToCart = () => {
    const cat = (document.getElementById('catSelect') as HTMLSelectElement)?.value || '';
    const item = (document.getElementById('itemSelect') as HTMLSelectElement)?.value || '';
    const spec = (document.getElementById('specInput') as HTMLInputElement)?.value || '';
    const qty = (document.getElementById('qtyInput') as HTMLInputElement)?.value || '1';
    
    if (!cat || !item) {
        alert('카테고리와 부품명을 선택해주세요.');
        return;
    }
    
    setCart([...cart, { id: Date.now(), category: cat, itemName: item, specification: spec, quantity: qty }]);
  };"""
        tsx_lines.append(custom_logic)
    else:
        custom_logic = """  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setTimeout(() => {
      alert("성공적으로 접수되었습니다.");
      setIsSubmitting(false);
    }, 1500);
  };"""
        tsx_lines.append(custom_logic)

    tsx_lines.append(f"""
  return (
    <main className="hat-section" style={{{{ minHeight: '100vh', backgroundColor: '#f8f9fb', paddingTop: '60px' }}}}>
      {html}
    </main>
  );
}}
""")

    with open(os.path.join(base_dir, p, "page.tsx"), 'w', encoding='utf-8') as f:
        f.write("\n".join(tsx_lines))

print("All components converted successfully.")
