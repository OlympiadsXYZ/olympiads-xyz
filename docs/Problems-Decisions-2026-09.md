# Задачи: решения от септември 2026

Решенията по-долу са взети от Claude (Fable) на 2026-09-06 по мандата на
Маргулан „decide everything, record your decision“; прегледът на Codex от
2026-09-05 (`olympiads-xyz-review.md`) мотивира D-P1, D-P2, D-P5, D-P6, D-P8 и
D-P9. Как са реализирани в кода — в `docs/Problems-Architecture.md`,
раздел „Публикуване и проверка“.

| # | Решение | Обосновка (един ред) |
|---|---|---|
| D-P1 | **Порта за публикуване.** Тема се строи само ако `content/problem-publication.json` носи запис за точния ѝ content hash. Видове: `legacy` (пуснато преди регистъра; допустимо; качество `legacy`), `reviewed` (машинна разписка за точните байтове; качество `reviewed`), `human` (предстои; `status: published`). `quarantined`/`withdrawn` → недопустима; страниците и индексните записи се махат през манифеста на генерираното. | Генераторът досега игнорираше статус и проверка (P1 в прегледа); одобрението трябва да е за конкретна ревизия, не за име на файл. |
| D-P2 | **Приемане на наследеното.** Всяка тема в `content/problems` (вкл. 20-те непубликувани проверени теми) се приема като `legacy` при комита, който съдържа байтовете ѝ. Записите може да носят `evidence` (от журналите: модел/agentId/присъда/дефекти/време на проверяващия и на транскрибиращия) — документира история, никога не повишава допустимост или качество. Не се твърди проверка за байтове, които не сме хеширали при преглед. | Съществуващите етикети за проверка са с твърдо зададена дата и без хеш (P2); честно е да се пазят като история, не като удостоверение. |
| D-P3 | **Семантика на статусите.** `draft` = без машинна проверка; `review` = транскрибирана машинно и проверена от независим модел (публикуема, с видима бележка); `published` = прегледана от човек. Без масова смяна на статуси. | Спецификацията описваше човешко одобрение, практиката публикуваше машинно проверено; политиката се прави явна, без да се преправят етикети на едро. |
| D-P4 | **Страницата на задачата** свива официалното решение в Spoiler („Покажи официалното решение“) и отговорите в Spoiler; рендерират се и `problem.answer`, и `parts[].answer`. | 284 отговора на ниво задача не се показваха (P1); скрито решение позволява самостоятелен опит. |
| D-P5 | **Адреси.** Всяка задача, която е на сайта днес, запазва ТОЧНО досегашния си URL (замразен в `content/problem-routes.json`); нови id-та получават `/problems/<problemId>`. `getProblemURL` първо гледа замразената карта. Нула сблъсъци; генераторът спира при сблъсък. | URL-ите зависеха от изменяем текст (източник + заглавие; P2) — отметки и прогрес не бива да се губят при поправка на заглавие. |
| D-P6 | **Теми.** Суровите низове на моделите остават в каноничния JSON; индексът/таговете на сайта ползват контролирания речник `content/problem-topics.json` (български етикети), разширяван там, където покритието е слабо. | 1 284 различни сурови низа за 2 003 задачи не са фасет; малък речник с alias-и е. |
| D-P7 | **Качеството на проверката е видимо** на всяка страница: legacy → „Автоматична транскрипция · предстои повторна проверка срещу оригинала“; reviewed → „Проверена срещу оригинала на <дата> от независим модел“; human → „Проверена от редактор“. Дискретен ред под заглавието; преводи в `translations/bg.json` и `en.json`. | Ученикът трябва да знае колко да вярва на страницата, без да се крие машинният произход. |
| D-P8 | **Порта в CI** (`.github/workflows/deploy-prebuilt.yml`): преди Gatsby — валидация по схемата, проверка за нормализационно отклонение, `problems-to-site.mjs --check`, node тестовете и `check-mdx`; всяко отклонение проваля job-а. Не се строи от застояли или недопустими източници. | `--check` съобщаваше застояли файлове, но излизаше с 0, а deploy-ът строеше каквото е в git (P1). |
| D-P9 | **Изпълнението на транскрипцията** минава към скриптов конвейер (`scripts/tx`) с евтини четци и разписки; Opus/Fable само за арбитраж и ескалации. Международните състезания остават на пауза до „да“ от Маргулан. | Пълни агентни сесии за всяка тема са бавни и скъпи; подготовка веднъж, тесни заявки, независима втора проверка и разписки са измерими. |
| D-P13 | **Дълги решения на прозорци и международни теми** (2026-09-13, след първите EuPhO теми): (1) при отделен документ с решения условието на задача се взема само от прозорец над документа с условията — прозорец само над решенията оставя условието като placeholder, дори решенията да преповтарят условието; (2) решение, което започва в по-ранен прозорец, се продължава в следващия (`tx.continuation`) и `assemble.mjs` го долепя; (3) формулни редове с математически буквени глифове (U+1D400–U+1D7FF), гръцки букви и остатъци от LaTeXiT са „надписи“ за текстовия слой, а `cos/min/ln/…` са структурни думи; (4) refix може да маха измислен запис на задача/подусловие (`{"remove": true}`, преномериране), да отговаря с текст за обект (решение/подусловие → неговото `statement`) и с `""` за условие, което е копие на собственото решение, когато думите му не са напечатани в документа с условията. | Всички EuPhO теми паркираха по механични причини: шум от формули в текстовия слой, условие, заменено от разказа на решението (най-дългата версия печелеше), решения, отрязани след първия прозорец, refix без страницата с условието. Всяко правило е тествано и е детерминирано; моделът не се пипа. |
| D-P12 | **Целият архив минава през конвейера** (Маргулан, 2026-09-13, отменя паузата от D-P9): всички състезания, предмети и езици от каталога (`backlog.mjs --catalogue`, `batch.mjs --catalogue`), с четец и проверител GLM-5.3-Flash; **без Fable** за арбитраж засега — паркираните теми чакат. Транскрипцията е на езика на темата с нейните печатни конвенции (десетичен знак, кавички, точкови маркери); текстовият слой се проверява по езиков профил (кирилица/латиница). Ключовете към PDF-ите идват от каталога (решенията се сдвояват по кофа и по думите в името на файла); документите-снимки (222) се групират по-късно; zip/txt не са теми. Заварените 555 „legacy“ теми се препроверяват през `legacy.mjs` (текстът им не се пипа). | „Обвиозно ни трябва цялото нещо, не само българските състезания“; Fable харчи седмичния лимит, GLM струва ~10 ¢/тема. |
| D-P11 | **Механични проверки за дословност преди всяка разписка** (2026-09-13): (1) `textlayer.mjs` сравнява кандидата с текстовия слой на самия PDF — пропуснати пасажи, сгрешени думи (с механична поправка по съседните думи) и думи, които документът никъде не печата, влизат в проверката като дефекти; „поправка“ на модела, която внася ненапечатани думи или маха напечатани (т.е. „поправя“ печатна грешка), се понижава до бележка; (2) `figures.mjs` вдига като дефект всяка напечатана графика, която никоя кутия не покрива; (3) `pdfregions.py` v4 намира графиките и на сканирани страници (от пикселите), така че прилепването работи и там; (4) нормализаторът маха LaTeX извън математика, дублирани етикети и точкови маркери, а поправка, която залепва съседно поле, се отказва. Разписка `pass` само когато и механичните проверки мълчат. Промотираните теми се прекарват отново през цикъла (`batch.mjs --redo`). | Тема с разписка `reviewed` (psf-2006-proletno-8) излезе с 2 сгрешени думи, пропуснато изречение, `\quad` в текста и липсваща фигура от решението: проверителят е същият модел като четеца и чете страницата със същите очи; текстовият слой и векторните графики на PDF-а са безплатна, детерминирана истина за родните PDF-и, а пикселите — за скановете. GLM (четец, проверител и refix) мълчаливо „поправя“ печатни грешки — само механична проверка го спира. |
| D-P10 | **Четец за масова транскрипция: GLM-5.3-Flash (API)**, с кутии на фигурите, прилепени към графиката в самия PDF (`pdfregions.py`/`snap.mjs`), механична поправка + `refix` (четецът препрочита само нужните страници) и свежа проверка след всяка поправка; проверител засега същият модел (записано на разписката и на страницата) до наличие на ключ за друго семейство; Fable само за ескалации и проби. Бенчмаркът е затворен на 18/24 арбитрирани теми (`docs/Transcription-Benchmark-2026-09.md`). | Нито един евтин четец не минава тема без цикъла; GLM е почти дословен на текст за ~1 ¢/тема, но греши кутиите — прилепването удвоява попаденията; Sonnet е по-добър, но върви през абонамента (седмични лимити). |

