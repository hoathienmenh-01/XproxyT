from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.goto('http://127.0.0.1:8080/providers')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)
    page.screenshot(path='providers_page.png', full_page=True)
    
    # Check if Accounts & API Keys section exists
    content = page.content()
    if 'Accounts & API Keys' in content:
        print("SUCCESS: Accounts & API Keys section found!")
    else:
        print("MISSING: Accounts & API Keys section NOT found")
    
    if 'Thêm Tài Khoản' in content:
        print("SUCCESS: 'Thêm Tài Khoản' button found!")
    else:
        print("MISSING: 'Thêm Tài Khoản' button NOT found")
    
    # Also check API endpoint
    response = page.evaluate("async () => { try { const r = await fetch('/api/config'); const d = await r.json(); return JSON.stringify(d.providers?.map(p => ({id: p.id, hasAccounts: !!p.accounts?.length, accountsCount: p.accounts?.length || 0, hasCredentials: !!p.credentials}))); } catch(e) { return e.message; } }")
    print(f"API Config providers: {response}")
    
    browser.close()