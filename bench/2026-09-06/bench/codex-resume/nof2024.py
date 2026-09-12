from adjudicate_physics import *
id='nof-2024-ii-11';t,d,c=start(id,'agent__sonnet');p1,p2,p3=d['problems']
common='Във всички задачи може да приемете, че земното ускорение е известно и има стойност $g = 9{,}8\\ \mathrm{m/s^2}$.\n\nПри решение на задачите, ако не разполагате с подходящ калкулатор, може да използвате таблицата на тригонометричните функции, дадена на трета страница.'
rows='''0 0.0000 1.0000 0.0000 30 0.5000 0.8660 0.5774 60 0.8660 0.5000 1.7321
1 0.0175 0.9998 0.0175 31 0.5150 0.8572 0.6009 61 0.8746 0.4848 1.8040
2 0.0349 0.9994 0.0349 32 0.5299 0.8480 0.6249 62 0.8829 0.4695 1.8807
3 0.0523 0.9986 0.0524 33 0.5446 0.8387 0.6494 63 0.8910 0.4540 1.9626
4 0.0698 0.9976 0.0699 34 0.5592 0.8290 0.6745 64 0.8988 0.4384 2.0503
5 0.0872 0.9962 0.0875 35 0.5736 0.8192 0.7002 65 0.9063 0.4226 2.1445
6 0.1045 0.9945 0.1051 36 0.5878 0.8090 0.7265 66 0.9135 0.4067 2.2460
7 0.1219 0.9925 0.1228 37 0.6018 0.7986 0.7536 67 0.9205 0.3907 2.3559
8 0.1392 0.9903 0.1405 38 0.6157 0.7880 0.7813 68 0.9272 0.3746 2.4751
9 0.1564 0.9877 0.1584 39 0.6293 0.7771 0.8098 69 0.9336 0.3584 2.6051
10 0.1736 0.9848 0.1763 40 0.6428 0.7660 0.8391 70 0.9397 0.3420 2.7475
11 0.1908 0.9816 0.1944 41 0.6561 0.7547 0.8693 71 0.9455 0.3256 2.9042
12 0.2079 0.9781 0.2126 42 0.6691 0.7431 0.9004 72 0.9511 0.3090 3.0777
13 0.2250 0.9744 0.2309 43 0.6820 0.7314 0.9325 73 0.9563 0.2924 3.2709
14 0.2419 0.9703 0.2493 44 0.6947 0.7193 0.9657 74 0.9613 0.2756 3.4874
15 0.2588 0.9659 0.2679 45 0.7071 0.7071 1.0000 75 0.9659 0.2588 3.7321
16 0.2756 0.9613 0.2867 46 0.7193 0.6947 1.0355 76 0.9703 0.2419 4.0108
17 0.2924 0.9563 0.3057 47 0.7314 0.6820 1.0724 77 0.9744 0.2250 4.3315
18 0.3090 0.9511 0.3249 48 0.7431 0.6691 1.1106 78 0.9781 0.2079 4.7046
19 0.3256 0.9455 0.3443 49 0.7547 0.6561 1.1504 79 0.9816 0.1908 5.1446
20 0.3420 0.9397 0.3640 50 0.7660 0.6428 1.1918 80 0.9848 0.1736 5.6713
21 0.3584 0.9336 0.3839 51 0.7771 0.6293 1.2349 81 0.9877 0.1564 6.3138
22 0.3746 0.9272 0.4040 52 0.7880 0.6157 1.2799 82 0.9903 0.1392 7.1154
23 0.3907 0.9205 0.4245 53 0.7986 0.6018 1.3270 83 0.9925 0.1219 8.1443
24 0.4067 0.9135 0.4452 54 0.8090 0.5878 1.3764 84 0.9945 0.1045 9.5144
25 0.4226 0.9063 0.4663 55 0.8192 0.5736 1.4281 85 0.9962 0.0872 11.4301
26 0.4384 0.8988 0.4877 56 0.8290 0.5592 1.4826 86 0.9976 0.0698 14.3007
27 0.4540 0.8910 0.5095 57 0.8387 0.5446 1.5399 87 0.9986 0.0523 19.0811
28 0.4695 0.8829 0.5317 58 0.8480 0.5299 1.6003 88 0.9994 0.0349 28.6363
29 0.4848 0.8746 0.5543 59 0.8572 0.5150 1.6643 89 0.9998 0.0175 57.2900
30 0.5000 0.8660 0.5774 60 0.8660 0.5000 1.7321 90 1.0000 0.0000 _'''
table='**Таблица.** Тригонометрични функции на ъгли от 0 до 90°\n\n| α (°) | sin α | cos α | tg α | α (°) | sin α | cos α | tg α | α (°) | sin α | cos α | tg α |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n'+'\n'.join('| '+' | '.join(s.replace('_','') for s in r.split())+' |' for r in rows.splitlines())
for p in (p1,p2):
 p['statement']=common+'\n\n'+p['statement']+'\n\n'+table
 p['tx']['sourceSpans'].append({'document':'problems','page':3})
 # Source page 1 supplies the shared numerical g for both problems.
 if not any(x=={'document':'problems','page':1} for x in p['tx']['sourceSpans']):p['tx']['sourceSpans'].append({'document':'problems','page':1})
