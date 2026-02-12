"""
Quick integration test for the notification parser.
Reads the actual sample notification file and validates parsing.
"""
import sys
import json
sys.path.insert(0, '/sessions/upbeat-eager-goldberg/stock-portfolio-tracker/backend')

from app.parser.notification_parser import parse_notification
from app.models.schemas import MessageType

# Read the actual sample file
with open('/sessions/upbeat-eager-goldberg/mnt/Stock_Notify/Stock_Notification.txt', 'r', encoding='utf-8') as f:
    sample_text = f.read()

# Parse
result = parse_notification(sample_text)

print("=" * 60)
print(f"Parse Result Summary")
print("=" * 60)
print(f"Success:          {result.success}")
print(f"Total messages:   {result.total_messages}")
print(f"Total stocks:     {result.total_stocks}")
print(f"Dates found:      {result.dates_found}")
print()

# Count message types
type_counts = {}
for msg in result.messages:
    t = msg.message_type
    type_counts[t] = type_counts.get(t, 0) + 1

print("Message Type Breakdown:")
for t, count in sorted(type_counts.items()):
    print(f"  {t:25s} → {count}")
print()

# List all unique stocks with their data
print("Extracted Stocks:")
print("-" * 60)
seen = set()
for msg in result.messages:
    for stock in msg.stocks:
        if stock.ticker not in seen:
            seen.add(stock.ticker)
            parts = [f"  {stock.name}({stock.ticker})"]
            if stock.defense_price:
                parts.append(f"防守={stock.defense_price}")
            if stock.min_target_low:
                parts.append(f"最小={stock.min_target_low}~{stock.min_target_high}")
            if stock.reasonable_target_low:
                parts.append(f"合理={stock.reasonable_target_low}~{stock.reasonable_target_high}")
            if stock.entry_price:
                parts.append(f"買進<{stock.entry_price}")
            if stock.strategy_notes:
                parts.append(f"[{stock.strategy_notes[:30]}]")
            print("  ".join(parts))

print()
print(f"Total unique stocks: {len(seen)}")

# Validate specific expected stocks
print()
print("=" * 60)
print("Validation Checks:")
print("=" * 60)
expected_stocks = {
    '2393': {'name': '億光', 'defense': 53.0},
    '2363': {'name': '矽統'},
    '6271': {'name': '同欣電', 'defense': 130.0},
    '2455': {'name': '全新', 'defense': 150.0},
    '2454': {'name': '聯發科', 'defense': 1690.0},
}

stock_map = {}
for msg in result.messages:
    for stock in msg.stocks:
        if stock.ticker not in stock_map:
            stock_map[stock.ticker] = stock

pass_count = 0
fail_count = 0
for ticker, expected in expected_stocks.items():
    stock = stock_map.get(ticker)
    if not stock:
        print(f"  FAIL: {ticker} not found!")
        fail_count += 1
        continue

    ok = True
    if 'defense' in expected and stock.defense_price != expected['defense']:
        print(f"  FAIL: {ticker} defense_price expected {expected['defense']}, got {stock.defense_price}")
        ok = False
        fail_count += 1

    if ok:
        print(f"  PASS: {ticker} ({stock.name}) ✓")
        pass_count += 1

print()
print(f"Results: {pass_count} passed, {fail_count} failed")
