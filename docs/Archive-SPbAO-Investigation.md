# Разследване: СПбАО в архива (Санкт-Петербургска астрономическа олимпиада)

**Дата:** 1 септември 2026 г.
**Обхват:** `Астрономия/Състезания/Санкт-Петербургска/` — всичките 423 обекта в R2 и всичките 423 каталожни записа, които сочат към тях.
**Повод:** одитът от 2026-09 маркира 86 обекта в папките 2018–2022 като md5-идентични с файлове от 2017 и постави въпроса дали материалите за 2018–2022 изобщо липсват.

---

## 0. Присъда накратко

1. **Материалите за 2018–2022 НЕ липсват.** Всяка от петте години има пълен, автентичен комплект в R2. Одитът е гледал само едното от **две успоредни дървета** във всяка годишна папка.
2. Дефектът е **замърсяване и грешни метаданни, не празнина**: 86 излишни копия на 19 документа от 2017 г., плюс 91 записа с грешен `type`, плюс 34 записа, които изобщо не са СПбАО (те са ВсОШ), плюс 7 единични грешки.
3. **Независима външна проверка потвърждава автентичността:** от 120-те официални PDF-а, свалени от сайта на организатора `school.astro.spbu.ru`, **114 са байт-идентични (md5) с обекти, които вече са в R2**. Останалите 6 са същите документи в по-нова PDF-компилация.
4. Коренът на грешката **не е в процеса на възстановяване**: манифестът на първоначално публикувания сайт (T7) вече е съдържал буквалните пътища `2019/2017-I/…`, `2020/2017-I/…`, `2021/2017-I/…`, `2022/2017-I/…` и `2018/2018-II/*`, напълнени със съдържание от 2017 г. Грешните заглавия са наследени от живия сайт.
5. Нищо не е изтрито и нищо не е качено по време на разследването. R2 е достъпван само за четене.

---

## 1. Метод — какво точно е ВИДЯНО

Нито едно твърдение по-долу не почива на име на файл, на папка или само на хеш.

| Стъпка | Какво е направено | Покритие |
|---|---|---|
| Сваляне + рендиране | всеки PDF е свален от R2, стр. 1–3 рендирани с `pdftoppm -r 150` и **прочетени като изображение** | 423 обекта; 219 отделни документа |
| Masthead като истина | римската цифра на изданието, отпечатаната година, датата на тура и класът от главата на страницата | всички файлове с masthead |
| Проверка за сканове | `scripts/pdfcrop.py --probe` | 0 сканирани файла — всички имат истински текстов слой |
| Вътрешна датировка | твърдения в самите решения (напр. „пишат тур 28 ноября 2016 года и это понедельник“ — 28.11.2016 наистина е понеделник; „сегодня 5 февраля … равноденствия 20 марта“ — пролетното равноденствие през 2017 г. е 20 март) | използвано като кръстосана проверка на 2016/2017 |
| Пълна md5-преброявка | `rclone lsjson --hash` върху целия префикс | 423/423 |
| Външен източник | `http://school.astro.spbu.ru` (сайтът на организатора, само по HTTP) — 120 PDF; `rsr-olymp.ru`/`olimpiada.ru` — 24 PDF | сезони 2018–2023 |

**Локални артефакти от разследването** (не са качвани никъде):

- `…/scratchpad/spb/web/pdf/` — 120 официални PDF (53 MB)
- `…/scratchpad/spb/web/rsr/` — 24 PDF от РСОШ-огледалото (8,5 MB)
- `…/scratchpad/spb/web/manifest.json` — url, етикет, размер, md5, суров masthead и разбор за всеки от 120-те
- `…/scratchpad/spb/inspect_*.json`, `hunt_local.json`, `hunt_web.json` — суровите находки
- `…/scratchpad/spb/spb_lsjson.json` — md5 на всичките 423 обекта в R2

---

## 2. Двете конвенции за годината — коренът на цялата бъркотия

Това е причината и одитът, и първоначалният каталог да сгрешат. Три различни „години“ се борят за едно поле:

**(а) Римската цифра е решаваща.** Издание N живее в папка `1993 + N`. Проверено по цялата дължина на архива: XV = 2008 … XXIV = 2017, XXV = 2018, XXVI = 2019, XXVII = 2020, XXVIII = 2021, XXIX = 2022, XXX = 2023, XXXI = 2024 … XXXIII = 2026.

**(б) Папката е СЕЗОН, не календарна година.** I кръг (районен / задочен) се провежда през ноември–декември на *предходната* календарна година; II кръг (теоретичен, после практически) — през януари–март на годината на сезона.

**(в) Отпечатаната година зависи от тура:**

- Ноемврийският **районен** лист печата ноемврийската година, т.е. `сезон − 1`. Пример: `2022/2022-I/regional/10.pdf` печата „2021, 13 ноября“ и е коректно поставен в сезон 2022.
- **Задочният, теоретичният и практическият** лист печатат годината на сезона. Пример: `2017/2017-I/Задочен/9.pdf` печата „2017, 2 декабря / 16 января“, макар турът да е започнал на 2 декември 2016 г. Същото и при XXVI: „2019 / до 17 января“ за тур, отворен през декември 2018 г.
- Изместване назад във времето: до XXII (сезон 2015) **задочният** също печата декемврийската година (`2015/2015-I/Задочен/*` печата 2014). Смяната изглежда се случва при XXIII (сезон 2016). *Наблюдение, не документирано правило.*

**(г) Външните агрегатори броят по НАЧАЛНАТА година.** `olimpiada.ru` и `rsr-olymp.ru` етикетират цялото издание с годината, в която то започва — затова „СПбАО 2019“ при тях означава XXVI (финали февруари–март 2019), а на сайта на организатора същият низ може да сочи XXVII (районен ноември 2019).

**(д) От издание XXVI (ноември 2018) нататък ноемврийският районен кръг вече не е СПбАО.** Главата му гласи „Районный этап Всероссийской олимпиады школьников по астрономии, Санкт-Петербург“ — това са листове на ВсОШ, само хоствани на сайта на СПбАО. Изданието XXV (ноември 2017) още носи марката „XXV Санкт-Петербургская астрономическая олимпиада / 2017“.

---

## 3. Какво съдържа архивът — по година и по кръг

Легенда: **отделни документи** = обектът носи документ, който не се повтаря другаде; **излишни копия** = байт- или текст-дубликат на документ, който вече стои другаде в архива. Колоните броят *обекти*, не *дефекти* — файл може да е автентичен документ и въпреки това да има грешен `type` или грешно състезание в каталога (вж. §5).

