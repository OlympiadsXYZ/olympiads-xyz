import json,datetime,copy
from pathlib import Path
root=Path.cwd(); id='nao-1998-iv'; task=json.load(open(f'tmp/bench/codex-resume/astronomy/{id}.task.json')); base=task['candidates'][1]; raw=Path(base['view'].replace('.view.json','.json')); o=json.load(open(raw)); now=datetime.datetime.now(datetime.timezone.utc).isoformat()
def defect(path,kind,description,severity='major'):return dict(path=path,severity=severity,kind=kind,description=description)
# The source has two practical and two observation tasks, in that order.
o['paper'].pop('organiser',None);o['paper'].pop('caveat',None);o['paper']['solutionSource']['pages']=[2]
p=o['problems']; p[0]['title']='Маси на компонентите на Капела.'
p[0]['statement']=r'''Шест-метровият телескоп на Специалната астрофизическа обсерватория (САО) е един от малкото телескопи, с които се провеждат спекл-интерферометрични наблюдения на тесни визуално двойни системи от звезди. Целта на наблюденията е прякото измерване на масите на звездите. Предлагаме ви, като използувате наш наблюдателен материал, да оцените масите на компонентите на Капела.

Капела ($\alpha$ Aur) е много тясна визуално двойна система. На фигурата е дадена относителната орбита на компонентата B, получена по многогодишни наблюдения от различни обсерватории, включително и в САО. Положението на компонентата A е отбелязано с кръстче и е съединено с права линия с точката на периастъра. Дават се също кривите на изменение на лъчевите скорости на двете компоненти. Паралаксът на Капела е $\pi=0^{\prime\prime}.077$. Периодът на орбитално движение на компонентите е $P=104\ \mathrm{d}$.

Разгледайте пространствен модел на системата, при който се отчитат ексцентрицитетът на орбитите и наклонът на тяхната равнина към зрителния лъч. Като използвате 3-тия закон на Кеплер, оценете масите на компонентите. Разгледайте възможните източници на грешки при вашата оценка.'''
p[0]['solution']['statement']=r'''Маси на компонентите на Капела

Ако масите на компонентите са дадени в слънчеви маси, разстоянието между компонентите в астрономически единици, и периодът в години:

$$(M_a+M_b)=A^3/P^2,\quad A=a^{\prime\prime}/\pi^{\prime\prime}\ \text{и}\ M_a/M_b=K_b/K_a,$$

където $a^{\prime\prime}$, $K_a$ и $K_b$ са показани на фигурата.

Орбитите могат да се считат за кръгови. Това е показано чрез централната позиция на кръста и чрез синусовата форма на кривите на радиалните скорости.

Следователно:

$$(M_a+M_b)\sim4\text{-}5M_{\text{з}},\quad M_a/M_b\sim1.2$$'''
p[0]['answer']={'kind':'text','value':'(M_a+M_b) ~ 4–5 слънчеви маси; M_a/M_b ~ 1.2.'}
p[1]['statement']=p[1]['statement'].replace('Процесът','Процепът').replace('използвана','използувана').replace('H=74 km/s/Mpc.',r'$H=74\ \mathrm{km/s.Mpc}$.').replace('3{,}09\\times','3.09\\times').replace('6{,}67\\times','6.67\\times')
p[1]['solution']['statement']=r'''Маса на галактика

Фигурите показват, че за точката върху галактичната периферия е валидно:

$$m.V_r^2/R_g=G.m.M_g/R_g^2,\quad M_g=V_r^2.R_g/G,$$
$$V_r=c.\Delta\lambda_r/(\lambda_0.2),\quad R_g=d.20^{\prime\prime}/(2.10^5),\quad d=V_{rg}/H\ \text{и}\ V_{rg}=c.\Delta\lambda_g/\lambda_0.$$

Линията $H\alpha$ с $\lambda_0=6563\mathrm{A}$ е избрана за измервания, тъй като е най-широка и следователно тя определя най-общо масата на галактиката. Знае се, че $M_g\sim10^{10}M_{\text{з}}$.

Следователно, тя е по-малка от нашата Галактика и по размери и по маса.'''
p[1]['answer'].pop('note',None)
p[2]['title']='Слънцето в оптическия диапазон и в радиодиапазона.'
p[2]['statement']=p[2]['statement'].replace('на училищния телескоп','на училищен телескоп').replace('едноименните','едномерните').replace('по план','по пладне')
p[2]['solution']['statement']=p[2]['solution']['statement'].replace('**Задача 1.**\n_','').replace('радиодиапазона_','радиодиапазона')
p[3]['title']='Визуално двойни звезди.'
p[3]['statement']='''Тот телескоп прозвали Звездоколом
За то, что каждую звезду колол
На две, на три звезды - как шарик ртути,
Лежащий на ладони, можно пальцем
Разбить на две - три шарика поменьше.
Роберт Фрост „Звездокол“
(превод А. Сергеева)

'''+p[3]['statement'].replace('блясъка и цветовете','блясъка и цвета')
p[3]['solution']['statement']=p[3]['solution']['statement'].replace('**Задача 2.**\n_','').replace('звезди_','звезди').replace('гонищен','годишен').replace('по небето','по небето').replace('се списват','се описват')
p[3]['answer'].pop('note',None)
boxes=[[[85,219,334,397],[59,397,346,574]],[[407,628,639,835]],[[646,233,930,501]],[]]
for i,pr in enumerate(p):
 pr['tx']={'sourceSpans':[{'document':'problems','page':1},{'document':'solutions','page':2}]}
 for f,b in zip(pr['figures'],boxes[i]):
  f.pop('caption',None);f['tx']={'document':'problems','page':1,'bbox':b}; f.pop('url',None);f.pop('width',None);f.pop('height',None);f.pop('source',None)
  f['alt']=f['alt'].replace('Канела','Капела')