p1['solution']['statement']=p1['solution']['statement'].replace('ос Y с посока','ос Y посока').replace('X e равномерно','X е равномерно')
p3['parts'][0]['statement']=p3['parts'][0]['statement'].replace('при това периодът на','при това периодът $T$ на')
p3['solution']['statement']=p3['solution']['statement'].replace('точката на окачване','точката на окачане').replace(r'v_1 = \sqrt{5g\ell}',r'v_1 = \sqrt{5gl}')
p3['parts'][1]['statement']=p3['parts'][1]['statement'].replace('точката на окачване','точката на окачване') # as printed in problem, unlike solution
for p in d['problems']:p['points']=None
intro='Дадените решения са примерни. Всяко обосновано алтернативно решение се оценява по критерии на областната комисия, но в рамките на максималния брой точки за дадена задача и за дадено подусловие.'
for p in d['problems']:p['solution']['statement']=intro+'\n\n'+p['solution']['statement']
s=[defect('/problems/0/statement','omission','Paper-wide g=9,8 m/s² and full page-3 trig reference table omitted; table is needed for printed numeric work.'),defect('/problems/2/parts/0/statement','omission','Printed period is denoted T; candidate drops symbol T.','minor'),defect('/problems/2/solution/statement','reworded','Printed окачане and final √(5gl) with plain l; candidate окачване and ℓ. Preserve source wording/typeface.','minor'),defect('/problems/0/solution/statement','omission','Shared grading instruction about alternative solutions omitted in all solutions.'),defect('/problems/0/solution/statement','reworded','Printed ос Y посока, candidate inserts с; e Latin replaces Cyrillic е.','minor')]
h=[defect('/problems/0/solution/statement','formula','Eq12 prints 2√(H(H−h))/w; candidate puts w under radical.','critical'),defect('/problems/1/solution/statement','formula','Eq10 prints radical numerator divided by 3m outside root; candidate puts 3m under root.','critical'),defect('/problems/1/solution/statement','omission','Angular-momentum conservation explanation garbled and omitted.' ,'critical'),defect('/problems/2/solution/statement','omission','Equations1–2 and multiple sentences on acceleration/direction grading omitted.','critical'),defect('/problems/0/solution/statement','reworded','Numerous non-source typos (рыба for ръба, букве for буквен, този for тази), incorrect y_c subscript.','major'),defect('/problems/0/statement','omission','Missing shared g, trig table, grading instruction and abbreviated masthead.'),defect('/problems/1/figures','figure','Required ballistic diagram is attached to problem1 with false alt describing bicyclist; problem2 has none.','critical'),defect('/problems/1/statement','omission','Printed hint on inertia appears in solution, absent from statement; неизвеста silently corrected and спрямо changed to прямо.'),defect('/problems/2/parts/0','points','Three printed bullet scores 1,0/3,5/1,0 omitted and replaced by unprinted 5,5 total.')]
g=[defect('/problems/1/solution/statement','formula','Eq10 incorrectly puts denominator 3m inside radical; printed denominator is outside.','critical'),defect('/problems/0/statement','omission','Full page-3 trig table omitted despite mention; grading instruction omitted.'),defect('/problems/0/statement','reworded','Silently fixes printed сгадата and курщум/неизвеста in problem2.','minor'),defect('/problems/1/statement','reworded','Printed Инерчният, candidate Инерционият; Кои/кой becomes Кой/кой; ъгловата becomes ъговата.','minor'),defect('/problems/1/solution/statement','reworded','образуват→образувата, ъгловата→ъговата, максимално→максимально, маса→масата.','minor'),defect('/problems/0/parts/1','reworded','Printed скочи and colon/shared lead altered to скача and merged sentence.','minor')]
for cand,arr in [(t['candidates'][0],h),(t['candidates'][2],g)]:
 for cr in cand['crops']:
  # GLM p2 crop only caption/isolated tiny external fragment, not a missing diagram; minor boundary issue.
  sev='minor' if cr['id']=='p2-fig1' else 'critical'
  arr.append(defect(cr['path'],'figure','Actual crop includes unrelated body text and/or clips required diagram labels. Sonnet equivalent clean crop confirms safe region.',sev))
