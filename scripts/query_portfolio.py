#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "supabase>=2.3.0",
# ]
# ///
import os
import sys
import argparse
import json
from supabase import create_client, Client

def main():
    parser = argparse.ArgumentParser(description="Query portfolio data from Supabase")
    parser.add_argument("--action", choices=["list_holdings", "get_market_data", "raw_query"], required=True)
    parser.add_argument("--query", help="Optional query string or filter")
    
    args = parser.parse_args()
    
    url = os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if not url or not key:
        print(json.dumps({"error": "Missing Supabase credentials"}))
        sys.exit(1)

    supabase: Client = create_client(url, key)

    try:
        if args.action == "list_holdings":
            res = supabase.table("portfolio_holdings").select("*").execute()
            print(json.dumps(res.data, indent=2))
        
        elif args.action == "get_market_data":
            res = supabase.table("market_data").select("*").execute()
            print(json.dumps(res.data, indent=2))
            
        elif args.action == "raw_query":
            # Very basic filter proxy for safety
            res = supabase.table("portfolio_holdings").select("*").filter("ticker", "eq", args.query).execute()
            print(json.dumps(res.data, indent=2))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