p[2]['figures'][0]['alt']='Празен кръг за зарисовка на слънчевия диск; отдолу три радиопрофила за 21.10.98, 20.10 и 19.10 с пикове A, B, C, D, означения Rс и λ=4cm.'
p[0]['figures'][1]['alt']='Графика за Капела: скорост срещу фаза, две криви с експериментални точки и амплитуди Ka и Kb.'
o['tx']={'reader':o['tx']['reader'],'printedMeta':'ОЛИМПИАДА; ПРАКТИЧЕСКИ КРЪГ; НАБЛЮДАТЕЛЕН КРЪГ','catalogDisagrees':True,'textLayerTrustworthy':False,'notes':'Двете групи задачи са номерирани 1–2 в печата; тук са последователни 1–4. Решенията към тях са единствено в дясната колона на PDF стр. 2; останалите решения не са към този лист. Страницата с решения ги поставя под заглавие „МЕЖДУНАРОДНА ОЛИМПИАДА — РЕШЕНИЯ - САО, РУСИЯ“, докато каталогът е NAO/1998/IV; запазени са каталоговите ID и конкурс до човешка проверка. Източникът използва десетична точка в константите. Формулата за R_g е отпечатана с 2.10^5, което е запазено.','caveat':'Каталогът отнася листа към националната олимпиада, но решенията са под заглавие за международна олимпиада; произходът изисква проверка.','adjudicator':{'provider':'openai','model':'codex-gpt-6','promptVersion':'v1','at':now,'basedOn':[base['view']]}}
o['paper']['caveat']=o['tx']['caveat']
glm=[defect('/paper/organiser','metadata','АНДРОМЕДА is the journal footer, not an identified organiser.'),defect('/paper/solutionSource/pages','provenance','There are only two solution PDF pages; relevant solutions all occur on p.2, not p.3. Every problem repeats nonexistent solution page 3.'),defect('/problems/0/statement','reworded','Капела becomes Канела; спекл-интерферометрични becomes спектр-интерферометрични; звезди becomes звездни; съединено becomes свързано.'),defect('/problems/0/solution/statement','wrong-value','Printed A=a″/π″ is transcribed A=a²/π″; Капела title also corrupted.','critical'),defect('/problems/1/statement','reworded','Printed Процепът becomes Процесът; decimal dots changed to commas and source unit punctuation changed.'),defect('/problems/1/solution/statement','wrong-value','Galaxy formula subscripts and denominators are corrupted: λ0·2 becomes λ0², 20″ becomes 20^4, and several V_r/M_g/R_g indices disappear.','critical'),defect('/problems/2/statement','reworded','Printed едномерните радиопрофили and по пладне become едноименните and по план; title оптическия loses я.'),defect('/problems/3/statement','omission','Entire printed Frost epigraph and translator credit omitted; printed цвета replaced with цветовете.'),defect('/problems/3/solution/statement','reworded','годишен becomes гонищен; readable се описват is misread се списват and then falsely declared a source typo.'),defect('/problems/2/figures','omission','Empty solar disc for the student drawing is absent from crop.','critical')]
for i,pr in enumerate(json.load(open(base['view']))['problems']):
 for j,f in enumerate(pr['figures']):glm.append(defect(f'/problems/{i}/figures/{j}','figure','Actual crop includes unrelated body text; p1 velocity plot and p2 spectrum also clip required labels/curves. Captions are invented, not printed.','critical'))