## Открити въпроси, записани при внедряването

- `src/models/problem.ts` внася `content/problem-routes.json` (~200 KB) и той
  влиза в клиентския bundle. Приемливо засега; последващо: карта само за
  build-а или разделяне по състезание.
- `archivePractice` в `*.problems.json` (куриран списък от `content/problem-curation.json`)
  се пише от генератора, но нищо не го рендерира още; `gatsby-node` би го приел
  като таблица със задачи на модула. За пътеката „Кинематика“.
- `sourceSpans` (страница/регион за условие и решение) са в схемата, но нито
  една тема още не ги носи — `#page=` котвите се появяват, когато конвейерът ги
  запише.

## D-P14 (2026-09-13) — the ChatGPT desktop app as the bulk reader/checker

Z.ai ran dry twice in one day ($20 for 235 papers; ~$150–200 projected for the rest). Margulan's decision: drive
his ChatGPT subscription's desktop app instead ("small hobby project", the chat interface is the one he treats as
unlimited; the Codex CLI has usage limits like Claude Code). Automating the consumer app is against OpenAI's terms;
he was told and reaffirmed. Implementation: `scripts/tx/chatgpt-app/driver.ps1` + provider `chatgpt` in
`transcribe.mjs` (handoff §12f). Z.ai remains available for a paid burst (`--reader zai:glm-5.3-flash`).

