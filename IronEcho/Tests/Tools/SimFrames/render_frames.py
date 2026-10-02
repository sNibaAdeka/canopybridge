import json, math, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W,H=1280,720; S=190; FLOOR=600; CX=W//2
F='/usr/share/fonts/truetype/dejavu/'
def font(sz,b=True): return ImageFont.truetype(F+('DejaVuSans-Bold.ttf' if b else 'DejaVuSans.ttf'),sz)
L=[json.loads(l) for l in open(sys.argv[1])]
PH={0:'ОЖИДАНИЕ',1:'ОТСЧЁТ',2:'БОЙ',3:'ПЕРЕРЫВ',4:'БОЙ ОКОНЧЕН',5:'ПАУЗА',6:'ТРЕНИРОВКА',7:'НОКДАУН'}
RES={1:'НОКАУТ',2:'РЕШЕНИЕ СУДЕЙ',3:'НИЧЬЯ',4:'ТЕХНИЧЕСКИЙ НОКАУТ'}
BLUE=(70,150,255); RED=(255,80,70)
def wx(x): return CX+x*S
def wy(z): return FLOOR-z*S
def seg(d,a,b,w,c): d.line([a,b],fill=c,width=w); [d.ellipse([p[0]-w/2,p[1]-w/2,p[0]+w/2,p[1]+w/2],fill=c) for p in (a,b)]
def robot(d,f,face,col,opp):
    x=f['pos']; st=f['state']; stage=f['stage']; a=f['alpha']
    dark=tuple(int(c*0.55) for c in col); metal=(150,158,170)
    if st in (5,6):  # down
        y=FLOOR-18; hx=wx(x)-face*0.85*S
        seg(d,(wx(x)+face*0.6*S,y),(hx,y-6),34,dark); d.ellipse([hx-26-face*18,y-40,hx+26-face*18,y+10],fill=metal,outline=col,width=4)
        seg(d,(wx(x),y-10),(wx(x)+face*0.3*S,y-40),18,col); return
    lean=0.0; duck=0.0
    if f['dodge']: duck=0.16; lean=-face*0.10
    if st==3: lean=-face*0.12
    hip=(wx(x),wy(0.95)); 
    for k in (-1,1): seg(d,hip,(wx(x+k*0.18),wy(0.02)),22,dark); d.rectangle([wx(x+k*0.18)-22,FLOOR-10,wx(x+k*0.18)+22,FLOOR],fill=(40,40,48))
    sh=(wx(x+lean),wy(1.45-duck)); seg(d,hip,sh,58,col)
    d.rectangle([sh[0]-30,sh[1]-8,sh[0]+30,sh[1]+40],outline=(230,230,240),width=2)
    head=(wx(x+lean+face*0.04),wy(1.68-duck)); d.ellipse([head[0]-24,head[1]-26,head[0]+24,head[1]+26],fill=metal,outline=col,width=4)
    d.rectangle([head[0]+face*4-2 if face>0 else head[0]-18,head[1]-6,head[0]+18 if face>0 else head[0]-face*4+2,head[1]+2],fill=(255,230,120))
    for hand in (0,1):
        guard=(wx(x+lean+face*0.22),wy(1.55-duck)); fist=guard
        if f['block']: fist=(wx(x+lean+face*0.16),wy(1.66-duck))
        if st==1 and f['hand']==hand:
            ext={1:-0.10*a,2:0.55+0.05*a,3:0.55*(1-a)}.get(stage,0)
            fist=(wx(x+lean+face*(0.22+ext)),wy(1.55-duck+(0.02 if stage==2 else 0)))
        back=hand==(0 if face>0 else 1)
        c=col if not back else dark
        seg(d,(sh[0],sh[1]+6),((sh[0]+fist[0])/2,(sh[1]+fist[1])/2+28),14,c); seg(d,((sh[0]+fist[0])/2,(sh[1]+fist[1])/2+28),fist,12,c)
        d.ellipse([fist[0]-17,fist[1]-17,fist[0]+17,fist[1]+17],fill=(220,40,40) if face>0 and False else (235,235,240) if not back else (170,170,180),outline=col,width=3)
    return head
