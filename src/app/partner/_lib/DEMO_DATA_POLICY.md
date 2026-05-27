# Partner demo data policy

Partner pages contain hard-coded demo data inside `if (session === 'demo')`
branches — `'Demo 제조사'`, `'EV 배터리 브라켓'`, `'스마트워치 하우징'`,
`'홍길동'`, etc. — used by the **"🔧 파트너사 데모로 체험하기"** entry on
`/partner/login`.

## Decision: keep demo data KR canonical

We deliberately do **not** branch demo data on `partnerLang`. Reasons:

1. **Sales / ops use** — The demo session is primarily a Korean partner-ops
   sales tool (showing prospect factories what the portal looks like before
   signup). Sales walk-throughs are in Korean.
2. **Consistency with on-screen status** — Even when partner UI is rendered
   in EN/JA/CN/ES/AR, the demo data behind it is "what a Korean
   manufacturer's data would look like." Translating the company name to
   `'Demo Manufacturer'` makes the realistic feel weaker without functional
   benefit.
3. **Data shape ≠ UI label** — The lang-switching pattern in this codebase
   is "translate UI labels around the data, not the data itself" (same
   reason `PROCESS_OPTIONS`, `INDUSTRY_OPTIONS`, etc. stay KR canonical).

## When to revisit

If demo sessions are repurposed as an unauthenticated marketing demo
embedded on `/en` / `/ja` etc. landing pages — i.e. an English-speaking
prospect should be able to see "Demo Manufacturer" in their language —
that would justify lang-aware demo data. Until then, KR canonical wins.

## Practical guideline for new demo data

When adding new `if (session === 'demo')` blocks:

* OK: `partner.company = 'Demo 제조사'` — KR canonical.
* OK: status / amount / dates — these are not language-bound.
* Not OK: invent EN demo data ('Demo Manufacturer Inc.') just because the
  surrounding UI is i18n'd. Stick with KR for portfolio consistency.
* If you absolutely need an EN string in demo data (e.g. an English-named
  customer fixture), wrap it in `t.demoXxx` and add the dict key like any
  other UI label. Don't ad-hoc translate.