h += [defect('/problems/0/solution/figures','figure','Coordinate diagram on solutions page1 completely absent.','critical'),defect('/problems/2/solution/figures','figure','Vertical-circle diagram on solutions page5 absent.','critical')]
decisions={'agent__haiku__for-zai__glm-5.3-flash.json':[], 'zai__glm-5.3-flash__for-agent__haiku.json':[(True,'Mostly real typos in problem1 solution (path should /problems/0). But printed Y-координата is correct, and table phrase includes на; those subclaims are false.'),(True,'Only vector bar→arrow is confirmed. сгадата is printed source typo, not reader defect. Path should /problems/0.'),(False,'Printed source itself says курщум; confirmed high-resolution source closeup. Candidate preserves correctly.'),(True,'Angular-momentum justification is corrupted. Path should /problems/1. Ancillary suggested Инерционият and ий are false: source says Инерчният and й.'),(True,'Confirmed missing eq1–2 and grading text; path should /problems/2. Source uses окачане, not checker suggested окачване.'),(True,'Actual crop contains only text and lacks ballistic figure. Path should /problems/0/figures/1.'),(True,'Actual crop clips most of figure3 and contains text. Path should /problems/2/figures/0.'),(False,'Checker explicitly describes acceptable structure; not a defect.')], 'zai__glm-5.3-flash__for-agent__sonnet.json':[(False,'Source itself prints сгадата. Candidate reads допиращ, not alleged дописращ. High-resolution PDF closeup confirms both.'),(False,'Source itself prints курщум, confirmed 3× PDF crop.'),(False,'Informational finding describes correct null score, not a defect.'),(False,'Informational source-error finding correctly observes preserved неизвеста; not a candidate defect.')]}
finish(t,d,c,{'agent__haiku.figs.view.json':h,'agent__sonnet.figs.view.json':s,'zai__glm-5.3-flash.figs.view.json':g},decisions,'Sonnet is closest with all six usable figure crops and correct nested radicals, but omits supplied numerical instructions/reference table. GLM and Haiku fail formula fidelity and figure coverage; Haiku blanket pass on GLM is unsafe. Multiple GLM checker typo allegations are false because they are printed source errors.','All eight pages and sixteen original crops inspected. Printed сгадата, курщум, неизвеста, Y-координата, ос Y посока and final √(5gl) preserved. Page3 table transcribed cell-by-cell in original 12-column layout; decimal dots stay. It is attached to problems1–2 because both use it. Source has no printed total problem scores. Shared solution grading text retained for each standalone problem.')
