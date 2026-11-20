# ایجنت پژوهشگر مستند دینی (Agentic Grounded RAG)

> این سند لایه‌ی ایجنت را شرح می‌دهد که روی هسته‌ی بازیابی/داوریِ موجود ساخته شده است.
> هسته‌ی تک‌مرحله‌ای در [`retrieval-and-verification.md`](retrieval-and-verification.md) و معماری کلان در [`architecture.md`](architecture.md) مستند است.
> اصل بنیادین unchanged: **LLM هرگز متن مقدس تولید نمی‌کند؛ متن نهایی بایت‌به‌بایت از دیتابیس واکشی می‌شود.**

## فهرست

- [از تک‌مرحله‌ای تا ایجنت](#از-تکمرحلهای-تا-ایجنت)
- [تضمین‌های ضد توهم (grounding)](#تضمینهای-ضد-توهم-grounding)
- [امنیت BYOK](#امنیت-byok)
- [رجیستری منابع (SourceRegistry)](#رجیستری-منابع-sourceregistry)
- [ارکستراتور: حالت سریع و پژوهش عمیق](#ارکستراتور-حالت-سریع-و-پژوهش-عمیق)
- [قرارداد رویدادهای SSE](#قرارداد-رویدادهای-sse)
- [رابط کاربری React](#رابط-کاربری-react)
- [حافظه‌ی چند‌نوبتی (sessions)](#حافظهی-چندنوبتی-sessions)
- [چهار اصلاح هسته‌ی استدلال](#چهار-اصلاح-هستهی-استدلال)
- [تشخیص زنده‌ی سبد شواهد خالی](#تشخیص-زندهی-سبد-شواهد-خالی)
- [اعداد اندازه‌گیری‌شده](#اعداد-اندازهگیری شده)
- [اجرا](#اجرا)
- [محدودیت‌های صادقانه](#محدودیتهای-صادقانه)

## از تک‌مرحله‌ای تا ایجنت

هسته‌ی پیشین یک RAG تک‌مرحله‌ای بود: `pipeline.answer()` یک گزاره می‌گیرد، یک‌بار بازیابی ترکیبی می‌کند، کاندیدها را به داور می‌دهد و چهار بخش `main/supporting/opposing/unverified` را برمی‌گرداند. توهم متنی آن ساختاراً ۰٪ است، اما استدلال چندمرحله‌ای، حافظه‌ی گفت‌وگو و رجیستری منبع-agnostic نداشت.

لایه‌ی ایجنت هسته را **به‌عنوان ابزار** صدا می‌زند (دور نمی‌ریزد):

- `pipeline._hydrate` همان سازنده‌ی بایت‌دقیق evidence است و برای `evidence_payload` دوباره استفاده می‌شود.
- `judge.SYSTEM_PROMPT` و `CONTEXT_RULE` بایت‌به‌بایت ثابت ماندند (هش آن‌ها در `_config_signature` است).
- `judge.call_judge` دو پارامتر افزودنی گرفت: `client` (کلاینت BYOK) و `enforce_budget` (در runtime ایجنت `False`، در eval/آفلاین `True`). اگر `client=None` باشد مسیر OpenRouter پیشین دست‌نخورده می‌ماند.
- `retrieve.hybrid_candidates` فیلتر `sources` و فیلد `Candidate.source` گرفت.
- `pipeline.answer()` به چهار مرحله‌ی `retrieve_stage`/`judge_stage`/`hydrate_stage`/`build_meta` تفکیک شد ولی امضا و شکل خروجی ثابت ماند تا eval/کش/endpoint قدیمی نشکنند.

ماژول‌های جدید:

```text
src/islamic_rag/
  llm/        client.py (BYOK OpenAI-compatible) · providers.py · sanitize.py
  sources/    registry.py · quran.py · base.py (Source protocol)
  agent/      orchestrator.py · tools.py · prompts.py · refs.py · trace.py
  session/    store.py (data/sessions.db)
web/
  api_agent.py  (SSE router) · runtime.py (settings + INFER_LOCK)
  frontend/     (React + Vite + TypeScript + Tailwind + zustand)
```

## تضمین‌های ضد توهم (grounding)

تضمین ۰٪ فقط برای **متن و انتسابِ scripture** است (ساختاری)، نه برای نثرِ استدلالی فارسی (که اندازه‌گیری می‌شود، ادعا نمی‌شود).

1. **ممنوعیت مطلق تایپ scripture:** `REASONER_SYSTEM_PROMPT` به مدل دستور می‌دهد هرگز متن عربی قرآن/حدیث را تایپ، بازنویسی یا paraphrase نکند. تنها راه استناد، تگ درون‌خطی `[[REF:doc_id]]` است که `doc_id` آن باید از دیکشنری EVIDENCE بیاید.
2. **پاک‌سازی سمت سرور (`ArabicStrippingSanitizer`):** اگر مدل برخلاف prompt متن عربی تایپ کند، سرور آن را حذف می‌کند؛ فقط `[[REF:…]]` معتبر عبور می‌کند. `redact_secrets` نیز الگوی کلید (`sk-…`) را از خروجی/لاگ/خطا حذف می‌کند.
3. **اعتبارسنجی جمله‌به‌جمله (`refs.clean_answer`):** پس از پاک‌سازی، متن به جمله‌ها شکسته می‌شود (`[.!?؟\n]`). هر جمله‌ای که حتی یک `[[REF:id]]` خارج از `approved_ids` داشته باشد، **کل جمله حذف می‌شود** — نه فقط تگ — تا جای خالی («آیه  به مواردی اشاره دارد») باقی نماند. تگ‌های معتبر برای رندر کارت سمت کلاینت حفظ می‌شوند.
4. **گاردریل سبد خالی:** اگر پس از داوری `evidence` خالی باشد، ارکستراتور **اصلاً Reasoner را صدا نمی‌زند** و مستقیم پیام صادقانه برمی‌گرداند: «هیچ آیه‌ی تأییدشده‌ای در پایگاه داده برای این گزاره یافت نشد.» این از انشای مدل از دانش خودش جلوگیری می‌کند.
5. **قفل grounding (بدون دانش بیرونی):** prompt صریحاً می‌گوید «تفسیر، فقه یا روایاتی که در لیست EVIDENCE نیستند را مطلقاً نیاور. تنها و تنها ترجمه آیات موجود در EVIDENCE را به هم پیوند بده و هر جمله استدلالی باید مستقیماً از متن همان آیه استخراج شده باشد.» عبارت‌هایی مثل «بر اساس برخی تفاسیر»، «در روایات آمده»، «حفظ آبرو و جلوگیری از فتنه» ممنوع‌اند.
6. **واکشی بایت‌دقیق:** هر `evidence_payload` از `registry.hydrate → _hydrate` می‌آید؛ `text_display`/`translation_fa`/`context` مستقیماً از SQLite خوانده می‌شوند، نه از LLM.
7. **رندر فقط از دیکشنری:** سمت کلاینت هر `[[REF:doc_id]]` تنها در صورتی به کارت تبدیل می‌شود که `doc_id` در evidence dictionary باشد؛ در غیر این صورت نشان «ردشده» نمایش داده می‌شود، نه متن جعلی.

## امنیت BYOK

- **کلید فقط از هدر `X-LLM-Key`** می‌آید؛ هرگز در URL/body/SSE/لاگ/خطا نمی‌رود و سمت سرور persist نمی‌شود.
- runtime هرگز از کلید پروژه (`settings.openrouter_api_key`) استفاده نمی‌کند. تنها مسیر eval/آفلاین مجاز به کلید `.env` است.
- `OpenAICompatClient` کلید را در `SecretStr` نگه می‌دارد (`repr=False`)، `trust_env=False` (quirkِ `NO_PROXY` شامل `[::1]`)، retry با backoff برای ۴۲۹/۵xx و سقف انتظار ۳۰ ثانیه، و هر خطا را با `redact_secrets` پاک می‌کند.
- providerها: `openrouter` (`https://openrouter.ai/api/v1`)، `google` (`https://generativelanguage.googleapis.com/v1beta/openai`)، `openai` (`https://api.openai.com/v1`). مدل پیش‌فرض openrouter: `google/gemini-2.5-flash-lite`.
- سمت کلاینت: کلید پیش‌فرض در `sessionStorage` (نه localStorage)، ورودی masked، هرگز در تاریخچه/اکسپورت.

## رجیستری منابع (SourceRegistry)

- کلید رجیستری = مقدار ستون `records.source` (`"quran"`)، **نه** `sources.id` (`"quran.uthmani"`).
- `doc_id` استاندارد = `source:section:item` → قرآن: `quran:{sura}:{aya}`.
- پروتکل `Source`: `search`، `get_context`، `hydrate`، `validate_ref`، `tier`، `external_url`.
- `QuranSource` این‌ها را با توابع موجود پیاده می‌کند؛ `external_url = https://quran.com/{sura}/{aya}`.
- **سلسله‌مراتب معرفتی:** `tier=1` قرآن (حاکم)، `tier=2` حدیث معتبر (مبیّن/مخصّص/مصداق، نه ناسخ). فعلاً فقط `QuranSource` ثبت شده؛ افزودن منبع جدید = ثبت یک آداپتور، بدون تغییر ارکستراتور/فرانت‌اند.
- **جایگاه آینده‌ی تفسیر:** `evidence_payload` از همین حالا فیلد `tafsir_snippet: str | null = null` دارد (همیشه `null`). وقتی بعداً `TafsirSource` ثبت شود، همین فیلد بدون هیچ تغییر در قرارداد SSE پر می‌شود و در hover popover و کشو می‌نشیند. هیچ scrape/ترجمه‌ی تفسیر انجام نشده است.

## ارکستراتور: حالت سریع و پژوهش عمیق

`run_agent(settings, registry, client, message, *, deep_research=False, sources=None, emit=None, history=None, cancel_event=None)`.

**حالت سریع (`deep_research=false`، پیش‌فرض):** یک Planner + یک بازیابی RRF سبک روی زیرپرسش `core` + یک Judge + یک Reasoner. **بدون Gap-loop و بدون reranker** تا تأخیر گفت‌وگوی عادی پایین بماند. `hops_used=1`.

**پژوهش عمیق (`deep_research=true`):** حلقه‌ی حداکثر ۳ hop (`agent_max_hops=3`):

1. **Hop 1 — Proof-Tree Decomposition:** planner گزاره را به زیرپرسش‌های `core`/`conditions`/`instance` می‌شکند؛ برای هرکدام یک بازیابی سبک (`hop_retrieval_pool=40`, `hop_top_k=8`, بدون reranker).
2. **Gap detection + Counter-Evidence:** داورِ شکاف، حلقه‌های منطقی مفقود (حکم بدون قید/استثنا) و عامدانه آیات مقیّد/مخالف را جست‌وجو می‌کند تا یک‌سویه نباشد.
3. **Hop 2/3 — Iterative + Citation Chaining:** پرکردن شکاف‌ها؛ اگر شاهدی به آیه‌ی دیگر ارجاع دهد `get_verse_context` خودکار (`prev_id`/`next_id`). سقف سخت ۳ hop.
4. **مرحله‌ی نهایی:** اجتماع کاندیدهای همه‌ی hopها (dedup by id) → اگر `deep_research` و وزن‌های reranker کامل باشند rerank سنگین (CPU ~۸۰s) → `call_judge` (client BYOK، `enforce_budget=False`) → برچسب‌های APPROVED (`Direct_Match`/`Conditional_Match`/`Contradiction`) → `registry.hydrate` → evidence dictionary. سپس Reasoner نثر فارسی را با `[[REF:doc_id]]` تولید می‌کند.

ابزارها (`agent/tools.py`): `retrieve_evidence` (hop سبک)، `get_verse_context` (آیه + همسایه‌ها)، `concordance` (همان `/api/concordance` موجود). لغو با `threading.Event` هنگام قطع کلاینت؛ کار سنگین زیر `INFER_LOCK` مشترک تا مدل‌ها هم‌زمان بار نشوند (محدودیت RAM).

## قرارداد رویدادهای SSE

`POST /api/agent/chat` → `text/event-stream`. هدر `X-LLM-Key`؛ body: `{session_id?, message, sources?, provider?, model?, deep_research?}`. هر رویداد `event: <name>\ndata: <json>\n\n`:

| event | data (خلاصه) | چه زمانی |
|---|---|---|
| `session` | `{session_id}` | شروع |
| `thinking_step` | `{hop, phase, title, detail, queries?}` | هر گام (planning/retrieval/gap/chain/final) |
| `evidence_payload` | `{doc_id, ids, address, surah_name, sura, aya_start, aya_end, label, reason, score, rrf_score, rerank_score, signals, text_display, translation_fa, revelation_place, page, juz, context:{before,after}, tier, external_url, tafsir_snippet:null}` | هر شاهد APPROVED (از `_hydrate`) |
| `text_delta` | `{delta}` | تکه‌های نثر فارسی Reasoner |
| `ref_rejected` | `{doc_id, reason}` | تگ REF نامعتبر/ردشده |
| `cost` | `{prompt_tokens, completion_tokens, model}` | پس از هر فراخوانی LLM (بدون کلید) |
| `done` | `{message_id, latency_s, hops_used}` | پایان موفق |
| `error` | `{code, message, detail}` | خطا (پیام فارسی، بدون کلید/عربی خام) |

endpointهای موجود `/api/verse`، `/api/concordance`، `/api/status`، `/api/translators`، `/api/eval` دست‌نخورده برای کشو/داشبورد دوباره استفاده می‌شوند. endpointهای sessions: `GET /api/agent/sessions`، `GET /api/agent/sessions/{id}`، `DELETE /api/agent/sessions/{id}`، `GET /api/agent/providers`.

## رابط کاربری React

`web/frontend/` — React 18 + Vite 5 + TypeScript 5.5 + Tailwind 3 + zustand 4 + vitest 2. جایگزین vanilla پیشین (`web/templates/index.html` + `web/static/` به‌عنوان fallback وقتی `dist/` ساخته نشده باقی می‌مانند). تم روشن/گرم/RTL: پس‌زمینه `#F9F8F6`، کارت `#FFFFFF`، متن `#272932`؛ لهجه‌ها سبز `#2E6F5E` (main)، کهربایی `#9A6700` (supporting)، رز `#A63A3A` (opposing)، نیلی `#3B4D7A` (unverified). فونت Vazirmatn (نثر/UI) + Amiri (`.quran-text`).

اجزا: `Sidebar` (تاریخچه، چت جدید، انتخاب منبع، تنظیمات BYOK)، `ThinkingAccordion` (trace واقعی، پس از `done` جمع می‌شود)، `InlineCitationCard`/`CitationChip` (کارت بایت‌دقیق، popover «نقش در استدلال» + `tafsir_snippet` فعلاً null، لینک quran.com، کپی استناد)، `EvidenceDrawer` (آیات قبل/بعد، تعویض مترجم، واژه‌یابی concordance، تاگل اعراب)، `Composer` (سوئیچ حالت سریع/پژوهش عمیق، لغو SSE، نمایش هزینه/تأخیر)، `SettingsPanel` (provider/model/key masked).

**بافرینگ REF across-packet:** پارسر `[[REF:doc_id]]` در `text_delta` تگ را میان بسته‌های SSE بافر می‌کند؛ تا وقتی `]]` بسته نشده، تگ خام هرگز لحظه‌ای در صفحه چشمک نمی‌زند. متن فارسیِ غیرِ REF بی‌درنگ استریم می‌شود. کیفیت: responsive تا موبایل، `focus-visible`، `prefers-reduced-motion`، RTL کامل.

## حافظه‌ی چند‌نوبتی (sessions)

`session/store.py` روی `data/sessions.db` پیام‌ها + شواهد + meta را per session نگه می‌دارد. hop بعدی تاریخچه را در context دارد (`reasoner_user(..., history)`). تاریخچه در UI از `GET /api/agent/sessions` خوانده و پس از reload ماندگار است.

## چهار اصلاح هسته‌ی استدلال

پس از اجرای زنده با کلید BYOK کاربر، چهار باگ اصلاح شد:

1. **جای خالی به‌جای REF + سبد خالی:** گاردریل سبد خالی (Reasoner صدا زده نمی‌شود) + حذف جمله‌به‌جمله در `refs.clean_answer` (کل جمله‌ی حاوی تگ نامعتبر حذف می‌شود، نه جای خالی).
2. **قفل grounding:** بند `GROUNDING LOCK — NO EXTERNAL KNOWLEDGE` با عبارت دقیق کاربر + ممنوعیت عبارت‌های کلیشه‌ای/بیرونی به `REASONER_SYSTEM_PROMPT` افزوده شد.
3. **سرعت حالت سریع:** مسیر `deep_research=false` به یک Planner + یک بازیابی + یک Judge + یک Reasoner محدود شد (بدون Gap-loop/reranker)؛ رفت‌وبرگشت LLM از ~۶ به ۳ و بازیابی‌ها از ~۵ به ۱ کاهش یافت. فقط `deep_research=true` از ۳ hop و reranker استفاده می‌کند.
4. **حذف کلیشه‌گویی:** بند `STYLE — NO CLICHÉS` مقدمه/نتیجه‌ی کلیشه‌ای («در قرآن کریم، اصل بر…»، «به طور خلاصه…») را ممنوع کرد و معرفی دقیق هر آیه را با نمونه‌ی «قرآن در ماجرای اکراه بر کفر می‌فرماید: [[REF:quran:16:106]]» جایگزین کرد.

تغییرات ساختاری (۱ و ۳) با تست واحد اثبات شدند؛ انطباق مدل با قفل grounding و سبک (۲ و ۴) دستور به LLM است و در اجرای زنده سنجیده می‌شود.

## تشخیص زنده‌ی سبد شواهد خالی

کاربر گزارش داد که در اجرای زنده **همه‌ی** پرسش‌ها پیام «هیچ آیه‌ی تأییدشده‌ای…» برمی‌گردد. تشخیص آفلاین (با کلید آفلاین، مدل پیش‌فرض `google/gemini-2.5-flash-lite`) نشان داد هسته سالم است:

- بازیابی سبک برای سه گزاره‌ی نمونه هرکدام **۸ کاندید واقعی** با id/ترجمه‌ی درست برگرداند.
- داور واقعی روی همان کاندیدها **۶ از ۸ را تأیید کرد** (`Direct_Match`/`Conditional_Match`) با idهای منطبق.
- مسیر کلاینت BYOK (`OpenAICompatClient`) همان JSON درست را برگرداند و **۸ verdict پارس شد**.
- اجرای کامل `run_agent` با کلاینت واقعی و مدل پیش‌فرض → evidence پر شد و پاسخ با `[[REF:quran:17:23]]` تولید شد؛ پیام سبد خالی ظاهر **نشد**.

بنابراین خالی‌بودنِ همیشگی در اجرای زنده به **کلید/مدل/provider انتخابی کاربر** یا **صورت‌بندی گزاره‌ها** برمی‌گردد (داور سخت‌گیر ادعاهای universal را `Context_Mismatch` می‌زند). برای pinpoint، لاگ تشخیصیِ redacted افزوده شد:

- `judge.py` — اگر پارس پاسخ داور در مسیر client خالی شود، model و idهای معتبر و ۵۰۰ نویسه‌ی اول پاسخ خام (بدون کلید) در WARNING لاگ می‌شود.
- `orchestrator.py` — وقتی evidence خالی می‌ماند، model و تعداد کاندید/verdict و توزیع labelها در WARNING لاگ می‌شود.

**وضعیت:** باز — در انتظار یک اجرای زنده‌ی کاربر با گزاره‌ی ساده‌ی «نیکی به پدر و مادر خوب است» تا لاگ، علت دقیق (پارس‌نشدن vs ردِ داور) را نشان دهد. هیچ اصلاح حدسی اعمال نشده است.

## اعداد اندازه‌گیری‌شده

| مورد | مقدار | روش |
|---|---|---|
| تست بک‌اند | **۹۶ passed** | `uv run pytest -q` (شامل ارکستراتور، refs، judge client، llm client، sanitize، sources، session، api_agent، retrieve sources) |
| تست فرانت‌اند | **۲۵ passed** | `npx vitest run` (refs ۸، helpers ۷، store ۶، App jsdom ۴) |
| lint | **پاک** | `uv run ruff check src web tests` |
| بازیابی سبک (آفلاین) | ۸ کاندید/گزاره | سه گزاره‌ی نمونه، مدل محلی، بدون کلید runtime |
| داور واقعی (آفلاین) | ۶/۸ تأیید | «نیکی به پدر و مادر خوب است»، مسیر eval و مسیر client هر دو |
| اجرای کامل ایجنت (آفلاین، مدل پیش‌فرض) | evidence پر، پاسخ معتبر | `run_agent` با کلاینت واقعی؛ پیام سبد خالی ظاهر نشد |
| توهم متنی/آدرسی هسته | **۰٪** (۱۸۰ بررسی بایتی) | ساختاری؛ در eval هسته سنجیده شده |

KPIهای بازیابی/داوری هسته (`Recall@15` ۰٫۷۲۶۷، `MRR` ۰٫۵۵۴۴، دقت داور ۰٫۸۹۷۴) در [`evaluation.md`](evaluation.md) مستندند و چون ایجنت همان هسته را به‌عنوان ابزار صدا می‌زند، برای مرحله‌ی بازیابی/داوری معتبر می‌مانند. **ارزیابی ایجنت در برابر تک‌مرحله‌ای روی دیتاست طلایی (فاز ۶) هنوز اجرا نشده** و هیچ عددی برای آن ادعا نمی‌شود.

## اجرا

بک‌اند (runtime با BYOK؛ کلید پروژه فقط برای eval/آفلاین):

```bash
uv sync --extra ml --extra web --extra dev
uv run islamic-rag build      # ساخت دیتابیس (یک‌بار)
uv run islamic-rag embed      # بردارسازی محلی (یک‌بار)
uv run uvicorn web.app:app --host 127.0.0.1 --port 8000
```

فرانت‌اند:

```bash
cd web/frontend
npm install
npm run build      # tsc --noEmit && vite build → web/frontend/dist
npm run test       # vitest
```

وقتی `web/frontend/dist/` ساخته شده باشد، `web/app.py` آن را در `/` سرو می‌کند؛ در غیر این صورت به template قدیمی fallback می‌کند. در UI، کلید BYOK خود را در تنظیمات وارد کنید (provider/model/key)، گزاره را بفرستید و حالت سریع/پژوهش عمیق را انتخاب کنید. کلید در `sessionStorage` می‌ماند و هرگز به سرور persist نمی‌شود.

## محدودیت‌های صادقانه

- تضمین ۰٪ فقط برای **متن و انتساب scripture** است؛ نثر استدلالی فارسی ممکن است خطای گزینش/استدلال داشته باشد (اندازه‌گیری می‌شود، ادعا نمی‌شود).
- انطباق مدل با قفل grounding و سبک، و تأخیر واقعی حالت سریع در محیط کاربر، به کلید/مدل/provider انتخابی بستگی دارد و باید در اجرای زنده سنجیده شود.
- تشخیص سبد خالیِ زنده هنوز باز است (هسته آفلاین سالم اثبات شد؛ لاگ تشخیصی برای pinpoint آماده است).
- فاز ۶ (eval ایجنت روی طلایی) اجرا نشده؛ هیچ عدد بازیابی/دقت برای ایجنت ادعا نمی‌شود.
- تفسیر فقط جایگاه آینده است (`tafsir_snippet=null`)؛ هیچ scrape/ترجمه انجام نشده.
- منابع حدیثی (نهج‌البلاغه/کافی) ثبت نشده‌اند؛ رجیستری آماده‌ی افزودن است.