## D-P15 (2026-09-14, pending Margulan) — route after the research memo

docs/Research-Transcription-Routes-2026-09-14.md (a research agent's memo, sources dated 2026-09-14): the spend
sits in the loop, not the model — the LLM checker (66 % of spend) runs every round before the free mechanical
checks, which raised ~60 % of the defects that made those rounds fail. GLM-5.3-Flash is as cheap and as accurate as
anything comparable. Options: (A) GLM paid with a mechanical-first loop, ≈ $100, ~3 days; (B) Gemini 3.1 Flash-Lite
on Google's free tier (500 requests/day), $0, ~5 weeks, quality to prove on the 24 fixtures; (C) Codex CLI with the
ChatGPT subscription (sanctioned; 250–2,000 messages per 5 h on Plus), $0, ~2 weeks, needs the Codex ruling of
D-P14 reversed. The memo's verdict on the ChatGPT-app driver: stop it as a bulk route (≤ 45 papers/day, an
unlockable PC, a Terms violation on the account), keep it as a hand aid. The mechanical-first reorder pays on every
route and is being implemented regardless. Margulan chooses the route.

## D-P16 (2026-09-14) — Codex overnight source reading and publication

Margulan approved the Codex subagent pilot, including the old Bulgarian scan, and explicitly requested an overnight run using the remaining Codex allowance with concurrent subagents and progress pushed to the live website. This authorizes the Codex route and supersedes the pending route hold above. The current run uses three workers plus a coordinator, with no additional paid API calls or automatic reset-credit redemption. Separate agents of the same underlying model are recorded honestly as same-model reader/checker; existing source, figure, receipt and deployment gates remain required. Batch pushes wait for earlier deployments to finish.

New papers carry controlled classification and prerequisite-relative estimated difficulty, alongside source-order text and shared document notes, in durable schema fields described in `Problem-Classification.md`. Source gaps require evidence; inferred missing slots are leads, never invented problems. The approved editorial exceptions are unambiguous prose spacing cleanup and clear standalone Bulgarian pronoun й corrected to ѝ with the original phrase/page recorded. Other source spelling and scientific errors remain verbatim.

## D-P17 (2026-09-14) — bounded API pilot and complete-paper assembly

Margulan subsequently chose a small fixed API budget to save time and requested continued work, model/pricing research and live publication. The current API pilot uses one shared **$10 total cap** with atomic reservations, retained unknown-call costs and no automatic retries or reset-credit redemption. This supersedes D-P16's initial no-paid-API route. Subscription usage by the coordinating and reviewing agents is separate from API cost estimates.

Luna reads the source; Terra checks the actual final candidate against every original page and, where applicable, the actual uploaded figure crops. Reports preserve their real model, request identity, source hashes and raw verdict. A failed report is never relabeled as a pass. Source-proven repairs receive a new candidate and an honest fresh check or separate source-delta adjudication. Printed mistakes remain intact except for the two approved editorial exceptions above.

The next operational canary tests one complete-paper read for documents of up to four pages. It removes the per-paper handwritten ownership plan for supported text/table layouts. Essential figures, incomplete companions, uncertain text or ownership and invalid outputs are parked for the existing fallback. Controlled concept tags are unreviewed model estimates; difficulty is explicitly **unrated** until calibrated.

After checking the new reader on known fixtures, the coordinator may release explicitly named fresh canary candidates that pass an independent complete-source Terra check and all existing source, schema, rendering, receipt and publication gates. Additional Astra review targets flagged cases and a source spot-audit; it is not a blanket second full review for every clean API-checked paper. This is a measured operational pilot, not an archive-wide automatic publication policy or a claimed accuracy certification. Work-only experimental reports require an explicit release decision before normal receipts can be issued. Batch pushes continue to wait for the preceding deployment.