def bar(d,x,y,w,h,v,col,rev=False):
    d.rectangle([x,y,x+w,y+h],fill=(30,30,36)); fw=int(w*max(0,min(1,v)))
    d.rectangle([x+w-fw,y,x+w,y+h] if rev else [x,y,x+fw,y+h],fill=col)
def frame(t,title,out,extra=None):
    D=L[min(t,len(L)-1)]; im=Image.new('RGB',(W,H),(12,13,20)); d=ImageDraw.Draw(im)
    for i in range(0,H,4): d.line([(0,i),(W,i)],fill=(12+i//40,13+i//45,22+i//30))
    d.polygon([(wx(-2.6)-80,FLOOR+90),(wx(2.6)+80,FLOOR+90),(wx(2.6),FLOOR),(wx(-2.6),FLOOR)],fill=(48,52,68))
    d.rectangle([wx(-2.6),FLOOR-4,wx(2.6),FLOOR+2],fill=(200,200,215))
    for k in (-2.6,2.6): d.rectangle([wx(k)-8,wy(1.25),wx(k)+8,FLOOR],fill=(90,90,105))
    for z in (0.5,0.85,1.2): d.line([(wx(-2.6),wy(z)),(wx(2.6),wy(z))],fill=(185,40,50),width=4)
    d.text((W/2,FLOOR+45),'IRON ECHO',font=font(28),fill=(80,86,110),anchor='mm')
    robot(d,D['p'],1,BLUE,D['o']); robot(d,D['o'],-1,RED,D['p'])
    for e in D['ev']:
        if e[0] in('HitConfirmed','Blocked'):
            tgt=D['o'] if e[1]==0 else D['p']; face=-1 if e[1]==0 else 1
            cx,cy=wx(tgt['pos']+face*0.05),wy(1.6 if tgt['state']!=6 else 0.2)
            colr=(255,220,90) if e[0]=='HitConfirmed' else (120,200,255)
            for k in range(10):
                a=k*math.pi/5; d.line([(cx,cy),(cx+math.cos(a)*44,cy+math.sin(a)*44)],fill=colr,width=4)
    # HUD
    d.rectangle([0,0,W,92],fill=(8,8,12))
    d.text((24,12),'ИГРОК',font=font(22),fill=BLUE); d.text((W-24,12),'БОТ «СЛОЖНЫЙ»',font=font(22),fill=RED,anchor='ra')
    bar(d,24,42,470,20,D['p']['hp']/D['p']['maxhp'],(80,200,110)); bar(d,W-494,42,470,20,D['o']['hp']/D['o']['maxhp'],(80,200,110),True)
    bar(d,24,68,330,9,D['p']['st']/D['p']['maxst'],(240,200,60)); bar(d,W-354,68,330,9,D['o']['st']/D['o']['maxst'],(240,200,60),True)
    secs=D['left']//120; d.rectangle([W/2-80,6,W/2+80,86],fill=(25,25,34),outline=(70,70,90))
    d.text((W/2,28),f"РАУНД {max(1,D['round'])}/{D['rounds'] or 3}",font=font(18),fill=(200,200,210),anchor='mm')
    d.text((W/2,62),f"{secs//60}:{secs%60:02d}",font=font(34),fill='white',anchor='mm')
    d.text((24,100),f"удары {D['p']['landed']}/{D['p']['thrown']}  блоки {D['p']['blocks']}  уклоны {D['p']['dodges']}  нокдауны {D['p']['kd']}",font=font(15,False),fill=(160,170,190))
    d.text((W-24,100),f"удары {D['o']['landed']}/{D['o']['thrown']}  блоки {D['o']['blocks']}  нокдауны {D['o']['kd']}",font=font(15,False),fill=(160,170,190),anchor='ra')
    for e in D['ev']:
        if e[0]=='HitConfirmed' and e[2]>=2: d.text((wx(D['p' if e[1]==0 else 'o']['pos'])+(0 if e[1] else -40),wy(2.25)),f"{e[2]}-HIT COMBO",font=font(34),fill=(255,210,60),anchor='mm',stroke_width=3,stroke_fill=(0,0,0))
    if D['phase']==1: d.text((W/2,330),str(D['cd']//120+1),font=font(150),fill='white',anchor='mm',stroke_width=6,stroke_fill=(0,0,0))
    if D['phase']==7:
        d.text((W/2,250),str(D['kc']),font=font(140),fill='white',anchor='mm',stroke_width=6,stroke_fill=(0,0,0))
        d.text((W/2,160),'НОКДАУН',font=font(40),fill=(255,90,80),anchor='mm',stroke_width=3,stroke_fill=(0,0,0))
        if D['p']['state']==6:
            d.text((W/2,355),'Поднимите руки в защиту и держите, чтобы встать',font=font(24),fill='white',anchor='mm',stroke_width=2,stroke_fill=(0,0,0))
            bar(d,W/2-200,378,400,16,D['gup']/100,(90,190,255))
    if D['phase']==4:
        d.rectangle([W/2-330,140,W/2+330,470],fill=(10,10,16),outline=(200,170,60),width=3)
        d.text((W/2,185),'ПОБЕДА ИГРОКА' if D['haswin'] and D['win']==0 else ('ПОБЕДА БОТА' if D['haswin'] else 'НИЧЬЯ'),font=font(46),fill=(255,215,90),anchor='mm')
        d.text((W/2,240),RES.get(D['res'],''),font=font(28),fill='white',anchor='mm')
        rows=[('',' ИГРОК','БОТ'),('Удары (попало/выброшено)',f"{D['p']['landed']}/{D['p']['thrown']}",f"{D['o']['landed']}/{D['o']['thrown']}"),('Точность',f"{100*D['p']['landed']//max(1,D['p']['thrown'])}%",f"{100*D['o']['landed']//max(1,D['o']['thrown'])}%"),('Лучшее комбо',D['p']['maxcombo'],D['o']['maxcombo']),('Блоки / уклоны',f"{D['p']['blocks']} / {D['p']['dodges']}",f"{D['o']['blocks']} / {D['o']['dodges']}"),('Нокдауны получено',D['p']['kd'],D['o']['kd'])]
        for i,(a,b,c) in enumerate(rows):
            y=285+i*30; d.text((W/2-300,y),a,font=font(18,i==0),fill=(190,190,205)); d.text((W/2+130,y),str(b),font=font(18),fill=BLUE,anchor='ma'); d.text((W/2+260,y),str(c),font=font(18),fill=RED,anchor='ma')
    d.rectangle([0,H-34,W,H],fill=(0,0,0))
    d.text((14,H-26),f"{title}   ·   кадр симуляции ядра IronEchoRules, тик {t} (120 Гц) · заглушки вместо графики Codex · НЕ Unreal",font=font(14,False),fill=(150,150,160))
    im.save(out)
def first(pred):
    return next(d['t'] for d in L if pred(d))
shots=[
 (first(lambda d:d['phase']==1 and d['cd']<300),'1. Отсчёт перед раундом','01_countdown.png'),
 (first(lambda d:d['phase']==2 and d['p']['block'] and d['o']['state']==1 and d['o']['stage']==2),'2. Игрок держит блок против кросса бота','02_block.png'),
 (first(lambda d:d['phase']==2 and d['p']['dodge'] and d['o']['state']==1 and d['o']['stage']==2),'3. Уклон: удар бота проходит мимо','03_slip.png'),
 (first(lambda d:any(e[0]=='HitConfirmed' and e[1]==0 and e[2]>=3 for e in d['ev'])),'4. Серия игрока: третье чистое попадание подряд','04_combo.png'),
 (first(lambda d:d['phase']==7 and d['o']['state']==6 and d['kc']==6),'5. Бот в нокдауне, счёт рефери','05_knockdown_bot.png'),
 (first(lambda d:d['phase']==7 and d['p']['state']==6 and d['kc']>=1 and d['gup']>=90),'6. Игрок в нокдауне: встаёт, удерживая защиту','06_knockdown_player.png'),
 (len(L)-1,'7. Итог боя и статистика','07_result.png')]
for t,ti,o in shots: frame(t,ti,o); print(o,t)
