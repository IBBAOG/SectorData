"""
One-shot script to query Resend Email API for the status of one or more message IDs.

Usage (from GHA or locally):
  python scripts/utils/resend_status_check.py <id1> [<id2> ...]

Prints structured output:
  ID=<id> status=<...> created_at=<...> last_event=<...> bounced_reason=<...>

Requires RESEND_API_KEY in env.
"""
import os
import sys
import json
import requests

API_BASE = "https://api.resend.com"


def main():
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        print("ERROR: RESEND_API_KEY not set in env", file=sys.stderr)
        sys.exit(1)

    ids = sys.argv[1:]
    if not ids:
        print("ERROR: pass at least one message id", file=sys.stderr)
        sys.exit(2)

    headers = {"Authorization": f"Bearer {api_key}"}
    rc = 0
    for mid in ids:
        url = f"{API_BASE}/emails/{mid}"
        try:
            r = requests.get(url, headers=headers, timeout=30)
        except Exception as e:
            print(f"ID={mid} status=ERROR error={e}")
            rc = 1
            continue
        if r.status_code != 200:
            print(f"ID={mid} status=HTTP_{r.status_code} body={r.text[:300]}")
            rc = 1
            continue
        try:
            data = r.json()
        except Exception:
            print(f"ID={mid} status=PARSE_ERROR body={r.text[:300]}")
            rc = 1
            continue
        # Extract everything relevant
        print(f"ID={mid}")
        print(f"  status_field        : {data.get('last_event') or data.get('status')}")
        print(f"  created_at          : {data.get('created_at')}")
        print(f"  to                  : {data.get('to')}")
        print(f"  from                : {data.get('from')}")
        print(f"  subject             : {data.get('subject')}")
        print(f"  last_event          : {data.get('last_event')}")
        print(f"  bounce              : {json.dumps(data.get('bounce'), default=str)}")
        print(f"  full_response       : {json.dumps(data, default=str)[:1500]}")
        print("")
    sys.exit(rc)


if __name__ == "__main__":
    main()
