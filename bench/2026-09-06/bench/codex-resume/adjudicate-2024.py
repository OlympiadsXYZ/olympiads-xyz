import json,re,datetime
from pathlib import Path
ROOT=Path('/Users/ismoldayev/Documents/Projects/olympiads-xyz'); P='nof-2024-iii-11-12'; base=ROOT/'tmp/tx'/P
T=json.load(open(ROOT/'tmp/bench/codex-resume'/f'{P}.task.json'))
d=json.load(open(base/'candidates/agent__sonnet.figs.json')); ps=d['problems']; at=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
constants=r'''**Физични константи, които можете да използвате във всички задачи:**

| | |
|---|---|
| Земно ускорение | $g=9{,}81\ \mathrm{m.s^{-2}}$ |
| Гравитационна константа | $\gamma=6{,}67\cdot10^{-11}\ \mathrm{m^3.kg^{-1}.s^{-2}}$ |
| Маси на частиците | |
| - електрон | $m_e=9{,}109\cdot10^{-31}\ \mathrm{kg}$ |
| - протон | $m_p=1{,}673\cdot10^{-27}\ \mathrm{kg}$ |
| - неутрон | $m_n=1{,}675\cdot10^{-27}\ \mathrm{kg}$ |
| Елементарен електричен заряд | $e=1{,}60\cdot10^{-19}\ \mathrm{C}$ |
| Константа на Кулон | $k_C=9{,}00\cdot10^9\ \mathrm{N.m^2.C^{-2}}$ |
| Електрична константа | $\varepsilon_0=1/4\pi k_C\approx8{,}85\cdot10^{-12}\ \mathrm{F.m^{-1}}$ |
| Магнитна константа | $\mu_0=4\pi\cdot10^{-7}\ \mathrm{T.m.A^{-1}}$ |
| Скорост на светлината | $c=3{,}00\cdot10^8\ \mathrm{m.s^{-1}}$ |
| Константа на Планк | $h=6{,}63\cdot10^{-34}\ \mathrm{J.s}$ |
| Редуцирана константа на Планк | $\hbar=h/(2\pi)=1{,}05\cdot10^{-34}\ \mathrm{J.s}$ |
| Атомна единица за маса | $1\ \mathrm{u}=1{,}66\cdot10^{-27}\ \mathrm{kg}=931{,}5\ \mathrm{MeV}.c^{-2}$ |
| Универсална газова константа | $R=8{,}31\ \mathrm{J.mol^{-1}.K^{-1}}$ |
| Число на Авогадро | $N_A=6{,}02\cdot10^{23}\ \mathrm{mol^{-1}}$ |
| Константа на Болцман | $k_B=R/N_A=1{,}38\cdot10^{-23}\ \mathrm{J.K^{-1}}$ |
| Константа на Ридберг | $R_H=1{,}097\cdot10^7\ \mathrm{m^{-1}}$ |'''
# The source has no schema-level shared-data field; repeat its constants on every problem page.
for p in ps:
 p['statement']=constants+'\n\n'+p['statement']
 if {'document':'problems','page':1} not in p['tx']['sourceSpans']:p['tx']['sourceSpans'].insert(0,{'document':'problems','page':1})
