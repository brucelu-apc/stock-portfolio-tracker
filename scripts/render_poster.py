import asyncio
from playwright.async_api import async_playwright
import os

async def capture_report():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 800, 'height': 1000})
        
        # Load the generated HTML file
        path = os.path.abspath("report.html")
        await page.goto(f"file://{path}")
        
        # Wait for fonts to load
        await page.wait_for_timeout(2000)
        
        # Take a screenshot
        output_path = "monthly_report.png"
        await page.screenshot(path=output_path, full_page=True)
        full_path = os.path.abspath(output_path)
        print(f"Poster generated: {full_path}")
        print(f"MEDIA: {full_path}")
        
        await browser.close()
        
        # Send to OpenClaw if configured
        send_to_openclaw(full_path)

def send_to_openclaw(file_path):
    import requests
    gateway_url = os.environ.get("OPENCLAW_GATEWAY_URL")
    gateway_token = os.environ.get("OPENCLAW_GATEWAY_TOKEN")
    target_user = os.environ.get("NOTIFICATION_TARGET_ID")

    if not gateway_url or not gateway_token or not target_user:
        return

    print("Sending poster to LINE...")
    # First, we might need to upload it or send as buffer
    # OpenClaw /api/v1/message supports action: send with filePath if local
    # But since this runs on GH Actions, we need to upload it or send as base64
    import base64
    with open(file_path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode('utf-8')
    
    payload = {
        "action": "send",
        "channel": "line",
        "target": target_user,
        "message": "📊 您的本月投資戰報已生成！",
        "buffer": f"data:image/png;base64,{encoded}"
    }
    headers = {"Authorization": f"Bearer {gateway_token}"}
    try:
        requests.post(f"{gateway_url}/api/v1/message", json=payload, headers=headers)
        print("Poster sent successfully.")
    except Exception as e:
        print(f"Error sending poster: {e}")

if __name__ == "__main__":
    asyncio.run(capture_report())
