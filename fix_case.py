import os, re
target = r'c:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\src'
for root, dirs, files in os.walk(target):
    for file in files:
        if file.endswith('.tsx'):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            new_content = re.sub(r'id="nexyfab-', 'id="Nexyfab-', content)
            if new_content != content:
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print('Fixed:', path)
