import argparse
import json
import sys


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="islamic-rag")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("build", help="Build quran.db from raw SQL dumps")

    q = sub.add_parser("query", help="Query the Quran index")
    q.add_argument("text")
    q.add_argument("--k", type=int, default=10, help="candidate count (non-judge mode; with --judge the pipeline uses TOP_K from settings)")
    q.add_argument("--lexical", action="store_true", help="FTS5 only, no embeddings")
    q.add_argument("--judge", action="store_true", help="Run LLM judge on candidates")

    sub.add_parser("embed", help="Build dual-vector embedding index")
    sub.add_parser("cost", help="Show OpenRouter usage and remaining budget")

    args = parser.parse_args()
    from .settings import settings

    if args.cmd == "build":
        from .ingest import build

        summary = build(settings)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    elif args.cmd == "embed":
        from .embeddings import build_index

        summary = build_index(settings)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    elif args.cmd == "query":
        from .retrieve import query

        results = query(settings, args.text, k=args.k, lexical_only=args.lexical, judge=args.judge)
        print(json.dumps(results, ensure_ascii=False, indent=2))
    elif args.cmd == "cost":
        from . import store

        con = store.connect(settings.db_path)
        spent = store.total_cost(con)
        rows = con.execute(
            "SELECT model, purpose, COUNT(*) n, SUM(cost_usd) c FROM api_usage "
            "GROUP BY model, purpose"
        ).fetchall()
        print(f"spent_usd={spent:.4f} cap_usd={settings.budget_cap_usd}")
        for r in rows:
            print(f"  {r['model']} [{r['purpose']}] calls={r['n']} cost=${r['c']:.4f}")
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()