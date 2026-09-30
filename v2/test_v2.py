import json
from pathlib import Path
from radar44_v2 import enrich_articles

payload = json.loads(Path("sample_v2_input.json").read_text(encoding="utf-8"))
out = enrich_articles(payload)

assert out["articles"][0]["origin_type"] == "INSTITUTIONAL"
assert out["articles"][1]["author_name"] == "Alice Martin"
assert out["event_origins"]["evt1"]["origin_article_external_key"] == "a1"
assert out["event_origins"]["evt1"]["confidence"] >= 0.72

print("Radar44 V2 tests: OK")
print(json.dumps(out["event_origins"], ensure_ascii=False, indent=2))