p=ps[0];s=p['solution']['statement'];s=s.replace('получения $t_A$','полученото $t_A$').replace('Ъгълът в градуси е съответно: $','Ъгълът в градуси е съответно:\n\n(14) $').replace('Използваме приближението $','Използваме приближението: $').replace(' т.]',' т]');p['solution']['statement']=s
f=p['solution']['figures'][0];f.pop('caption',None);f['alt']='Координатна система Oxy с начало O на земята. Гюлето е изстреляно от точка над O с начална скорост v0 под ъгъл θ спрямо хоризонта; параболичната траектория завършва в A на оста x.'
p=ps[1]
for part,label in zip(p['parts'],['А. а)','А. б)','Б.','В. а)','В. б)','Г. а)','Г. б)']):part['label']=label
p['parts'][3]['figures'][0]['alt']='Четири успоредни метални пластини A, 1, 2 и B. Външните A и B са съединени с проводник под пластините; вътрешните имат изводи 1 и 2.'
p['parts'][3]['answer']['note']='Потенциалът е нула върху A и B, положителен върху 1 и отрицателен върху 2. Между съседните пластини графиката е линейна; виж фиг. 2.1 в решението.'
s=p['solution']['statement'].replace('показан на фиг. 2.1. Тук е отчетена симетрията на задачата. **(1,25 т.)**','показан на фиг. 2.1. **(1 т.)** Тук е отчетена симетрията на задачата. **(0,25 т.)**')
s=s.replace(r'z_{\min}=a_0=\left(\dfrac{\hbar^2}{m_n^2 g}',r'z_{\min}=a_0=\left(\dfrac{\hbar^2}{m^2 g}')
p['solution']['statement']=s
p['solution']['figures'][0]['alt']='Четири пластини A, 1, 2, B с положителен заряд на 1 и отрицателен на 2. Полето E между 1 и 2 сочи надясно; E′ в двата външни процепа сочи наляво. Начупената графика φ(x) е нула в A и B, положителна в 1 и отрицателна в 2.'
p=ps[2];sp=p['parts'][2]['statement'];boundary='Като използвате II принцип';i=sp.index(boundary);background=sp[:i].rstrip();p['parts'][2]['statement']=sp[i:]
sp=p['parts'][5]['statement'];i=sp.index('\n\n*Упътване.');hint=sp[i+2:];p['parts'][5]['statement']=sp[:i];p['statement']+='\n\n'+background+'\n\n'+hint
nums=iter(list(range(1,23))+[22]);s=p['solution']['statement'];assert len(re.findall(r'\$\$.*?\$\$',s,re.S))==23
p['solution']['statement']=re.sub(r'\$\$.*?\$\$',lambda m:'\n\n('+str(next(nums))+') '+m[0],s,flags=re.S).replace(' т.]',' т]')
p['tx']['sourceSpans'].append({'document':'solutions','page':9})
p=ps[3];p['parts'][7]['statement']=p['parts'][7]['statement'].replace('\n\nИзчислете',' **[2,5 т]**\n\nИзчислете')+' **[0,5 т]**';p['solution']['statement']=p['solution']['statement'].replace(r"s'\approx 1.00",r"s'\approx 1{,}00")
p['tx']['sourceSpans']=[s for s in p['tx']['sourceSpans'] if s!={'document':'solutions','page':8}]
p['solution']['figures'][2]['alt']='Две призми на Поро с взаимно перпендикулярни ръбове. Показани са сечението F на падащия сноп, огледалният му образ между призмите и образът F, завъртян на 180 градуса, след втората призма.'
boxes={'p1-sol-fig1':[713,230,958,401],'p2-fig1':[207,154,498,293],'p2-fig2':[554,149,779,295],'p2-fig3':[202,609,327,748],'p2-fig4':[530,655,824,750],'p2-sol-fig1':[639,658,828,828],'p2-sol-fig2':[617,601,895,750],'p3-fig1':[728,382,861,482],'p4-fig1':[604,95,885,253],'p4-fig2':[606,258,894,407],'p4-sol-fig1':[524,285,908,405],'p4-sol-fig2':[529,411,913,532],'p4-sol-fig3':[633,90,891,225]}
def figs(x):
 if isinstance(x,dict):
  if 'bbox' in x.get('tx',{}) and 'id' in x:yield x
  for v in x.values():yield from figs(v)
 elif isinstance(x,list):
  for v in x:yield from figs(v)
for f in figs(d):f['tx']={'document':f['tx']['document'],'page':f['tx']['page'],'bbox':boxes[f['id']]};f.pop('url',None)
# Base lacks a tx.reader block. Preserve that absence rather than inventing model provenance.
d['tx']['adjudicator']={'provider':'openai','model':'codex-gpt-6','promptVersion':'v1','at':at,'basedOn':[T['candidates'][1]['view']]}
d['tx']['notes']='Adjudicated by Codex against all 15 rendered source pages and all three candidate texts, 35 actual candidate crops and 29 checker findings. The closest candidate is agent__sonnet.figs.view.json. Its raw candidate has no tx.reader block; none has been fabricated. The constants table printed once on problems p.1 is repeated verbatim in each problem statement because the schema has no paper-level shared-data field; the particle-mass cell is represented by three rows and the Markdown header is blank. Problem 2 uses compound part labels to preserve its printed two-level hierarchy. Shared background and hints are retained in the parent statement; their printed position among/after subparts cannot be represented in this flat schema. Split point awards within Problem 4 б), е), з) are retained in text; points fields contain their sums. No grand total or problem total is printed, so those fields remain null. Source errors deliberately preserved: P1 equation (12) has 1−2gh/v0² and equations (13)–(14) retain the printed inconsistent approximation; (14) is printed twice. P2 В.б) prints q₂ in U=Ed=q₂d/(ε₀S)=q/C although its preceding equations imply q₁; P2 Г.б) prints bare m² only in the z_min denominator. P3 references equation (4) when substituting the speed, prints 3e in W_e-я, bare k in W_e-e, duplicate «на на», and numbers both the dissociation energy and wavelength (22). P4 prints h′=h₁≈118 nm though its h_k formula would use k=0 for the smallest thickness. The P4 solution mostly uses decimal points, but s′≈1,00 m has a comma. Figure numbering is independent in problems and solutions (P2 figures 2.1 and 2.2 occur in both documents). No unresolvable glyphs remain.'
for pi,note in [(0,'В отпечатаното решение формули (12)–(14) съдържат несъгласувано приближение; формулите и полученият отговор са запазени дословно.'),(1,'В отпечатаното решение В.б) стои q₂ във формулата за U, а Г.б) използва m² без индекс n във формулата за z_min; запазени са дословно.'),(2,'Запазени печатни особености: препратка към уравнение (4), множител 3e в W_e-я и повторен номер (22).'),(3,'В отпечатаното решение минималната дебелина е означена h′=h₁; запазено е дословно.')]:
 ps[pi]['tx']['notes']=note
out=ROOT/'tmp/bench/truth'/f'{P}.json';out.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
print(out)
