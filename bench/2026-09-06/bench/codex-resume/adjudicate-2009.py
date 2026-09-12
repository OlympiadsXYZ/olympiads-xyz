import json,copy,datetime,pathlib
root=pathlib.Path.cwd(); paper='nof-2009-iii'; task=json.load(open(f'tmp/bench/codex-resume/{paper}.task.json')); at=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
cands=[json.load(open(c['view'])) for c in task['candidates']]; out=copy.deepcopy(cands[1]); raw=json.load(open(task['candidates'][1]['view'].replace('.view.json','.json')))
out['tx']={'reader':raw.get('tx',{}).get('reader'), 'adjudicator':{'provider':'openai','model':'codex-gpt-6','promptVersion':'v1','at':at,'basedOn':[c['view'] for c in task['candidates']]},'printedMeta':out['paper']['title'],'catalogDisagrees':False,'textLayerTrustworthy':False,'notes':'Всички 10 страници и 25 предложени изрезки са прегледани визуално. Източникът в решение 3г печата n(λ)=A−B/λ², въпреки плюса в условието; знакът е запазен. На стр. 3 от решенията предпоследната дроб в извода за f е отпечатана с n₀x в числителя и деление на n₀ в знаменателя; запазена е дословно. Данните след подусловията са съхранени в общото statement според схемата. Суми от подточките не се представят като отпечатани общи точки.'}
p=out['problems']; p[0]['figures'][0]['alt']='Пръчка AB върху две пружини, закрепени към клеми C и D; резистор R, поле B със знак ⊗, насочено от читателя към чертежа, и отклонение x надолу.'
p[1]['statement']=p[1]['statement'].replace('1{,}10\\times10^5','1\\cdot10^5')
p[2]['parts'][0]['answer']['latex']=r'f = \frac{n_0}{(n-n_0)\left(\frac{1}{R_1}+\frac{1}{R_2}\right)}'
p[2]['figures'][0]['alt']='Обектив от две лещи: лява двойноизпъкнала с n₁(λ), дясна плосковдлъбната с n₂(λ); общ фокус Fс ≡ Fч, nвъздух(λ)=1.'
p[2]['solution']['figures'][1]['alt']='Леща с диаметър D; синият и червеният сноп имат фокуси Fс и Fч; екран във Fч и диаметър d на синьото петно.'
p[3]['solution']['figures'][0]['alt']='Векторен триъгълник p = p₁ + p₂: p₁ от левия връх към горния, p₂ от горния към десния, p хоризонтално отляво надясно; θ между продължението на p₁ и p₂.'
# Restore the printed intermediate fraction omitted by the chosen reader.
s=p[2]['solution']['statement']; old=r'\varepsilon}=$$\n$$=\frac{n_0x}'
# string carries real newlines
old=old.replace('\\n','\n'); new=r'\varepsilon}=\frac{n_0x}{\frac{n-n_0}{n_0}\alpha+\frac{n-n_0}{n_0}\varepsilon}=$$\n$$=\frac{n_0x}'.replace('\\n','\n')
assert old in s; p[2]['solution']['statement']=s.replace(old,new)
# Preserve multiplication dot where the fourth problem prints a dot.
for obj in [p[3],p[3]['solution']]: obj['statement']=obj['statement'].replace('\\times','\\cdot')
# The scan's award labels for problems 1/4 do not contain an abbreviation dot.
for ix in [0,3]: p[ix]['solution']['statement']=p[ix]['solution']['statement'].replace(' т.]',' т]')
# Correct all nine boxes using full-page image coordinates; captions stored separately.
boxes=[[693,179,870,315],[696,367,872,455],[139,699,439,830],[615,436,911,558],[460,582,847,693],[565,223,865,327],[476,400,860,512],[246,627,535,724],[109,368,482,440]]
figs=[f for q in p for f in q.get('figures',[])+q.get('solution',{}).get('figures',[])]
for f,box in zip(figs,boxes):
 f['tx']['bbox']=box; f['tx'].pop('file',None)
 for k in ['url','width','height','source']: f.pop(k,None)