| Сезон | Издание | I кръг — какво реално стои там | II кръг | Записи в каталога | Отделни документи | Излишни копия |
|---|---|---|---|---|---|---|
| 2008 | XV | `2008-I/` — районен тур, печата 2007, класове 6-7 / 8-9 / 10 / 11 (4 файла, решения) | `2008-II/` — „первый тур“, 2008, същите 4 класа | 8 | 8 | 0 |
| 2009 | XVI | `2009-I/Задочен/` — 5 файла, **без никакъв masthead**; `9.pdf` е текстов дубликат на `10.pdf` | `2009-II/` — 5 файла, също без masthead | 10 | 9 | 1 |
| 2010 | XVII | `2010-I/Районен/` — 5 файла, печатат 2009 | `2010-II/Теоретичен/` — 5 файла, 2010. **Няма практически тур** | 10 | 10 | 0 |
| 2011 | XVIII | `2011-I/Районен/` — 5 файла, печатат 2010 | `2011-II/` — 5 теоретични (решения) + 5 практически (условия; 9/10/11 са едно и също PDF, 5-6 и 7-8 са едно и също PDF) | 15 | 12 | 3 |
| 2012 | XIX | `2012-I/Районен/` — 5, печатат 2011 | `2012-II/` — 5 теор. + 5 практ. | 15 | 15 | 0 |
| 2013 | XX | `2013-I/Задочен/` 5 + `2013-I/Районен/` 5, печатат 2012 | `2013-II/` — 5 + 5 | 20 | 20 | 0 |
| 2014 | XXI | `2014-I/Задочен/` — **само 5-6 клас** (условия + решения, 2 файла); `2014-I/Районен/` — 5, печатат 2013 | `2014-II/` — 5 + 5 | 17 | 17 | 0 |
| 2015 | XXII | `2015-I/Задочен/` 5 + `2015-I/Районен/` 5, печатат 2014 | `2015-II/` — 5 + 5 | 20 | 20 | 0 |
| 2016 | XXIII | `2016-I/Задочен/` 5 (печатат 2016, 3 декември) + 10 български превода (5 PDF + 5 DOCX); `2016-I/Районен/` 4 — **ВсОШ 21.11.2015, само условия** | `2016-II/` — 5 + 5 | 29 | 29 | 0 |
| **2017** | **XXIV** | `2017-I/Задочен/` 5 — XXIV, 2017, 2 декември / 16 януари, решения; `2017-I/Районен/` 4 — **ВсОШ 28.11.2016**, решения | `2017-II/` — 5 теор. (5 февруари 2017) + 5 практ. (12 март 2017), решения | 19 | 19 | 0 |
| **2018** | **XXV** | `2018-I/Задочен/` 5 — XXV, „2017–2018“, 15 дек. / 18 ян.; `2018-I/Районен/` 4 — **XXV, 2017, 23 ноември** (още СПбАО-марка) | `2018-II/*/…(Mega).pdf` 10 — XXV, 2018, 4 февруари / 4 март | 29 | **19** | **10** |
| **2019** | **XXVI** | `2019-I/regional/` 4 — ВсОШ 21.11.2018; `2019-I/remote/` 5 — XXVI, 2019, до 17 януари | `2019-II/` 10 — XXVI, 2019, 3 февруари / 3 март | 38 | **19** | **19** |
| **2020** | **XXVII** | `2020-I/regional/` 4 — ВсОШ 20.11.2019; `2020-I/remote/` 5 — XXVII, 2020; `2020-I/remote/bg/` 5 — **български превод на XXVII задочен**, срок 16 януари 2020 | `2020-II/` 10 — XXVII, 2020, 2 февруари / 1 март | 43 | **24** | **19** |
| **2021** | **XXVIII** | `2021-I/regional/` 4 — ВсОШ 27.11.2020 (проведен присъствено в училищата); `2021-I/remote/` 5 — XXVIII, 2021 | `2021-II/` 10 — XXVIII, 2021, 31 януари / 14 март | 38 | **19** | **19** |
| **2022** | **XXIX** | `2022-I/regional/` 4 — ВсОШ 13.11.2021; `2022-I/remote/` 5 — XXIX, 2022 | `2022-II/` 10 — XXIX, 2022, 6 февруари / 13 март | 38 | **19** | **19** |
| 2023 | XXX | `2023-I/regional/spb-city/` 5 — ВсОШ районен, СПб-град, 12.11.2022; `2023-I/regional/spb-region/` 5 — ВсОШ **общински**, Ленинградска област, 17.11.2022; `2023-I/remote/` 5 — XXX, 2023 | `2023-II/` 10 — XXX, 2023, 12 февруари; **+ 4 излишни файла, които печатат XXXI / 2024** | 29 | 25 | 4 |
| 2024 | XXXI | `2024-I/remote/` 5 | `2024-II/` 10 | 15 | 15 | 0 |
| 2025 | XXXII | `2025-I/` 5 | `2025-II/` 10 | 15 | 15 | 0 |
| 2026 | XXXIII | `2026-I/` 5 | `2026-II/` 10 | 15 | 15 | 0 |
| **Общо** | | | | **423** | **329** | **94** |

**Кръстосана проверка със сайта на организатора.** Индексът на сайта групира по учебна година. Броят на файловете съвпада с автентичните комплекти в архива едно към едно:

| Учебна година на сайта | = сезон в архива | Файлове на сайта | Съвпадат байт-за-байт с обект в R2 |
|---|---|---|---|
| 2017-2018 (XXV) | 2018 | 19 | **19 / 19** |
| 2018-2019 (XXVI) | 2019 | 19 | **19 / 19** |
| 2019-2020 (XXVII) | 2020 | 19 | 14 / 19 |
| 2020-2021 (XXVIII) | 2021 | 19 | **19 / 19** |
| 2021-2022 (XXIX) | 2022 | 19 | **19 / 19** |
| 2022-2023 (XXX) | 2023 | 25 | 24 / 25 |

Шестте несъвпадения не са празнини: петте теоретични листа на XXVII (`node/594`) и един теоретичен лист на XXX (`node/654`) са **същите документи в различна PDF-компилация** — идентична глава, разлика в размера от 6 до 6363 байта. Организаторът очевидно е преекспортирал файловете след като копието в архива е било свалено.

---

## 4. Отговор на въпроса „наистина ли липсват 2018–2022?“

**Не. Одитът е пропуснал факта, че всяка годишна папка съдържа две дървета.**

- Одитът е видял `2019/2017-I/…`, `2019/2017-II/…` (19 файла) и е заключил „това е всичко за 2019 и то е от 2017“.
- Успоредно с тях, в същата папка `2019/`, стоят `2019/2019-I/…` и `2019/2019-II/…` — 19 други файла, които печатат **XXVI, 2019, 3 февруари / 3 март**. Те са автентичните.
- Същото важи за 2020, 2021 и 2022 (по 19 фалшиви до 19–24 автентични).
- При 2018 капанът е по-коварен: там **няма честно име на подпапката, което да предупреди**. И десетте файла `2018/2018-II/*/theo.pdf` и `pract.pdf` печатат **XXIV, 2017**, докато техните близнаци със суфикс **` (Mega).pdf` в същата папка печатат XXV, 2018 и са истинските листове за 2018 г.** Тоест: **да, вариантите „(Mega)“ са истинското нещо** — точно обратното на това, което името подсказва.

Три отделни доказателства подкрепят това:

1. **Прочетени страници.** `2018/2018-II/9/theo (Mega).pdf` → „XXV … 2018 … 4 февраля“. `2018/2018-II/9/theo.pdf` → „XXIV … 2017 … 5 февраля“.
2. **Официалният сайт.** 120-те PDF-а от организатора са с **120 различни md5** — истинският корпус изобщо не съдържа дубликати. Следователно 86 записа, които са md5-идентични с файлове от 2017, физически не могат да бъдат отделни листове от 2018–2022.
3. **Байт-съвпадение.** 114 от тези 120 официални файла са байт-идентични с обекти, които вече са в R2 — и всеки от тях се приземява в **автентичното** дърво (`2018-I`, `2018-II/(Mega)`, `2019-I`, `2019-II`, `2020-I`, …), никога във фалшивото.

Проверени бяха и другите две хипотези от въпроса:

- **„Папката 2017 държи материал от няколко години“** — не. Тя е вътрешно последователна за сезона 2016/2017 и е коректният дом за всичките 19 документа. Единствената ѝ грешка е друга: четирите файла в `2017/2017-I/Районен/` изобщо не са СПбАО (вж. §5.3).
- **„Файлове под друго състезание“** — да, но в обратната посока: 34 файла в папката на СПбАО всъщност са ВсОШ.

