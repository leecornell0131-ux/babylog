# Architecture and server economics — verified 2026-10-20

## 1. What can be genuinely zero recurring cash cost?

### Takeaway
External sync and automatically refreshed Android widgets can operate within free Cloudflare/Firebase allowances. Zero cash does not mean unlimited capacity or uninterrupted service: hard caps trade invoice risk for service outage risk. Cloudflare is optional; a trusted online backend is still needed for reliable asynchronous delivery between spouses.

### Cited Findings
- Firebase Spark needs no payment information; Blaze links a billing account and charges additional usage. FCM is a no-cost product on both. Cloud Functions requires Blaze. Budget alerts do not cap charges. Current docs also mention service-specific spend caps for Cloud Run functions; do not generalize those to Firestore. [Firebase plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- Firestore free allocation: 50,000 document reads/day, 20,000 writes/day, 20,000 deletes/day, 1 GiB stored, 10 GiB outbound/month; one eligible database per project. Daily quotas reset around Pacific midnight. [Firestore quotas](https://firebase.google.com/docs/firestore/quotas)
- Cloudflare Workers Free can start without a credit card. [Workers product](https://www.cloudflare.com/products/workers/)
- Workers Free allows 100,000 requests/day; crossing the cap produces Error 1027, reset at UTC midnight. Free CPU is 10ms/invocation. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- D1 Free: 5m rows read/day, 100k rows written/day, 5GB storage/account. At daily cap queries fail. Inserts stop when storage allocation is exhausted. Table/index scans and index updates count, not merely SQL call count. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- D1 Free is at most 500MB per DB and 10 DB/account; Paid is at most 10GB per DB. Free Time Travel retains 7 days, Paid 30 days. These are important before proposing a full event database on D1. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- KV Free: 100k key reads/day, 1k writes/day, 1GB storage; exceeding a given operation allowance fails that type. Paid: 10m reads/month included then $0.50/m; 1m writes/month then $5/m. [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)
- Current local evidence: `docs/CLAUDE_SYNC_HANDOFF.md` states branch `codex/reduce-sync-usage` is NOT deployed, real users remain iPhone Safari/PWA + older Android APK. D1 latest-summary migration, deduplication and removal of 15min Android poll are on branch. Old APK still schedules nominal 96 GET/day. No remote-device/real FCM battery-mode verification yet. `docs/SERVER_USAGE_AUDIT.md` says event data remains Firestore and tokens remain KV. These are repository evidence, not external service state.

### Inferences
- Zero cost option A (least rewrite): Firestore Spark events + Workers Free + D1 Free latest summary + FCM; replace frequent-summary KV writes, not tokens. Free allowance belongs to developer account/project across ALL families. Do not multiply by 2 spouses or per-user projects.
- Around 100–130 daily active families is a conservative INITIAL PLANNING range if reads are 300/family/day, not a measured capacity promise. At 130:39k Firestore reads/day, leaving22% read headroom. 166 families nearly exhaust50k. 400 families is write-only50/family calculation and ignores reads. Before D1 replacement, 50 KV summary writes/family/day only fits20 families, minus other writes.
- Zero cost option B (more rewrite): Workers Free + D1 Free all events, summary, device tokens + Firebase Auth/FCM no-cost services. Removes Firestore read ceiling, but requires server auth/family authorization, mutation API, change cursor/realtime delivery, local cache, conflict resolution, retry queue, backup and migrations. NOT equivalent to deploying current branch. D1 rows scanned/index write amplification and 500MB/DB become constraints.
- If strict zero-spend then admit new households only while measured usage has headroom. Existing sync must not silently be sacrificed. Charging subscriptions does not expand a free tier; paid customers increase reliability expectations.
- Avoid KV for frequent latest-summary writes. Token reads may remain cheap but still consume per-account read capacity. A future D1 token table can remove its ceiling, requiring implementation/testing.
- Free backend does not mean a free iOS store business: Apple membership and Play registration are separate. Parent researcher covers those fees. Do not call $99 a one-off development cost.

### Gaps
- Live account plan, deployed branch, real traffic, billing region, actual row/doc storage and paid-service activation were not inspected. Public docs are current; report figures remain models.
- No wholly reliable unlimited zero-spend production service was found. Free tiers can change, and push/OS restrictions remain even on paid tiers.

## 2. What does a paid monthly architecture actually cost?

### Takeaway
The cost of small text records is usually manageable; repeated reads and poor query/index design matter more than payload size. Paying Cloudflare alone does not lift Firestore Spark's ceiling. Report should prioritize measured optimized hybrid for near term, compare Firebase consolidation and Cloudflare consolidation as optional future designs.

### Cited Findings
- Workers Paid account minimum $5/month includes10m requests and30m CPU-ms/month; overages $0.30/m requests and$0.02/m CPU-ms. Outbound Worker subrequests aren't incoming billable requests; static asset requests free. CPU max/invocation can be configured, not a total monthly bill cap. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- D1 Paid includes25bn rows read/month,50m written/month,5GB storage then$0.001/m read,$1/m written,$0.75/GB-month. No D1 egress charge. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- Firestore writes count per document/set/update; listener additions/updates incur reads, reconnects can rebill query results, rules get/exists add reads. Up to one range field exempt from index-entry read billing. Persistent cache reduces some reconnect cost but doesn't remove all reads. [Firestore billing details](https://firebase.google.com/docs/firestore/pricing?hl=en)
- Firestore price page fetched with default Iowa selected shows on-demand read$0.03/100k and write$0.09/100k. Locale/region selector includes Seoul but text extraction did NOT switch to Seoul, so these must be labeled IOWA REFERENCE RATES, never Seoul or actual app rates. [Google Firestore pricing](https://cloud.google.com/firestore/pricing)
- Firebase-only alternative: Firestore+Functions event trigger+FCM, no Cloudflare. Functions require Blaze and may involve Cloud Build/Artifact Registry storage charges; free invocation quota doesn't imply every deployed backend is guaranteed$0. Registry first500MB free then$0.10/GB-month per FAQ. [Functions FAQ](https://firebase.google.com/docs/functions/faq-and-troubleshooting)
- Cloud Storage for Firebase now requires Blaze; adding photo/video storage is distinct from Firestore's text free tier. Don't promise free photographs using Spark. [Storage change FAQ](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)

### Inferences
Architectural options, not implemented changes:
1. Optimized hybrid (near-term): existing Firestore sync retained; CF Workers+D1 summary+FCM; enable Blaze if Firestore free allowance insufficient; Workers Paid only when required or launch headroom worthwhile. Lowest migration risk; two providers still monitored.
2. Firebase consolidation: Firestore+Functions+FCM+native widget fetch. Removes Cloudflare fixed$5 if currently paid; may incur Functions/storage/egress. Need correct server-created summary and idempotency; avoid functions writing their own trigger loop. Blaze variable billing requires controls.
3. Cloudflare consolidation: Workers+D1 all records+tokens, FCM/APNs delivery. Can have low infra unit costs, but a new sync backend; engineering time and migration risks exceed saving a few dollars initially. Avoid claiming drop-in replacement or same tested reliability.
4. VPS/home NAS: user-managed uptime, security, patching and backups, plus power/network/disk. A free laptop/NAS is not truly zero incremental cost, and no reason to choose it for monthly100k–300k surplus solely to save single-digit dollar backend charges. No price quote researched; omit numerical VPS pricing.

30-day MODEL, all EXPLICIT ASSUMPTIONS (not instrumentation): H=daily active households, 2 devices/household;50 record changes/day (create/edit/delete/start/end each a change); Firestore300 charged reads/day/family incl reconnect/rules planning allowance;50 document writes/day/family. CF60 incoming requests/day/family=50 notify+10 repair/open/token/OPTIONS combined budget, one KV token read/notify,5ms CPU/request; D1 summary50 rows written/day/family BEFORE index amplification,10 summary reads/day/family plus bounded upsert lookup reads. No media/AI/SMS. Old APK96 polls/day is excluded, hence not current deployment estimate.

| H daily active households | Record writes/day | Firestore reads/day | CF requests/day | Monthly CF requests | D1 summary writes/month | KV token reads/month |
|---:|---:|---:|---:|---:|---:|---:|
|100|5,000|30,000|6,000|180,000|150,000|150,000|
|1,000|50,000|300,000|60,000|1.8m|1.5m|1.5m|
|10,000|500,000|3m|600,000|18m|15m|15m|

Daily constant traffic gives paid Firestore OVERAGE formula: reads30*max(300H-50,000,0); writes30*max(50H-20,000,0). Do NOT charge all usage after one crosses quota, do NOT subtract free monthly average from spiky days.

|H|Firestore read overage/month|write overage/month|Iowa reference operation subtotal only|CF if deliberately on Paid|KV extra|
|---:|---:|---:|---:|---:|---:|
|100|0|0|$0|$5|$0|
|1,000|7.5m|0.9m|$3.06|$5|$0|
|10,000|88.5m|14.4m|$39.51|$8.60|$2.50|

CF10k:$5+(18m-10m)*$0.30/m+(90m-30m)*$0.02/m=$8.60. D1 write15m/month under50m; if 2x write amplification30m still under; test meta.rows_written. CF1k and100 could remain Free if all daily quotas met and CPU<10ms, so $5 is the choice of Paid not a mandatory fee. Firestore reference subtotal assumes benchmark Iowa and excludes ALL storage/egress/backups; actual region must be verified before budget commitment.

INSTRUCTIVE INFRA subtotal using Iowa reference:100:$5 if Paid CF chosen (or$0 if Free);1k:$8.06;10k:$50.61 BEFORE storage/egress/taxes. Illustration$1=1,400KRW gives7,000 /11,284 /70,854KRW, not current exchange rate and not full invoice. For easy report, suggest30k–50kKRW monthly budget envelope for early launch/1kDAH, clearly a contingency budget not verified cost guarantee. At10kDAH, full invoice can exceed100kKRW depending region/egress/retention.

Firestore egress sensitivity:300 reads*1KiB/family/day=>~0.858GiB/month at100H,8.58GiB at1kH,85.83GiB at10kH. This is only payload, excludes protocol/metadata;10GiB free can be exceeded even with small records. Real client destinations matter. CF/D1 own egress differs from Firestore.

All-D1 illustrative sensitivity, NOT deployed:50 mutations +10 delta fetches/day/family, each mutation writes event+summary, event/index overhead yields3–5 billable written rows/change. This is150–250 rows/day/family.100H=>15k–25k/day;1k=>150k–250k/day exceeds100k Free;10k=>45m–75m/month, at top end25m paid excess=>$25. Fetches scan indexed family/cursor ranges; returning10 rows may scan more. 50*2 rows of live delivery perhousehold/day isn't a full query scan estimate; use actual rows_read. Workers60requests assumption allows request/response delta sync after push; adding WebSockets/DO changes costs and complexity.

### Gaps
- Seoul unit rates couldn't be captured in primary public text within research budget. Non-primary search snippets suggest different rates but aren't used. Writer should either keep Iowa labeled reference or use operations and budget ranges pending actual billing region.
-5ms CPU not measured; crypto/OAuth cost and retries may raise it; free10ms requires testing.10 extra requests/day is an illustrative allowance, not guaranteed delivery design. Removing all repair polling reduces load but weakens recovery; don't sell it as unquestionably more reliable.

## 3. Storage growth, revenue targets and launch decision

### Takeaway
Monthly active families generate revenue conversion; daily active families generate server load. They cannot be substituted. An app retaining years of records can hit a free storage ceiling even when daily traffic fits; latest-summary storage and historical event storage behave differently.

### Cited Findings
- Firestore metadata and indexes count in storage, sampled daily and averaged; no automatic free PITR/backup allowance. [Firestore storage size](https://firebase.google.com/docs/firestore/storage-size)
- D1 table/index bytes count in storage; per-query metadata exposes rows_read/rows_written for checking assumptions. [D1 metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/)
- Report continuity: local `PRODUCT_BUSINESS_DISCUSSION.md` labels2,900KRW subscription,3–5% conversion and advertising assumptions unvalidated. Business target now minimum100kKRW, aspirational200k–300k monthly operating surplus; do not present former70-paying-family target as accepted demand forecast.

### Inferences
-50 changes/day includes updates; storage DOES NOT necessarily add50 new documents/day. Illustrate30 NEW records/day,2KiB effective billed bytes/record incl index/metadata as an assumption; all active families contribute all30 days, no deletion. Perfamily monthly1.758MiB;100H adds0.172GiB/month,1k1.717GiB/month,10k17.17GiB/month. After12mo atconstantH:2.06 /20.60 /206.0GiB retained. Firestore1GiB free crossed~5.8mo for100H,0.58mo for1kH,0.058mo for10kH. Actual retention must include inactive families and account deletion rules; dailyH alone insufficient.
- latest summaries:4KiB/family hypothetical=>0.39 /3.91 /39.06MiB at100/1k/10k families, roughly fixed if overwrite. Difference explains why current D1 summary is comfortable while moving ALL history changes economics.
- All-D1 one500MB free DB with30new*2KiB could reach limit before5GBaccount total; paid one10GB DB cannot hold~17GiB model month at10k families. Multiple DB sharding/partition/retention required, NOT simply upgrade and forget.
-70 paying families /3–5% conversion=>1,400–2,334 MONTHLY active families. At assumedDAU/MAU30% that is420–700 daily active families; at60%840–1,400. These activity ratios are scenarios, not market measurements. Hybrid Spark300reads/day doesn't fit those, even though CF requests may fit Free. Paid CF alone cannot solve it; Firestore must get billing or substantial read reduction/new backend.
- Ads-only500+daily active families also exceed50k Firestore reads with300read/family planning. People !=families: two spouses may both see ads; use userDAU for impressions, familyDAU for server model and do not silently equate them.
- Strong proposal: free closed beta around100 dailyactive families with telemetry; before broader launch, validate native widget reliability and accept planned small server spending funded from revenue. Zero-cash operating model remains a bounded pilot option, not a scalable guarantee. No card/upgrade/deployment has been authorized by this report request.

### Gaps
- Actual record effective size/new:edit ratio/retention not measured. Profit includes server and platform annual fixed costs; payroll/tax/marketing may be separate and must be stated. Monetization demand is not validated by cheap infrastructure.