# Mark source-derived critical quantities explicitly retained after visual comparison.
pathlib.Path(task['out']).write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
def defect(path,severity,kind,description): return {'path':path,'severity':severity,'kind':kind,'description':description}
def D(i,path,severity,kind,text): ds[i].append(defect(path,severity,kind,text))
ds=[[],[],[]]
D(0,'/paper/totalPoints','minor','points','60 is a sum; no paper total is printed. All four problem totals 15 are also inferred rather than printed.')
D(0,'/problems/0/statement','critical','reworded','Invents a sentence about field force depending on oscillation period in place of the printed neglect of gravity; changes L to l and corrupts the inertia description.')
D(0,'/problems/0/parts','critical','wrong-value','Part а loses ±x and corrupts the frequency request; part б changes ω₁t to ωt t and кръговата to крайната; numerous unprinted spellings occur in а–в.')
D(0,'/problems/0/solution/statement','critical','wrong-value','Many equations altered: F=Fs=kr, extra second derivatives, ν₁ instead of ν₂, LAx(t), lost minus signs in η; omits the recurrence and invents amplitude/time equations. Text is heavily corrupted.')
D(0,'/problems/1/statement','critical','missing-text','All five printed numerical data constants are absent; explanatory prose and inequalities are changed.')
D(0,'/problems/1/parts','major','reworded','Subquestions are corrupted, subscripts п/т changed to a/l and an extra Δp≪p appended to в).')
D(0,'/problems/1/solution/statement','critical','wrong-value','Qпол=μλ becomes μx; thermodynamic equations and the pressure-cooker derivation are corrupted or replaced with repeated question text.')
D(0,'/problems/2','critical','missing-text','Optics statement and parts contain extensive invented/garbled prose, absent approximation sinα≈tanα≈α and missing entire six-row material table. Full official solution replaced by an English placeholder; two solution figures missing.')
D(0,'/problems/3/statement','critical','missing-text','Omits all four printed constants and the useful momentum formula; duplicates parts in statement and translates мегаелектронволтове to English.')
D(0,'/problems/3/solution/statement','critical','missing-text','Drops entire part д); E=E₀+Eк changed to minus, 3E₀² becomes 3p₀², sine half-angle equation replaced by repeated equation (3); numerous garbled words.')
D(0,'/problems','major','provenance','Source spans omit solutions page 2 for problem 1, page 3 for problem 2, pages 4/5 for problem 3 and page 6 for problem 4; final answers absent throughout.')
for c in task['candidates'][0]['crops']: D(0,c['path'],'critical','figure',f"{c['id']} crop contains body text; "+('diagram is present but contaminated.' if c['id'] in ['p1-fig1','p1-fig2'] else 'required diagram is clipped or absent.'))
D(1,'/problems/0/figures/0/alt','major','figure','Says field points toward reader with a dot. Source has ⊗ and explicitly says away from reader.')
D(1,'/problems/1/statement','critical','wrong-value','Atmospheric pressure is printed 1·10⁵ Pa; candidate says 1,10×10⁵ Pa, changing the value by 10%.')
D(1,'/problems/2/parts/0/answer','critical','wrong-value','Final focal length answer includes an extra x in numerator; printed final formula (3.1) has n₀, not n₀x.')
D(1,'/problems/2/solution/statement','major','missing-text','Omits the intermediate n₀x/[((n−n₀)/n₀)α+((n−n₀)/n₀)ε] fraction at the bottom of solutions p.3; source has this expression even though it is algebraically inconsistent.')
D(1,'/problems/2/figures/0/alt','minor','figure','Alt assigns both n₁ and n₂ to the left lens; diagram assigns n₂ to the right lens.')
for idx in [0,1,2,3,4,5,8]:
 c=task['candidates'][1]['crops'][idx]
 detail={0:'contains substantial statement text',1:'contains substantial statement text',2:'cuts off second adiabat, Vп, and V-axis arrow',3:'bottom of lens clipped and top body-text fragment included',4:'includes equation fragment below diagram',5:'includes formula/body text above diagram',8:'left p₂ arrow and right p₁ arrow clipped'}[idx]
 D(1,c['path'],'critical','figure',f"{c['id']} {detail}.")
