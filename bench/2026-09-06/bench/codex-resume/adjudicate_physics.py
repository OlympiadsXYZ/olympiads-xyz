import json,pathlib,datetime,copy
R=pathlib.Path('/Users/ismoldayev/Documents/Projects/olympiads-xyz')
def load(p): return json.loads(pathlib.Path(p).read_text())
def save(p,x): pathlib.Path(p).parent.mkdir(parents=True,exist_ok=True); pathlib.Path(p).write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
def start(id,base):
 t=load(R/f'tmp/bench/codex-resume/{id}.task.json'); c=next(c for c in t['candidates'] if base in c['view']); d=load(c['view'].replace('.view.json','.json')); return t,d,c

def finish(t,d,c,defects,decisions,summary,notes='',escalations=[]):
 at=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z'); provenance=dict(provider='openai',model='codex-gpt-6',promptVersion='v1',at=at,basedOn=c['view'])
 d.setdefault('tx',{})['adjudicator']=provenance
 d['tx']['notes']=d['tx'].get('notes','')+'\nAdjudication from every rendered page and supplied crop: '+notes
 a=dict(paperId=t['paperId'],at=at,adjudicator={'provider':'openai','model':'codex-gpt-6'},basedOn=c['view'],candidates=[],checkerFindings=[],escalations=escalations,summary=summary)
 for cand in t['candidates']:
  name=pathlib.Path(cand['view']).name; df=defects[name]
  a['candidates'].append(dict(view=cand['view'],candidateSha256=cand['candidateSha256'],defects=df,verdict='fail' if any(x['severity'] in ['critical','major'] for x in df) else 'pass'))
 for check in t['checks']:
  ch=load(check)
  for i,f in enumerate(ch.get('defects',[])):
   tp,note=decisions[pathlib.Path(check).name][i]
   a['checkerFindings'].append(dict(check=check,index=i,path=f.get('path',''),truePositive=tp,note=note))
 save(t['out'],d);save(t['adjudication'],a)
def defect(path,kind,description,severity='major'): return dict(path=path,kind=kind,description=description,severity=severity)