---

## 5. Грешно етикетирани записи

202 от 423-те записа имат поне един дефект; 221 са чисти. Групите по-долу се припокриват само на едно място (16 записа са едновременно в §5.2 и §5.3).

### 5.1 (A) 86 излишни копия — за де-каталогизиране / изтриване

Всичките 86 са в `archive-catalog/astronomy-rest.json`, с id-та `astro-spba-*`. Всеки от тях е **байт-идентичен** с файл, който вече стои в правилната папка `2017/`, така че при премахване не се губи нищо. Проверено: изчисленият правилен път съвпада със съществуващия път на копието за 86/86.

| Каталожен id | Ключ (за премахване) | Идентичен с (остава) |
|---|---|---|
| `astro-spba-2018-ii-10-solutions-pract` | `2018/2018-II/10/pract.pdf` | `2017/2017-II/10/pract.pdf` |
| `astro-spba-2018-ii-10-solutions-theo` | `2018/2018-II/10/theo.pdf` | `2017/2017-II/10/theo.pdf` |
| `astro-spba-2018-ii-11-solutions-pract` | `2018/2018-II/11/pract.pdf` | `2017/2017-II/11/pract.pdf` |
| `astro-spba-2018-ii-11-solutions-theo` | `2018/2018-II/11/theo.pdf` | `2017/2017-II/11/theo.pdf` |
| `astro-spba-2018-ii-5-6-solutions-pract` | `2018/2018-II/5-6/pract.pdf` | `2017/2017-II/5-6/pract.pdf` |
| `astro-spba-2018-ii-5-6-solutions-theo` | `2018/2018-II/5-6/theo.pdf` | `2017/2017-II/5-6/theo.pdf` |
| `astro-spba-2018-ii-7-8-solutions-pract` | `2018/2018-II/7-8/pract.pdf` | `2017/2017-II/7-8/pract.pdf` |
| `astro-spba-2018-ii-7-8-solutions-theo` | `2018/2018-II/7-8/theo.pdf` | `2017/2017-II/7-8/theo.pdf` |
| `astro-spba-2018-ii-9-solutions-pract` | `2018/2018-II/9/pract.pdf` | `2017/2017-II/9/pract.pdf` |
| `astro-spba-2018-ii-9-solutions-theo` | `2018/2018-II/9/theo.pdf` | `2017/2017-II/9/theo.pdf` |
| `astro-spba-2019-i-10-solutions-zao` | `2019/2017-I/Задочен/10.pdf` | `2017/2017-I/Задочен/10.pdf` |
| `astro-spba-2019-i-11-solutions-zao` | `2019/2017-I/Задочен/11.pdf` | `2017/2017-I/Задочен/11.pdf` |
| `astro-spba-2019-i-5-6-solutions-zao` | `2019/2017-I/Задочен/5-6.pdf` | `2017/2017-I/Задочен/5-6.pdf` |
| `astro-spba-2019-i-7-8-solutions-zao` | `2019/2017-I/Задочен/7-8.pdf` | `2017/2017-I/Задочен/7-8.pdf` |
| `astro-spba-2019-i-9-solutions-zao` | `2019/2017-I/Задочен/9.pdf` | `2017/2017-I/Задочен/9.pdf` |
| `astro-spba-2019-i-10-solutions-ray` | `2019/2017-I/Районен/10.pdf` | `2017/2017-I/Районен/10.pdf` |
| `astro-spba-2019-i-11-solutions-ray` | `2019/2017-I/Районен/11.pdf` | `2017/2017-I/Районен/11.pdf` |
| `astro-spba-2019-i-5-7-solutions-ray` | `2019/2017-I/Районен/5-7.pdf` | `2017/2017-I/Районен/5-7.pdf` |
| `astro-spba-2019-i-8-9-solutions-ray` | `2019/2017-I/Районен/8-9.pdf` | `2017/2017-I/Районен/8-9.pdf` |
| `astro-spba-2019-ii-10-solutions-pract` | `2019/2017-II/10/pract.pdf` | `2017/2017-II/10/pract.pdf` |
| `astro-spba-2019-ii-10-solutions-theo` | `2019/2017-II/10/theo.pdf` | `2017/2017-II/10/theo.pdf` |
| `astro-spba-2019-ii-11-solutions-pract` | `2019/2017-II/11/pract.pdf` | `2017/2017-II/11/pract.pdf` |
| `astro-spba-2019-ii-11-solutions-theo` | `2019/2017-II/11/theo.pdf` | `2017/2017-II/11/theo.pdf` |
| `astro-spba-2019-ii-5-6-solutions-pract` | `2019/2017-II/5-6/pract.pdf` | `2017/2017-II/5-6/pract.pdf` |
| `astro-spba-2019-ii-5-6-solutions-theo` | `2019/2017-II/5-6/theo.pdf` | `2017/2017-II/5-6/theo.pdf` |
| `astro-spba-2019-ii-7-8-solutions-pract` | `2019/2017-II/7-8/pract.pdf` | `2017/2017-II/7-8/pract.pdf` |
| `astro-spba-2019-ii-7-8-solutions-theo` | `2019/2017-II/7-8/theo.pdf` | `2017/2017-II/7-8/theo.pdf` |
| `astro-spba-2019-ii-9-solutions-pract` | `2019/2017-II/9/pract.pdf` | `2017/2017-II/9/pract.pdf` |
| `astro-spba-2019-ii-9-solutions-theo` | `2019/2017-II/9/theo.pdf` | `2017/2017-II/9/theo.pdf` |
| `astro-spba-2020-i-10-solutions-zao` | `2020/2017-I/Задочен/10.pdf` | `2017/2017-I/Задочен/10.pdf` |
| `astro-spba-2020-i-11-solutions-zao` | `2020/2017-I/Задочен/11.pdf` | `2017/2017-I/Задочен/11.pdf` |
| `astro-spba-2020-i-5-6-solutions-zao` | `2020/2017-I/Задочен/5-6.pdf` | `2017/2017-I/Задочен/5-6.pdf` |
| `astro-spba-2020-i-7-8-solutions-zao` | `2020/2017-I/Задочен/7-8.pdf` | `2017/2017-I/Задочен/7-8.pdf` |
| `astro-spba-2020-i-9-solutions-zao` | `2020/2017-I/Задочен/9.pdf` | `2017/2017-I/Задочен/9.pdf` |
| `astro-spba-2020-i-10-solutions-ray` | `2020/2017-I/Районен/10.pdf` | `2017/2017-I/Районен/10.pdf` |
| `astro-spba-2020-i-11-solutions-ray` | `2020/2017-I/Районен/11.pdf` | `2017/2017-I/Районен/11.pdf` |
| `astro-spba-2020-i-5-7-solutions-ray` | `2020/2017-I/Районен/5-7.pdf` | `2017/2017-I/Районен/5-7.pdf` |
| `astro-spba-2020-i-8-9-solutions-ray` | `2020/2017-I/Районен/8-9.pdf` | `2017/2017-I/Районен/8-9.pdf` |
| `astro-spba-2020-ii-10-solutions-pract` | `2020/2017-II/10/pract.pdf` | `2017/2017-II/10/pract.pdf` |
| `astro-spba-2020-ii-10-solutions-theo` | `2020/2017-II/10/theo.pdf` | `2017/2017-II/10/theo.pdf` |
| `astro-spba-2020-ii-11-solutions-pract` | `2020/2017-II/11/pract.pdf` | `2017/2017-II/11/pract.pdf` |
| `astro-spba-2020-ii-11-solutions-theo` | `2020/2017-II/11/theo.pdf` | `2017/2017-II/11/theo.pdf` |
| `astro-spba-2020-ii-5-6-solutions-pract` | `2020/2017-II/5-6/pract.pdf` | `2017/2017-II/5-6/pract.pdf` |
| `astro-spba-2020-ii-5-6-solutions-theo` | `2020/2017-II/5-6/theo.pdf` | `2017/2017-II/5-6/theo.pdf` |
| `astro-spba-2020-ii-7-8-solutions-pract` | `2020/2017-II/7-8/pract.pdf` | `2017/2017-II/7-8/pract.pdf` |
| `astro-spba-2020-ii-7-8-solutions-theo` | `2020/2017-II/7-8/theo.pdf` | `2017/2017-II/7-8/theo.pdf` |
| `astro-spba-2020-ii-9-solutions-pract` | `2020/2017-II/9/pract.pdf` | `2017/2017-II/9/pract.pdf` |
| `astro-spba-2020-ii-9-solutions-theo` | `2020/2017-II/9/theo.pdf` | `2017/2017-II/9/theo.pdf` |
| `astro-spba-2021-i-10-solutions-zao` | `2021/2017-I/Задочен/10.pdf` | `2017/2017-I/Задочен/10.pdf` |
| `astro-spba-2021-i-11-solutions-zao` | `2021/2017-I/Задочен/11.pdf` | `2017/2017-I/Задочен/11.pdf` |
| `astro-spba-2021-i-5-6-solutions-zao` | `2021/2017-I/Задочен/5-6.pdf` | `2017/2017-I/Задочен/5-6.pdf` |
| `astro-spba-2021-i-7-8-solutions-zao` | `2021/2017-I/Задочен/7-8.pdf` | `2017/2017-I/Задочен/7-8.pdf` |
| `astro-spba-2021-i-9-solutions-zao` | `2021/2017-I/Задочен/9.pdf` | `2017/2017-I/Задочен/9.pdf` |
| `astro-spba-2021-i-10-solutions-ray` | `2021/2017-I/Районен/10.pdf` | `2017/2017-I/Районен/10.pdf` |
| `astro-spba-2021-i-11-solutions-ray` | `2021/2017-I/Районен/11.pdf` | `2017/2017-I/Районен/11.pdf` |
| `astro-spba-2021-i-5-7-solutions-ray` | `2021/2017-I/Районен/5-7.pdf` | `2017/2017-I/Районен/5-7.pdf` |
| `astro-spba-2021-i-8-9-solutions-ray` | `2021/2017-I/Районен/8-9.pdf` | `2017/2017-I/Районен/8-9.pdf` |
| `astro-spba-2021-ii-10-solutions-pract` | `2021/2017-II/10/pract.pdf` | `2017/2017-II/10/pract.pdf` |
| `astro-spba-2021-ii-10-solutions-theo` | `2021/2017-II/10/theo.pdf` | `2017/2017-II/10/theo.pdf` |
| `astro-spba-2021-ii-11-solutions-pract` | `2021/2017-II/11/pract.pdf` | `2017/2017-II/11/pract.pdf` |
| `astro-spba-2021-ii-11-solutions-theo` | `2021/2017-II/11/theo.pdf` | `2017/2017-II/11/theo.pdf` |
| `astro-spba-2021-ii-5-6-solutions-pract` | `2021/2017-II/5-6/pract.pdf` | `2017/2017-II/5-6/pract.pdf` |
| `astro-spba-2021-ii-5-6-solutions-theo` | `2021/2017-II/5-6/theo.pdf` | `2017/2017-II/5-6/theo.pdf` |
| `astro-spba-2021-ii-7-8-solutions-pract` | `2021/2017-II/7-8/pract.pdf` | `2017/2017-II/7-8/pract.pdf` |
| `astro-spba-2021-ii-7-8-solutions-theo` | `2021/2017-II/7-8/theo.pdf` | `2017/2017-II/7-8/theo.pdf` |
| `astro-spba-2021-ii-9-solutions-pract` | `2021/2017-II/9/pract.pdf` | `2017/2017-II/9/pract.pdf` |
| `astro-spba-2021-ii-9-solutions-theo` | `2021/2017-II/9/theo.pdf` | `2017/2017-II/9/theo.pdf` |
| `astro-spba-2022-i-10-solutions-zao` | `2022/2017-I/Задочен/10.pdf` | `2017/2017-I/Задочен/10.pdf` |
| `astro-spba-2022-i-11-solutions-zao` | `2022/2017-I/Задочен/11.pdf` | `2017/2017-I/Задочен/11.pdf` |
| `astro-spba-2022-i-5-6-solutions-zao` | `2022/2017-I/Задочен/5-6.pdf` | `2017/2017-I/Задочен/5-6.pdf` |
| `astro-spba-2022-i-7-8-solutions-zao` | `2022/2017-I/Задочен/7-8.pdf` | `2017/2017-I/Задочен/7-8.pdf` |
| `astro-spba-2022-i-9-solutions-zao` | `2022/2017-I/Задочен/9.pdf` | `2017/2017-I/Задочен/9.pdf` |
| `astro-spba-2022-i-10-solutions-ray` | `2022/2017-I/Районен/10.pdf` | `2017/2017-I/Районен/10.pdf` |
| `astro-spba-2022-i-11-solutions-ray` | `2022/2017-I/Районен/11.pdf` | `2017/2017-I/Районен/11.pdf` |
| `astro-spba-2022-i-5-7-solutions-ray` | `2022/2017-I/Районен/5-7.pdf` | `2017/2017-I/Районен/5-7.pdf` |
| `astro-spba-2022-i-8-9-solutions-ray` | `2022/2017-I/Районен/8-9.pdf` | `2017/2017-I/Районен/8-9.pdf` |
| `astro-spba-2022-ii-10-solutions-pract` | `2022/2017-II/10/pract.pdf` | `2017/2017-II/10/pract.pdf` |
| `astro-spba-2022-ii-10-solutions-theo` | `2022/2017-II/10/theo.pdf` | `2017/2017-II/10/theo.pdf` |
| `astro-spba-2022-ii-11-solutions-pract` | `2022/2017-II/11/pract.pdf` | `2017/2017-II/11/pract.pdf` |
| `astro-spba-2022-ii-11-solutions-theo` | `2022/2017-II/11/theo.pdf` | `2017/2017-II/11/theo.pdf` |
| `astro-spba-2022-ii-5-6-solutions-pract` | `2022/2017-II/5-6/pract.pdf` | `2017/2017-II/5-6/pract.pdf` |
| `astro-spba-2022-ii-5-6-solutions-theo` | `2022/2017-II/5-6/theo.pdf` | `2017/2017-II/5-6/theo.pdf` |
| `astro-spba-2022-ii-7-8-solutions-pract` | `2022/2017-II/7-8/pract.pdf` | `2017/2017-II/7-8/pract.pdf` |
| `astro-spba-2022-ii-7-8-solutions-theo` | `2022/2017-II/7-8/theo.pdf` | `2017/2017-II/7-8/theo.pdf` |
| `astro-spba-2022-ii-9-solutions-pract` | `2022/2017-II/9/pract.pdf` | `2017/2017-II/9/pract.pdf` |
| `astro-spba-2022-ii-9-solutions-theo` | `2022/2017-II/9/theo.pdf` | `2017/2017-II/9/theo.pdf` |

