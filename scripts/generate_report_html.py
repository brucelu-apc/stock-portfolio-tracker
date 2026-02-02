#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "supabase>=2.3.0",
# ]
# ///
import os
import json
from supabase import create_client, Client
from datetime import datetime

def get_report_data():
    url = os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if not url or not key:
        # Mock data for demonstration if credentials missing
        return {
            "month": "February 2026",
            "total_value": "2,328,320",
            "pnl": "+401,040",
            "roi": "+20.81%",
            "top_holdings": [
                {"ticker": "2330.TW", "value": 2130000},
                {"ticker": "AAPL", "value": 150000},
                {"ticker": "00965.TW", "value": 102120}
            ],
            "is_profit": True
        }

    supabase: Client = create_client(url, key)

    # Fetch holdings
    holdings_res = supabase.table("portfolio_holdings").select("*").execute()
    # Fetch market data
    market_res = supabase.table("market_data").select("*").execute()
    
    price_map = {item['ticker']: item['current_price'] for item in market_res.data}
    fx_rate = price_map.get('USDTWD', 32.5)

    # Process Data
    total_cost = 0
    total_value = 0
    symbols = []

    for h in holdings_res.data:
        curr_p = float(price_map.get(h['ticker'], h['cost_price']))
        val = curr_p * float(h['shares'])
        cost = float(h['cost_price']) * float(h['shares'])
        
        if h['region'] == 'US':
            val *= fx_rate
            cost *= fx_rate
            
        total_value += val
        total_cost += cost
        symbols.append({"ticker": h['ticker'], "value": val})

    pnl = total_value - total_cost
    roi = (pnl / total_cost * 100) if total_cost > 0 else 0
    
    # Sort top 3
    top_holdings = sorted(symbols, key=lambda x: x['value'], reverse=True)[:3]

    return {
        "month": datetime.now().strftime("%B %Y"),
        "total_value": f"{total_value:,.0f}",
        "pnl": f"{pnl:+,.0f}",
        "roi": f"{roi:+.2f}%",
        "top_holdings": top_holdings,
        "is_profit": pnl >= 0
    }

def generate_html(data):
    pnl_color = "#E53E3E" if "-" in data['pnl'] else "#d4af37" # Gold for profit in luxury theme
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;700&display=swap');
            body {{
                width: 800px; height: 1000px;
                margin: 0; padding: 60px;
                background-color: #064e3b; /* Deep Green */
                color: #fffff0; /* Ivory */
                font-family: 'Inter', sans-serif;
                display: flex; flex-direction: column;
                box-sizing: border-box;
                border: 20px solid #d4af37; /* Gold Border */
            }}
            .header {{
                text-align: center;
                border-bottom: 2px solid #d4af37;
                padding-bottom: 30px;
                margin-bottom: 50px;
            }}
            h1 {{
                font-family: 'Playfair Display', serif;
                font-size: 50px;
                margin: 0;
                color: #d4af37;
                text-transform: uppercase;
                letter-spacing: 4px;
            }}
            .subtitle {{ font-size: 18px; opacity: 0.8; margin-top: 10px; }}
            .main-stat {{
                background: rgba(255, 255, 240, 0.05);
                padding: 40px;
                border-radius: 10px;
                text-align: center;
                margin-bottom: 50px;
            }}
            .total-label {{ font-size: 20px; color: #d4af37; text-transform: uppercase; }}
            .total-value {{ font-size: 80px; font-weight: 700; margin: 20px 0; }}
            .pnl-row {{ display: flex; justify-content: center; gap: 40px; font-size: 24px; }}
            .pnl-value {{ color: {pnl_color}; font-weight: bold; }}
            .section-title {{
                color: #d4af37;
                font-size: 22px;
                border-left: 4px solid #d4af37;
                padding-left: 15px;
                margin-bottom: 30px;
                text-transform: uppercase;
            }}
            .holding-item {{
                display: flex; justify-content: space-between;
                padding: 20px 0;
                border-bottom: 1px solid rgba(212, 175, 55, 0.2);
            }}
            .footer {{
                margin-top: auto;
                text-align: center;
                font-size: 14px;
                color: #d4af37;
                opacity: 0.6;
            }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1>Investment Report</h1>
            <div class="subtitle">{data['month']} • 私人資產月度回顧</div>
        </div>
        
        <div class="main-stat">
            <div class="total-label">Current Portfolio Value (TWD)</div>
            <div class="total-value">${data['total_value']}</div>
            <div class="pnl-row">
                <div>Profit/Loss: <span class="pnl-value">{data['pnl']}</span></div>
                <div>ROI: <span class="pnl-value">{data['roi']}</span></div>
            </div>
        </div>

        <div class="section-title">Top Strategic Holdings</div>
        <div class="holdings-list">
            {"".join([f'<div class="holding-item"><span>{h["ticker"]}</span><span>${h["value"]:,.0f}</span></div>' for h in data['top_holdings']])}
        </div>

        <div class="footer">
            Generated by Little Dumpling AI Assistant • Confidential
        </div>
    </body>
    </html>
    """
    return html

if __name__ == "__main__":
    import sys
    data = get_report_data()
    if data:
        print(generate_html(data))
    else:
        print("Error: No data returned from get_report_data", file=sys.stderr)
        sys.exit(1)