D(1,'/problems/3/solution/figures/0/alt','minor','figure','Vectors are tip-to-tail, not two vectors leaving a common vertex as described.')
D(2,'/paper/totalPoints','minor','points','60 and per-problem 15 totals are computed, not printed.')
D(2,'/problems/0/title','major','reworded','Printed амортисьор changed to амортизатор.')
D(2,'/problems/0/statement','critical','wrong-value','Printed клеми becomes скоби throughout; I=(1/12)mL² becomes I=(l/12)ml², with literal letter l instead of digit 1.')
D(2,'/problems/0/solution/statement','critical','wrong-value','Relative energy loss formula adds A into (πBL)², changing η to an amplitude-dependent expression. Several singular/plural words and decimal separators also changed.')
D(2,'/problems/1/title','minor','reworded','Printed пари is changed to пара.')
D(2,'/problems/1/statement','minor','reworded','Printed numerical-data list turned into an invented two-column table with new headings and Численi typo.')
D(2,'/problems/2/statement','major','reworded','Corrupts параксиално to чарксиално, changes singular/plural wording, and replaces printed decimal points in all 12 table entries by commas.')
D(2,'/problems/2/parts','major','missing-text','All four parts contain invented Виж statement по-горе instead of their printed text.')
D(2,'/problems/2/solution/statement','major','missing-text','Replaces lengthy printed derivations (3.1)/(3.3) with ellipses, drops printed Cauchy A−B/λ² source error, changes table separators and several words.')
D(2,'/problems/3/parts/2/answer','critical','wrong-value','Print and calculation give 5,3·10⁻¹⁵ m; candidate answer is 5.3e-13 m, a factor 100 error.')
D(2,'/problems/3/solution/statement','critical','wrong-value','De Broglie wavelength printed 5,3·10⁻¹⁵ m is transcribed 5,3·10⁻¹³ m. Also omits Както е известно.')
D(2,'/problems/3/parts/4/answer','major','other','Numeric answer contains the string 252 MeV и 18 MeV instead of a numeric value or a text-kind answer.')
for c in task['candidates'][2]['crops']: D(2,c['path'],'critical','figure',f"{c['id']} actual crop contains body text and/or clips essential parts of the diagram; all 9 boxes need replacement.")
findings=[]
for k,ch in enumerate(task['checks']):
 o=json.load(open(ch))
 for i,d in enumerate(o.get('defects',[])):
  yes=(k==0) or (k==2 and i in [1,2,3]); note=''
  if k==0: note='Confirmed visually: the named crop captures text or an incomplete diagram. The proposed replacement still misses the full diagram; use adjudicated boxes.'
  elif k==1: note='Not a defect: checker discusses an unrelated number pair/tones, reports only 2 of 10 pages read and overlooks severe corruption. The top-level hash issue is a known harness omission; nested checker provenance binds the intended bytes.'
  elif i==0: note='Informational confirmation of correct answers, not a defect. Path uses wrong problem index.'
  elif i==1: note='Confirmed field-direction error; actual path is /problems/0/figures/0/alt (checker index off by one).'
  elif i==2: note='Confirmed 1·10⁵ on page, not 1,10×10⁵. Actual path /problems/1/statement.'
  elif i==3: note='Confirmed clipping of right half and labels; actual path /problems/1/solution/figures/0.'
  elif i==4: note='Correct preservation of a printed source error, not a transcription defect. Actual path /problems/2/solution/statement.'
  elif i==5: note='Informational numbers are correct, but crop assurance is false: p4-sol-fig2 clips both horizontal arrow ends.'
  elif i==6: note='Not a valid defect claim. Its no-clipping assurance is false: bottom of lens cropped and preceding body text included.'
  findings.append({'check':ch,'index':i,'path':d.get('path',''),'truePositive':yes,'note':note})
res={'paperId':paper,'at':at,'adjudicator':{'provider':'openai','model':'codex-gpt-6'},'basedOn':task['candidates'][1]['view'],'candidates':[{'view':c['view'],'candidateSha256':c['candidateSha256'],'defects':d,'verdict':'fail'} for c,d in zip(task['candidates'],ds)],'checkerFindings':findings,'escalations':[],'summary':'All 10 source pages and all 25 actual crops inspected. Sonnet is the closest candidate but needs numerical, derivation and figure corrections; GLM abbreviates derivations and misreads a wavelength exponent, while Haiku contains extensive hallucinated and missing text. The GLM-on-Haiku pass is unsupported by its own coverage and unrelated summary; informational checker entries are not counted as true defects.'}
pathlib.Path(task['adjudication']).write_text(json.dumps(res,ensure_ascii=False,indent=2)+'\n')