if __name__=='__main__':
 id='psf-2025-proletno-10';t,d,c=start(id,'zai__glm')
 d['paper']['title']='МИНИСТЕРСТВО НА ОБРАЗОВАНИЕТО И НАУКАТА\nНАЦИОНАЛНО ПРОЛЕТНО СЪСТЕЗАНИЕ ПО ФИЗИКА\n14 – 16 март 2025 г., Ловеч\nТема за IV състезателна група (10. клас)'
 d['paper']['totalPoints']=None
 for p in d['problems']: p['points']=None
 p1,p2,p3=d['problems']
 p1['statement']='Всички задачи са съставени от две независими части!\n\n'+p1['statement'].replace('разнопоменни','разноименни')
 for p in d['problems']:
  p['statement']=p['statement'].replace('по начин,','по начина,').replace('Трението','Триенето')
  for pt in p.get('parts',[]):
   if '. ' in pt['label']:pt['label']=pt['label'].split('. ',1)[1]
 p1['solution']['statement']=p1['solution']['statement'].replace(r'a_{\mathrm{л}} = 4a_{\mathrm{д}}',r'a_{\mathrm{д}} = 4a_{\mathrm{л}}').replace('Соответно','Съответно')
 s=p2['solution']['statement'].replace('разтегленията','разтеженията')
 # Printed q/Q second radicals have denominator k, even though the quadratic gives 2k; preserve source.
 s=s.replace(r'\frac{k(Q-q)^2}{4\ell_2^2} =',r'\frac{k(Q-q)^2}{4\ell_1^2} =')
 p2['solution']['statement']=s
 p2['parts'][1]['answer']['note']='В отпечатаните крайни формули за q и Q вторият корен има знаменател k, както е възпроизведено тук; това не съответства на предходното квадратно уравнение (то дава 2k).'
 p3['solution']['statement']=p3['solution']['statement'].replace(r'\mathcal{E}^2R_2R_x',r'\mathcal{E}^2R_2^2R_x').replace('следното квадратното','следното квадратно').replace(r'= 1{,}05C\frac{\mathcal{E}R}{R+r}',r'= 1{,}05CU_{\mathrm{усп}} = \frac{1{,}05C\mathcal{E}R}{R+r}')
 boxes=[[100,241,242,357],[107,428,228,522],[104,785,432,824],[101,184,252,334]]
 for f,b in zip([*p1['figures'],*p2['figures'],*p3['figures']],boxes): f['tx']={'document':'problems','page':2 if f['id']=='p3-fig1' else 1,'bbox':b}
 p3['figures'][0]['alt']='Верига с R₁ последователно на паралелните клонове R₂ и (R₃ + Rₓ), свързана към идеална батерия ℰ.'
 h=[defect('/problems/0/statement','omission','Printed съставени; candidate състаени.', 'minor'),defect('/problems/1/solution/statement','formula','Both final q and Q radicals are broken apart; printed first radical spans a sum of two terms, including squared lengths.','critical'),defect('/problems/1/tx/sourceSpans','omission','Both problem and solution continue on page 2; provenance names only page 1.'),defect('/problems/2/parts','reworded','Printed labels are Част I and Част II; candidate invents а) and б).','minor'),defect('/paper/totalPoints','metadata','Total 30 and three problem totals 10 are inferred by summing, not printed.','minor')]
 g=[defect('/problems/0/statement','omission','Missing paper instruction Всички задачи са съставени от две независими части! and replaces разноименни with разнопоменни.'),defect('/problems/0/solution/statement','formula','Printed aд = 4aл; candidate reverses subscripts to aл = 4aд.','critical'),defect('/problems/1/solution/statement','formula','Final force line has printed denominator 4ℓ₁², candidate 4ℓ₂².','critical'),defect('/problems/2/solution/statement','formula','Printed power numerator ℰ²R₂²Rₓ; candidate omits square on R₂.','critical'),defect('/problems/2/solution/statement','omission','Charge equality omits printed intermediate 1,05 C Uусп.'),defect('/problems/1/statement','reworded','Printed по начина and Триенето; candidate по начин and Трението. Same по начина change occurs in problem 3.','minor'),defect('/problems/1/solution/statement','reworded','Printed разтеженията; candidate changes to разтегленията. Problem 1 also has Соответно instead of Съответно.','minor'),defect('/paper/totalPoints','metadata','Total 30 and problem totals 10 are sums, not printed.','minor')]
 for j,p in enumerate(d['problems']):
  for k,f in enumerate(p['figures']):
   h.append(defect(f'/problems/{j}/figures/{k}','figure','Actual candidate crop is clipped/wrong and contains surrounding body text; original figure occupies corrected box '+str(f['tx']['bbox'])+'.','critical'))
   g.append(defect(f'/problems/{j}/figures/{k}','figure','Actual candidate crop clips/mislocates the diagram or swallows extensive body text. Correct page-relative box '+str(f['tx']['bbox'])+'.','critical'))
 decisions={'agent__haiku__for-zai__glm-5.3-flash.json':[(True,'Confirmed actual p2-fig1 contains body text; checker pointer /figures/1 is out of range, intended /figures/0.')], 'zai__glm-5.3-flash__for-agent__haiku.json':[(True,'Source instruction has съставени, missing в in candidate.'),(True,'Crop clips lower diagram and includes masthead. Proposed checker box is not accepted.'),(True,'Actual crop includes first figure/body text; whole second figure is near lower edge. Severity understated: swallowed body text is critical.'),(True,'Crop shows Part II pulley, not spring system.'),(True,'Only top of circuit appears; lower resistors and battery are missing.')]}
 finish(t,d,c,{'agent__haiku.figs.view.json':h,'zai__glm-5.3-flash.figs.view.json':g},decisions,'Neither candidate passes: every figure crop is unsuitable and both readers have material formula errors. GLM is the base after visual correction; all six checker findings are confirmed, but the checks missed multiple critical formula defects.','Printed разтеженията and q/Q second radicals with denominator k are preserved. Repeated printed а)/б) labels are retained; total scores absent from source are null. All four source pages and all eight supplied crops were inspected. Corrected figure boxes independently measured from full pages.')