Всички ключове са с префикс `Астрономия/Състезания/Санкт-Петербургска/`.

**Забележка след изтриването:** щом десетте фалшиви файла в `2018/2018-II/` изчезнат, автентичните `2018-II/*/* (Mega).pdf` могат да загубят суфикса „ (Mega)“ и да станат `theo.pdf` / `pract.pdf`. Това изисква и преименуване на обекта в R2, и промяна на `file` в записа.

### 5.2 (B) 91 записа с грешен `type`

Това е дефект, който хешовете никога не биха хванали. **Всичките 91 СПбАО-записа от `additions-stefan-b3.json`** (и точно те) имат грешен тип. Те са същевременно целият автентичен корпус за 2018–2022 без деветте файла в `2018-I`.

- 86 са каталогизирани като `условия` или `материали`, а главата на страницата гласи „…тур, **решения**“ и тялото съдържа разработени „Решение:“ блокове (един файл дори печата „Комментарии: … 4 балла“ — критерии за оценяване).
- 5 (българските преводи в `2020/2020-I/remote/bg/`) са каталогизирани като `материали`, а са **условия** — без решения.

| Каталожен id | Ключ | Сегашен `type` | Правилен |
|---|---|---|---|
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2018-2018-ii-10-pract-mega-pdf` | `2018/2018-II/10/pract (Mega).pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2018-2018-ii-10-theo-mega-pdf` | `2018/2018-II/10/theo (Mega).pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2018-2018-ii-11-pract-mega-pdf` | `2018/2018-II/11/pract (Mega).pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2018-2018-ii-11-theo-mega-pdf` | `2018/2018-II/11/theo (Mega).pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2018-2018-ii-5-6-pract-mega-pdf` | `2018/2018-II/5-6/pract (Mega).pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2018-2018-ii-5-6-theo-mega-pdf` | `2018/2018-II/5-6/theo (Mega).pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2018-2018-ii-7-8-pract-mega-pdf` | `2018/2018-II/7-8/pract (Mega).pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2018-2018-ii-7-8-theo-mega-pdf` | `2018/2018-II/7-8/theo (Mega).pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2018-2018-ii-9-pract-mega-pdf` | `2018/2018-II/9/pract (Mega).pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2018-2018-ii-9-theo-mega-pdf` | `2018/2018-II/9/theo (Mega).pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-i-regional-10-pdf` | `2019/2019-I/regional/10.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-i-regional-11-pdf` | `2019/2019-I/regional/11.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-i-regional-5-7-pdf` | `2019/2019-I/regional/5-7.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-i-regional-8-9-pdf` | `2019/2019-I/regional/8-9.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-i-remote-10-pdf` | `2019/2019-I/remote/10.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-i-remote-11-pdf` | `2019/2019-I/remote/11.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-i-remote-5-6-pdf` | `2019/2019-I/remote/5-6.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-i-remote-7-8-pdf` | `2019/2019-I/remote/7-8.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-i-remote-9-pdf` | `2019/2019-I/remote/9.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-ii-10-pract-pdf` | `2019/2019-II/10/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-ii-10-theo-pdf` | `2019/2019-II/10/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-ii-11-pract-pdf` | `2019/2019-II/11/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-ii-11-theo-pdf` | `2019/2019-II/11/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-ii-5-6-pract-pdf` | `2019/2019-II/5-6/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-ii-5-6-theo-pdf` | `2019/2019-II/5-6/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-ii-7-8-pract-pdf` | `2019/2019-II/7-8/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-ii-7-8-theo-pdf` | `2019/2019-II/7-8/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-ii-9-pract-pdf` | `2019/2019-II/9/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-ii-9-theo-pdf` | `2019/2019-II/9/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-regional-10-pdf` | `2020/2020-I/regional/10.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-regional-11-pdf` | `2020/2020-I/regional/11.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-regional-5-7-pdf` | `2020/2020-I/regional/5-7.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-regional-8-9-pdf` | `2020/2020-I/regional/8-9.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-remote-10-pdf` | `2020/2020-I/remote/10.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-remote-11-pdf` | `2020/2020-I/remote/11.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-remote-5-6-pdf` | `2020/2020-I/remote/5-6.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-remote-7-8-pdf` | `2020/2020-I/remote/7-8.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-remote-9-pdf` | `2020/2020-I/remote/9.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-remote-bg-spbao19-10klas-pdf` | `2020/2020-I/remote/bg/spbao19_10klas.pdf` | материали | **условия** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-remote-bg-spbao19-11klas-pdf` | `2020/2020-I/remote/bg/spbao19_11klas.pdf` | материали | **условия** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-remote-bg-spbao19-56klas-pdf` | `2020/2020-I/remote/bg/spbao19_56klas.pdf` | материали | **условия** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-remote-bg-spbao19-78klas-pdf` | `2020/2020-I/remote/bg/spbao19_78klas.pdf` | материали | **условия** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-remote-bg-spbao19-9klas-pdf` | `2020/2020-I/remote/bg/spbao19_9klas.pdf` | материали | **условия** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-ii-10-pract-pdf` | `2020/2020-II/10/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-ii-10-theo-pdf` | `2020/2020-II/10/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-ii-11-pract-pdf` | `2020/2020-II/11/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-ii-11-theo-pdf` | `2020/2020-II/11/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-ii-5-6-pract-pdf` | `2020/2020-II/5-6/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-ii-5-6-theo-pdf` | `2020/2020-II/5-6/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-ii-7-8-pract-pdf` | `2020/2020-II/7-8/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-ii-7-8-theo-pdf` | `2020/2020-II/7-8/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-ii-9-pract-pdf` | `2020/2020-II/9/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-ii-9-theo-pdf` | `2020/2020-II/9/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-i-regional-10-pdf` | `2021/2021-I/regional/10.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-i-regional-11-pdf` | `2021/2021-I/regional/11.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-i-regional-5-7-pdf` | `2021/2021-I/regional/5-7.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-i-regional-8-9-pdf` | `2021/2021-I/regional/8-9.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-i-remote-10-pdf` | `2021/2021-I/remote/10.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-i-remote-11-pdf` | `2021/2021-I/remote/11.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-i-remote-5-6-pdf` | `2021/2021-I/remote/5-6.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-i-remote-7-8-pdf` | `2021/2021-I/remote/7-8.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-i-remote-9-pdf` | `2021/2021-I/remote/9.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-ii-10-pract-pdf` | `2021/2021-II/10/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-ii-10-theo-pdf` | `2021/2021-II/10/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-ii-11-pract-pdf` | `2021/2021-II/11/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-ii-11-theo-pdf` | `2021/2021-II/11/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-ii-5-6-pract-pdf` | `2021/2021-II/5-6/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-ii-5-6-theo-pdf` | `2021/2021-II/5-6/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-ii-7-8-pract-pdf` | `2021/2021-II/7-8/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-ii-7-8-theo-pdf` | `2021/2021-II/7-8/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-ii-9-pract-pdf` | `2021/2021-II/9/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-ii-9-theo-pdf` | `2021/2021-II/9/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-i-regional-10-pdf` | `2022/2022-I/regional/10.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-i-regional-11-pdf` | `2022/2022-I/regional/11.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-i-regional-5-7-pdf` | `2022/2022-I/regional/5-7.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-i-regional-8-9-pdf` | `2022/2022-I/regional/8-9.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-i-remote-10-pdf` | `2022/2022-I/remote/10.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-i-remote-11-pdf` | `2022/2022-I/remote/11.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-i-remote-5-6-pdf` | `2022/2022-I/remote/5-6.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-i-remote-7-8-pdf` | `2022/2022-I/remote/7-8.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-i-remote-9-pdf` | `2022/2022-I/remote/9.pdf` | материали | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-ii-10-pract-pdf` | `2022/2022-II/10/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-ii-10-theo-pdf` | `2022/2022-II/10/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-ii-11-pract-pdf` | `2022/2022-II/11/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-ii-11-theo-pdf` | `2022/2022-II/11/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-ii-5-6-pract-pdf` | `2022/2022-II/5-6/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-ii-5-6-theo-pdf` | `2022/2022-II/5-6/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-ii-7-8-pract-pdf` | `2022/2022-II/7-8/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-ii-7-8-theo-pdf` | `2022/2022-II/7-8/theo.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-ii-9-pract-pdf` | `2022/2022-II/9/pract.pdf` | условия | **решения** |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-ii-9-theo-pdf` | `2022/2022-II/9/theo.pdf` | условия | **решения** |