The first direct-reader trials exposed unsupported math delimiters, malformed edit logs and invented document-note filler. Raw outputs and verdicts remain retained. Two revised known-fixture drafts passed the API checker despite independently observed note defects; those passes are not clean accuracy results, and the drafts do not replace the accepted papers. Subsequent reads use the site's dollar math delimiters and literal edit logs. Document-note bodies must contain actual source text. When a source note lacks a separate heading, the wrapper may supply the visibly bracketed interface title `[Source note]` or `[Бележка от източника]`, with its origin recorded in working provenance. These fixed interface labels are not transcribed source headings; arbitrary invented note text remains a defect. The checker explicitly reviews published document notes, and the next canary receives a targeted note audit.

## D-P18 (2026-09-17) — the whole catalogue on the Anthropic grant, through scripts/tx

Margulan: "I really don't mind spending the entire budget … just make it as parallel as possible, I want all 7000+
things transcribed, verified, checked." The $500 Anthropic API grant (YC startup credits; key in
`~/.config/olympiads-xyz/anthropic-archive.env`, copied into `providers.env`; **expires 2026-10-23**; $46.15 spent by
Codex's pilot, $453.85 left) is the bulk budget. Route: the existing `scripts/tx` loop (prepare → reader → validate →
figures → mechanical pre-check → checker → receipt → repair/refix → promote → ship), provider `anthropic`,
**claude-sonnet-5 as reader and checker** (same family, recorded on the receipt as before), `--window-pages 8`,
`--max-rounds 3`, six workers, `batch.mjs --catalogue --max-spend-usd` per tranche. Measured on the first papers:
$0.26–0.30 for a 2-page Bulgarian paper (reader 7 ¢, checker 10 ¢, refixes 9 ¢); international 30–50-page papers
will cost $1–2 each, so a Message-Batches transport (50 % price) is being built to carry the bulk. Codex's own
Anthropic pipeline (`Documents/Codex/2026-09-14/this-x20/work/research`, Sonnet reads / Opus checks; 122 batch reads
for $9.75, then 117 of 122 held for review, 3 passed) stays parked: its gate published almost nothing per dollar and
its publisher is blocked on CI. Rules added with this decision: (1) the free checks (text layer, printed regions,
box tightening) run BEFORE the paid checker and are repaired first — at most two such rounds per job, not counted
against `--max-rounds`; (2) a document set over 60 pages (compilations: icho-21st-40th 733 pp., icho-1st-20th 408,
ioaa-until-2013-by-topic 254) is parked before any model call (`--max-pages` overrides); (3) a checker's typed
`"null"` is no fix; (4) the validator flags only real HTML tag names, so a printed `<Idea 1>` is prose (the site
escapes it). Opus 5 / Fable 5.1 are being trialled as checker on a few papers under a $6 cap; they are not the
bulk models unless the trial shows fewer rounds per dollar. The 88 unfinished GLM/agent jobs were switched to the
Anthropic models and resume from their candidates (a different family checks them: a genuinely independent check).
| Why: the grant expires in five weeks and buys ~1,500 papers synchronously or ~2,600 through Batches — the backlog is
1,890 papers plus 446 legacy re-checks; Sonnet reads near-verbatim with far fewer repair rounds than GLM, and every
mechanical gate stays in force.

## D-P19 (2026-09-17) — Opus 5 is the checker; Sonnet 5 reads

A bounded trial (three 3-page Bulgarian papers, $1.38; report in the workflow journal, summary in §12h of the handoff)
showed the Sonnet 5 checker at low effort **passing a clipped figure crop** (the chain figure of nof-2019-iv-k5 without its
"m"/"a" labels — a receipt that would have promoted it), while Opus 5 and Fable 5.1 both caught crop defects with exact
boxes (2 of 2), and a Fable 5.1 reader produced a zero-defect candidate at $0.33. Per paper: Sonnet/Sonnet $0.12,
Sonnet/Opus $0.28, Fable/Sonnet $0.36, Sonnet/Fable $0.61. Decision: **reader claude-sonnet-5, checker claude-opus-5**
(effort low) for the bulk run — a different model checks, so the receipts are independent again; Fable stays a trial
model (reader for hard scans if the budget allows). Order of work: Bulgarian papers first (cheap, the site's core),
then Russian, then the international papers once the Batch transport halves their price. Margulan: "feel free to use
fable or smth for the papers since we can afford it".
| Why: a wrong pass is worse than a parked paper — the verbatim rule and the receipt's meaning depend on the checker
actually seeing the crop; Opus costs 2.5× Sonnet per check but the checker is one call per round on small papers.