haiku=[]
for i in range(4):
 haiku += [defect(f'/problems/{i}/statement','reworded','Printed readable Bulgarian is extensively corrupted and abridged, with missing quantities and clauses.','critical'),defect(f'/problems/{i}/solution','omission','Complete solution exists in right column of solutions PDF p.2, but candidate replaces it by an unreadable placeholder.','critical')]
haiku+=[defect('/problems','numbering','Practical galaxy task belongs second, then solar observation; candidate reverses them.'),defect('/problems/2/problemType','metadata','Galaxy task is practical, not observation.')]
for i,pr in enumerate(json.load(open(task['candidates'][0]['view']))['problems']):
 for j,f in enumerate(pr['figures']):haiku.append(defect(f'/problems/{i}/figures/{j}','figure','Inspected crop is body text or clipped fragment of unrelated figure; none is a usable complete intended figure.','critical'))
findings=[]
for cf in task['checks']:
 ch=json.load(open(cf))
 for ix,d in enumerate(ch.get('defects',[])):
  true=True;note='Confirmed on rendered source: the candidate defect exists. Suggested replacement text or boxes are not automatically accepted.'
  if 'agent__haiku__for-zai' in cf:
   if ix==0:true=False;note='Answer is an allowed summary, and source actually reads се описват. The claim of a printed се списват source error is itself a reader error.'
   else:note='Confirmed denominator corruption, but checker’s proposed standard-physics fix is wrong: printed denominator is λ0·2, not simply λ0. Verified enlarged PDF crop.'
  elif ix==1:note='Omission confirmed, but path is wrong and the checker combines data belonging to Capella and the galaxy; these are unlabelled statement data, not parts.'
  elif ix==4:note='Problem type error confirmed; title itself is correct. Defect path should be problemType.'
  elif ix>=11:note='Actual crop confirms severe clipping/wrong region; proposed checker coordinates are also inaccurate and were replaced by visually checked boxes.'
  findings.append({'check':cf,'index':ix,'path':d['path'],'truePositive':true,'note':note})
adj={'paperId':id,'at':now,'adjudicator':{'provider':'openai','model':'codex-gpt-6'},'basedOn':base['view'],'candidates':[{'view':c['view'],'candidateSha256':c['candidateSha256'],'defects':ds,'verdict':'fail'} for c,ds in zip(task['candidates'],[haiku,glm])],'checkerFindings':findings,'escalations':[{'path':'/paper/competition','description':'Check archive identity: problems page 1 has no year/contest identity; matching solutions are under МЕЖДУНАРОДНА ОЛИМПИАДА — САО, РУСИЯ on solution p.2, while catalogue says NAO 1998 IV. Canonical ID retained pending human decision.'}],'summary':'Both candidates fail. GLM preserves most prose but corrupts names, formulas, dates/page provenance and every crop; Haiku drops readable solutions and heavily corrupts statements. Corrected transcription checked against all three source pages, all ten candidate crops, and all seventeen checker findings; catalogue provenance remains explicitly escalated.'}
for name,data in [(task['out'],o),(task['adjudication'],adj)]:Path(name).parent.mkdir(parents=True,exist_ok=True);Path(name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