*Странична бележка за консистентност:* българските преводи от 2016 г. са каталогизирани с `type: translation` (`astro-spba-2016-i-*-translation-zao-*`). Петте български файла от 2020 г. вероятно трябва да получат същия тип, а не `условия`. Това е решение за схемата, не находка от страницата.

### 5.3 (C) 34 записа, които изобщо не са СПбАО

Тези файлове носят главата на **Всеросийската олимпиада (ВсОШ)** — районен или общински етап — с различна емблема и без римска цифра. Каталогизирани са като СПбАО. Годината/сезонът на папката е верен; грешно е състезанието.

| Каталожен id | Ключ | Какво реално печата страницата |
|---|---|---|
| `astro-spba-2016-i-10-solutions-ray` | `2016/2016-I/Районен/10.pdf` | ВсОШ районен етап, Санкт-Петербург, 21.11.2015 — условия (без решения) |
| `astro-spba-2016-i-11-solutions-ray` | `2016/2016-I/Районен/11.pdf` | ВсОШ районен етап, Санкт-Петербург, 21.11.2015 — условия (без решения) |
| `astro-spba-2016-i-5-7-solutions-ray` | `2016/2016-I/Районен/5-7.pdf` | ВсОШ районен етап, Санкт-Петербург, 21.11.2015 — условия (без решения) |
| `astro-spba-2016-i-8-9-solutions-ray` | `2016/2016-I/Районен/8-9.pdf` | ВсОШ районен етап, Санкт-Петербург, 21.11.2015 — условия (без решения) |
| `astro-spba-2017-i-10-solutions-ray` | `2017/2017-I/Районен/10.pdf` | ВсОШ районен етап, Санкт-Петербург, 28.11.2016 — решения |
| `astro-spba-2017-i-11-solutions-ray` | `2017/2017-I/Районен/11.pdf` | ВсОШ районен етап, Санкт-Петербург, 28.11.2016 — решения |
| `astro-spba-2017-i-5-7-solutions-ray` | `2017/2017-I/Районен/5-7.pdf` | ВсОШ районен етап, Санкт-Петербург, 28.11.2016 — решения |
| `astro-spba-2017-i-8-9-solutions-ray` | `2017/2017-I/Районен/8-9.pdf` | ВсОШ районен етап, Санкт-Петербург, 28.11.2016 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-i-regional-10-pdf` | `2019/2019-I/regional/10.pdf` | ВсОШ районен етап, Санкт-Петербург, 21.11.2018 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-i-regional-11-pdf` | `2019/2019-I/regional/11.pdf` | ВсОШ районен етап, Санкт-Петербург, 21.11.2018 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-i-regional-5-7-pdf` | `2019/2019-I/regional/5-7.pdf` | ВсОШ районен етап, Санкт-Петербург, 21.11.2018 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2019-2019-i-regional-8-9-pdf` | `2019/2019-I/regional/8-9.pdf` | ВсОШ районен етап, Санкт-Петербург, 21.11.2018 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-regional-10-pdf` | `2020/2020-I/regional/10.pdf` | ВсОШ районен етап, Санкт-Петербург, 20.11.2019 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-regional-11-pdf` | `2020/2020-I/regional/11.pdf` | ВсОШ районен етап, Санкт-Петербург, 20.11.2019 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-regional-5-7-pdf` | `2020/2020-I/regional/5-7.pdf` | ВсОШ районен етап, Санкт-Петербург, 20.11.2019 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2020-2020-i-regional-8-9-pdf` | `2020/2020-I/regional/8-9.pdf` | ВсОШ районен етап, Санкт-Петербург, 20.11.2019 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-i-regional-10-pdf` | `2021/2021-I/regional/10.pdf` | ВсОШ районен етап, Санкт-Петербург, 27.11.2020 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-i-regional-11-pdf` | `2021/2021-I/regional/11.pdf` | ВсОШ районен етап, Санкт-Петербург, 27.11.2020 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-i-regional-5-7-pdf` | `2021/2021-I/regional/5-7.pdf` | ВсОШ районен етап, Санкт-Петербург, 27.11.2020 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2021-2021-i-regional-8-9-pdf` | `2021/2021-I/regional/8-9.pdf` | ВсОШ районен етап, Санкт-Петербург, 27.11.2020 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-i-regional-10-pdf` | `2022/2022-I/regional/10.pdf` | ВсОШ районен етап, Санкт-Петербург, 13.11.2021 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-i-regional-11-pdf` | `2022/2022-I/regional/11.pdf` | ВсОШ районен етап, Санкт-Петербург, 13.11.2021 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-i-regional-5-7-pdf` | `2022/2022-I/regional/5-7.pdf` | ВсОШ районен етап, Санкт-Петербург, 13.11.2021 — решения |
| `stef26c-astronomiya-sastezaniya-sankt-peterburgska-2022-2022-i-regional-8-9-pdf` | `2022/2022-I/regional/8-9.pdf` | ВсОШ районен етап, Санкт-Петербург, 13.11.2021 — решения |
| `stef26-sankt-peterburgska-2023-2023-i-regional-spb-city-10` | `2023/2023-I/regional/spb-city/10.pdf` | ВсОШ районен етап, Санкт-Петербург (град), 12.11.2022 — решения |
| `stef26-sankt-peterburgska-2023-2023-i-regional-spb-city-11` | `2023/2023-I/regional/spb-city/11.pdf` | ВсОШ районен етап, Санкт-Петербург (град), 12.11.2022 — решения |
| `stef26-sankt-peterburgska-2023-2023-i-regional-spb-city-5-7` | `2023/2023-I/regional/spb-city/5-7.pdf` | ВсОШ районен етап, Санкт-Петербург (град), 12.11.2022 — решения |
| `stef26-sankt-peterburgska-2023-2023-i-regional-spb-city-8` | `2023/2023-I/regional/spb-city/8.pdf` | ВсОШ районен етап, Санкт-Петербург (град), 12.11.2022 — решения |
| `stef26-sankt-peterburgska-2023-2023-i-regional-spb-city-9` | `2023/2023-I/regional/spb-city/9.pdf` | ВсОШ районен етап, Санкт-Петербург (град), 12.11.2022 — решения |
| `stef26-sankt-peterburgska-2023-2023-i-regional-spb-region-10` | `2023/2023-I/regional/spb-region/10.pdf` | ВсОШ общински етап, Ленинградска област, 17.11.2022 — решения |
| `stef26-sankt-peterburgska-2023-2023-i-regional-spb-region-11` | `2023/2023-I/regional/spb-region/11.pdf` | ВсОШ общински етап, Ленинградска област, 17.11.2022 — решения |
| `stef26-sankt-peterburgska-2023-2023-i-regional-spb-region-5-7` | `2023/2023-I/regional/spb-region/5-7.pdf` | ВсОШ общински етап, Ленинградска област, 17.11.2022 — решения |
| `stef26-sankt-peterburgska-2023-2023-i-regional-spb-region-8` | `2023/2023-I/regional/spb-region/8.pdf` | ВсОШ общински етап, Ленинградска област, 17.11.2022 — решения |
| `stef26-sankt-peterburgska-2023-2023-i-regional-spb-region-9` | `2023/2023-I/regional/spb-region/9.pdf` | ВсОШ общински етап, Ленинградска област, 17.11.2022 — решения |

Забележки:

- `2018/2018-I/Районен/*` (4 файла) **не** са в този списък — те печатат „XXV Санкт-Петербургская астрономическая олимпиада / 2017 / 23 ноября“, т.е. са автентични СПбАО-листове. Смяната на марката настъпва точно след тях.
- Четирите файла `2016/2016-I/Районен/*` имат и втори дефект: каталогизирани са `solutions`, а съдържат **само условия** (в тях няма „Решение“).
- Още 16 ВсОШ-файла съществуват като копия вътре в списъка от §5.1 (`2019|2020|2021|2022 / 2017-I/Районен/*`); те така или иначе отпадат при изтриването.

### 5.4 (D) 7 единични грешки извън горните групи

| Каталожен id | Ключ | Дефект | Правилен етикет |
|---|---|---|---|
| `astro-spba-2009-i-9-solutions-zao` | `2009/2009-I/Задочен/9.pdf` | Страницата е озаглавена „Задачи и решения (**10 класс**)“ и текстът ѝ е дословно същият като `2009-I/Задочен/10.pdf` (6523 знака, идентични). **md5 не го хваща — двата файла са с различни байтове, но с еднакъв текст.** | Това е листът за 10 клас. **Автентичният лист за 9 клас липсва.** |
| `astro-spba-2011-ii-10-solutions-pract` | `2011/2011-II/10/pract.pdf` | Байт-идентичен с `2011-II/9/pract.pdf`; главата печата „XVIII … практический тур … 2011 … 13 марта“ над черта „**9 класс**“ | Лист за 9 клас; типът също е `условия`, не `решения` |
| `astro-spba-2011-ii-11-solutions-pract` | `2011/2011-II/11/pract.pdf` | същото | същото |
| `stef26-sankt-peterburgska-2023-2023-ii-10-10-klass-resheniya-49` | `2023/2023-II/10/10 класс - решения_49.pdf` | Печата „**XXXI** … 2024 … 4 февраля“; байт-идентичен с `2024/2024-II/10/theo.pdf` | Сезон **2024**, II кръг, теоретичен, 10 клас — но копието там вече съществува, така че записът е излишен |
| `stef26-sankt-peterburgska-2023-2023-ii-5-6-5-6-klassy-resheniya-40` | `2023/2023-II/5-6/5-6 классы - решения_40.pdf` | същото (5-6 клас) | излишен; `2024/2024-II/5-6/theo.pdf` |
| `stef26-sankt-peterburgska-2023-2023-ii-7-8-7-8-klassy-resheniya-41` | `2023/2023-II/7-8/7-8 классы - решения_41.pdf` | същото (7-8 клас) | излишен; `2024/2024-II/7-8/theo.pdf` |
| `stef26-sankt-peterburgska-2023-2023-ii-9-9-klass-resheniya-41` | `2023/2023-II/9/9 класс - решения_41.pdf` | същото (9 клас) | излишен; `2024/2024-II/9/theo.pdf` |

Папката 2023 вече държи собствените си коректни `theo.pdf` за тези класове (печатат „XXX … 2023 … 12 февраля“), така че четирите блуждаещи файла не запълват нищо.

---

## 6. Какво беше възстановено по време на разследването

**Качени в R2: 0 файла. Изтрити: 0. Променени каталожни записи: 0.** Всичко е диагностика; разрушителните стъпки са оставени на собственика.

Възстановеното е доказателство и материал, готов за поглъщане:

1. **120 официални PDF от организатора** — `…/scratchpad/spb/web/pdf/` (53 MB), покриващи сезоните 2018–2023, свободни, без регистрация, с директни линкове. Всеки съдържа условията **и** официалните решения. Пълна таблица (url, етикет, размер, md5, суров masthead) в `…/scratchpad/spb/web/manifest.json`.
2. **24 PDF от РСОШ-огледалото** — `…/scratchpad/spb/web/rsr/` (8,5 MB). Тук условията и решенията са в **отделни файлове** (`*_tasks.pdf` / `*_ans.pdf`) — единственият намерен източник, който позволява архивът да предлага чисти условия отделно от решенията, поне за 11 клас.
3. **Доказателството за автентичност** — 114/120 байт-съвпадения между сайта на организатора и R2. Това превръща „вярваме на Mega-архива на Стефан“ в „проверено срещу първоизточника“.
4. **Шест по-нови компилации** на съществуващи документи (5 × XXVII теоретичен, 1 × XXX теоретичен, 10 клас) — могат да заменят текущите обекти, ако се предпочита текущата версия на организатора.
5. **Фалшива тревога, приключена:** 9 файла в Mega (`aolymp/spb/2018/2018-I/{regional,remote}/*.pdf`), пропуснати от по-ранния план за поглъщане (`unify-state/plan_astro_spb.json`), се оказаха вече в R2 под българските имена `2018/2018-I/{Районен,Задочен}/`. И деветте съвпадат по размер; два бяха свалени наново с `megadl` и са байт-идентични (`bf5c5d21…`, `b9bba43b…`).
6. **Изчерпани източници:** и 338-те SPb файла в Mega-манифеста, и Drive-дървото `Astronomy/astroolymp_public/Saint-Petersberg` (което свършва при `2018/2018-I`) са строго подмножество на това, което вече е в R2.

---

## 7. Какво още липсва

Подредено по това колко сигурна е липсата.

### 7.1 Сигурни липси

| # | Какво липсва | Доказателство | Конкретен път за набавяне |
|---|---|---|---|
| 1 | **СПбАО 2009, I кръг (задочен), 9 клас** | `2009-I/Задочен/9.pdf` е листът за 10 клас — страницата е озаглавена „Задачи и решения (10 класс)“ и целият ѝ текст съвпада с `10.pdf`. Няма друг файл за 9 клас | Индексът на организатора за 2008-2009 (`?q=node/115`) изрежда „Задачи и решения“ по клас: **9 клас = `http://school.astro.spbu.ru/?q=node/91`**. Тегли по HTTP (не по HTTPS) |
| 2 | **СПбАО 2008, „Второй тур“ — целият** | Архивът има само `2008-I` (районен) и `2008-II` (= „первый тур“). Индексът на сезон 2007-2008 (`?q=node/71`) изрежда трети етап „Второй тур“ | `http://school.astro.spbu.ru/?q=node/68` |
| 3 | **СПбАО 2014, I кръг (задочен) за 7-8, 9, 10 и 11 клас** | `2014-I/Задочен/` съдържа само `uslovia.pdf` и `reshenia.pdf`, и двата за **5-6 клас** (проверено на страницата: „XXI … заочный отборочный тур … 2013, 5 декабря … 5-6 классы“) | Страница „Заочный тур“ за сезон 2013-2014: `http://school.astro.spbu.ru/?q=node/445` |
| 4 | **Отделни условия (без решения) за почти целия корпус** | 331 от 423-те обекта са `решения` — условията и решенията са в един и същ файл. Отделни условия има само за 2014 (5-6 клас), 2011 (практически) и българските преводи | РСОШ-огледалото публикува условията и отговорите в отделни файлове: `rsr-olymp.ru`, вече свалени 24 такива за 11 клас в `…/scratchpad/spb/web/rsr/`. За другите класове — същият шаблон на URL |
| 5 | **ВсОШ 2023, районен етап, 5-6 клас (СПб-град)** | `2023-I/regional/spb-city/5-7.pdf` печата „**7 класс**“, не „5–7 классы“. Съседният файл за областта (`spb-region/5-7.pdf`) наистина печата „5–7 классы“, значи разликата е реална, а не стилова | Страница „Районный и муниципальный тур“ 2022-2023: `http://school.astro.spbu.ru/?q=node/649` |

### 7.2 Вероятни липси — маркирани като несигурни

| # | Какво | Защо е несигурно | Как се проверява |
|---|---|---|---|
| 6 | **СПбАО 2011, практически тур, 10 и 11 клас** | `2011-II/10/pract.pdf` и `11/pract.pdf` са байт-идентични с листа за 9 клас. Възможно е обаче през 2011 г. практическият тур наистина да е бил **общ** за 9–11 клас — тогава нищо не липсва, а е грешен само класът в записа | `http://school.astro.spbu.ru/?q=node/285` (Практический тур, сезон 2010-2011) — виж дали сайтът изобщо предлага отделни листове по клас |
| 7 | **СПбАО 2011, практически тур, разграничение 5-6 / 7-8** | `2011-II/5-6/pract.pdf` и `7-8/pract.pdf` са байт-идентични и **нямат никакъв masthead** — страницата започва направо с „Задача №1. Вам дано изображение Солнца…“. Най-много един от двата класа може да е верен, но самата страница не казва кой | същият възел `?q=node/285` |
| 8 | **СПбАО 2010, практически тур — целият** | Архивът има само `2010-II/Теоретичен/`. Индексът на организатора за сезон 2009-2010 (`?q=node/126`) също изрежда само районен и теоретичен тур — тоест липсата вероятно отразява реалността, а не празнина в архива | Ако е нужна сигурност: `http://school.astro.spbu.ru/?q=node/195` и съседните възли; или `web.archive.org` за `?q=node/126` |
| 9 | **Цялата 2009 г. е недатируема от страницата** | И десетте файла (`2009-I/Задочен/*`, `2009-II/*`) нямат никаква глава — нито име на олимпиада, нито римска цифра, нито година. Приемането, че папката 2009 е вярна, почива само на структурата на архива, не на видяно доказателство | Свали листовете от `?q=node/89`…`node/93` (районен) и `node/106`…`node/110` (первый тур) и сравни текста дума по дума |
| 10 | **Български преводи** съществуват само за 2016-I и 2020-I | Не е ясно дали някога са правени за други години | Въпрос към Стефан / архивите на българската астрономическа общност; извън обхвата на този одит |

### 7.3 Какво НЕ липсва, макар да изглежда така

- **2018–2022** — пълни. Вж. §3 и §4.
- **Ковид** — нищо не е било отменяно. Практическият тур на XXVII се е провел на 1 март 2020 г., точно преди затварянето; районният кръг на XXVIII се е провел **присъствено в училищата на 27 ноември 2020 г.** (прочетено от главата на самия лист).
- **2022 в `olimpiada.ru`** — агрегаторът отговаря „К сожалению, у нас нет заданий … за 2022 год“. Това е празнина в агрегатора: сайтът на организатора има целия комплект XXIX, а `rsr-olymp.ru` го сервира под етикет 2021 (началната година).

---

## 8. Къде доказателството е тънко

Честно казано:

1. **Правилото „издание N ↔ папка 1993+N“** е изведено от наблюдение върху целия архив (XV=2008 … XXXIII=2026) и се потвърждава от заглавията на страниците на организатора за 2018–2023. Не съм видял официален документ, който да го формулира.
2. **Годината, отпечатана върху задочния лист**, се държи различно преди и след XXIII. Формулировката в §2(в) е обобщение на видените страници, не документирано правило на организатора.
3. **11 файла не могат да бъдат датирани от страницата изобщо** — десетте файла от 2009 г. и двата практически листа 5-6 / 7-8 от 2011 г. Всичко твърдяно за тях почива на структурата на архива.
4. **Пет DOCX файла (`2016-I/Задочен/bg/*.docx`)** не са рендирани — няма страница. Заключенията за тях са пренесени от PDF-близнаците им.
5. **Възлите на организатора за 2008–2015**, цитирани в §7, са взети от собствения индекс на сайта (`?q=olymp`), който прочетох. **Не съм отварял тези страници и не съм проверявал прикачените към тях файлове.** Те са път за проверка, не потвърден резултат.
6. **Дали „(Mega)“ файловете да заменят имената** е препоръка за подредба, не находка. Съдържанието им е потвърдено; удобното име не е.
7. **Съответствието „5 бр. XXVII теоретични + 1 бр. XXX теоретичен“** е установено по идентична глава и близък размер, не по сравнение на пълния текст. Много малка вероятност да са редактирани по същество, но не е изключена.

---

## 9. Препоръчани действия, по ред

1. **Премахни 86-те записа от §5.1** от `archive-catalog/astronomy-rest.json` и изтрий съответните 86 обекта от R2. Разрушително — изисква изрично потвърждение. Всичките 86 имат байт-идентичен близнак в `2017/`, така че нищо не се губи.
2. **Поправи `type` на 91-те записа от §5.2** в `archive-catalog/additions-stefan-b3.json`: 86 → `решения`/`solutions`, 5 (`…/remote/bg/…`) → `условия`/`problems` (или `translation`, ако се приеме конвенцията от 2016 г.).
3. **Преетикетирай 34-те записа от §5.3** като ВсОШ, а не СПбАО. Ако схемата няма отделно състезание „ВсОШ (Санкт-Петербург)“, добави го — иначе архивът твърди, че районните кръгове след 2018 г. са СПбАО, което не е вярно.
4. **Оправи седемте единични грешки от §5.4**: смени класа на `astro-spba-2009-i-9-solutions-zao` (реално 10 клас) и на двата записа от 2011 г. (реално 9 клас); премахни четирите блуждаещи XXXI/2024 записа от папката 2023.
5. **Преименувай** `2018/2018-II/*/* (Mega).pdf` → `theo.pdf` / `pract.pdf`, след като стъпка 1 е приключила, и обнови `file` в съответните 10 записа.
6. **Запълни петте сигурни липси от §7.1**, като теглиш от посочените възли (по **HTTP**, не HTTPS — `WebFetch` се проваля с `WRONG_VERSION_NUMBER`, използвай `curl`).
7. **Провери трите несигурни случая от §7.2** (2011 практически, 2010 практически, 2009 датировка), преди да ги обявиш за липси в публичния каталог.
8. **Обмисли поглъщане на 24-те РСОШ файла** като отделни `условия` — първата възможност архивът да предлага задачи без решения.
9. **Добави проверка в пайплайна:** нито един запис да не получава `year` от папката, ако главата на страницата противоречи; и да се вдига флаг, когато два обекта в различни годишни папки споделят md5. Тази двойка правила щеше да улови всичките 86 записа при поглъщането.

---

## 10. Произход на дефекта

Не е грешка в процеса на възстановяване. Манифестът на първоначално публикувания сайт (`manifest_published_archive.json`, T7) **вече** е съдържал буквалните пътища `2019/2017-I/…`, `2020/2017-I/…`, `2021/2017-I/…`, `2022/2017-I/…` и `2018/2018-II/*`, напълнени със съдържание от 2017 г. — по 19 записа-заместители на година, без никакъв автентичен материал за 2019–2022. Грешните заглавия в каталога са наследени оттам.

Автентичните комплекти за 2018–2022 са влезли в R2 по-късно, от Mega-архива на Стефан, в отделен проход — и точно затова днес двете дървета съществуват едно до друго.
