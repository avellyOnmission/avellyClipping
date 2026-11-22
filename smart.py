"""Smart highlight refinement: shortlist by motion/audio, read each candidate's
transcript locally, let local Ollama score and title it. Falls back to the
activity score when Ollama is unavailable."""
import json, urllib.request
from highlights import rank
import excite, learn
import numpy as np
from captions import transcribe

SCOUT_MODEL='base'     # deep mode overrides with a stronger model
_=0   # fast reading of candidates; final captions use a better model
OLLAMA='http://127.0.0.1:11434'
PROMPT=('You pick viral short-form clips (Reels/Shorts) from gaming streams, podcasts and vlogs. First decide the content type '
        '(entertainment, gaming reaction, knowledge, opinion, story). Then score the candidate clip.\n'
        'HIGH score: strong emotion (laughter, shock, rage, hype), a surprise or punchline, a quotable line, a clear beginning-to-payoff, '
        'real reactions, a hot take, a funny fail.\n'
        'LOW score: intros/outros, "like and subscribe", sponsor reads, reading chat messages, small talk, silence, half-finished thoughts.\n'
        'Use ONLY words from the transcript; never invent facts.\n'
        'Transcript of a candidate clip:\n"""{t}"""\n'
        'Reply ONLY with JSON: {{"score":1-10,"title":"max 7 words, punchy, English, no quotes","hook":"max 6 words taken or paraphrased from what is SAID, shown on screen in the first 3 seconds"}}')

def _model():
    try:
        tags=json.load(urllib.request.urlopen(OLLAMA+'/api/tags',timeout=3))['models']
        names=[m['name'] for m in tags]
        for pref in ('llama3.2','qwen','gemma','llama'):
            for n in names:
                if pref in n:return n
        return names[0] if names else None
    except Exception:return None

def _ask(model,text):
    body=json.dumps({'model':model,'prompt':PROMPT.format(t=text[:1500]),'stream':False,'format':'json','options':{'temperature':.3}}).encode()
    req=urllib.request.Request(OLLAMA+'/api/generate',body,{'Content-Type':'application/json'})
    out=json.loads(json.load(urllib.request.urlopen(req,timeout=90))['response'])
    return max(1,min(10,float(out.get('score',5)))),str(out.get('title',''))[:70],str(out.get('hook',''))[:50]

def snap(c,words,min_len,max_len):
    """Start where speech starts, end on a sentence end inside [min_len, max_len]. Word times are shifted with the start."""
    if not words:return
    lead=words[0]['start']
    if lead>2.5:
        c['start']=round(c['start']+lead-.4,2)
        for w in words:w['start']=round(w['start']-lead+.4,3);w['end']=round(w['end']-lead+.4,3)
    limit=c['end']-c['start']
    ends=[w['end'] for w in words if w['end']<=min(limit,max_len)]
    good=[w['end'] for w in words if w['end']<=min(limit,max_len) and w['text'].rstrip()[-1:] in '.?!…।' and w['end']>=min_len]
    pick=good[-1] if good else (ends[-1] if ends and ends[-1]>=min_len else None)
    c['end']=round(c['start']+(pick+.3 if pick else min(limit,max_len)),2)

def find(src,duration,count,length,report,language=None,data=None,min_len=None,motion=True,words=None,deep=False,weights=None,select=True):
    """Return up to `count` clips, best first. Always returns `count` when the source is long enough."""
    pool=(count*4+2) if deep else (count*2+1 if count<6 else count+4)
    if not words:pool=count+2 if not deep else min(pool,count*2+2)      # no free transcript: every candidate costs a speech-model pass, so read fewer
    clips=[];extra=excite.seconds_signal(words,duration) if words else None
    weights=weights or dict(learn.DEFAULT)
    while length>=10:
        clips=rank(src,duration,pool,length,lambda s:report(.0+.3*s/max(duration,1),f'Scanning movement + audio: {int(s)}/{int(duration)}s'),motion,extra)
        if len(clips)>=min(pool,count) or duration<length*count*.6 and length<=15:break
        length=max(10,length*.7)   # short source: shrink windows until enough clips fit
    model=_model();engine='motion-audio'
    for i,c in enumerate(clips):
        report(.3+.65*i/len(clips),f'Reading moment {i+1}/{len(clips)}')
        try:
            if words:      # YouTube transcript already in hand: no speech model needed
                from captions_yt import window
                r={'words':window(words,c['start'],c['end']),'language':'yt'}
            else:r=transcribe(src,c['start'],c['end'],data,lambda m:None,language,'small' if deep else SCOUT_MODEL)
            text=' '.join(w['text'] for w in r['words'])
            c['transcript']=text;c['language']=r.get('language');c['words']=r['words'];snap(c,c['words'],min_len or length*.5,length)
            c.setdefault('features',{})['words']=excite.window_score(c['words'],c['end']-c['start'])
            if len(text.split())<4:c['reason']='Mostly gameplay audio';c['llm']=2;c['features']['llm']=.2;continue
            if model:
                ctx=text
                if deep and words:
                    from captions_yt import window
                    ctx='[before] '+' '.join(w['text'] for w in window(words,max(0,c['start']-15),c['start']))+' [CLIP] '+text+' [after] '+' '.join(w['text'] for w in window(words,c['end'],c['end']+15))
                s,t,h=_ask(model,ctx);c.update(llm=s,title=t or c['title'],hook=h,reason=f'AI {s:g}/10 · {model}');c['features']['llm']=s/10;engine='motion-audio+'+model
        except Exception as e:
            c['reason']+=f' (skipped reading: {str(e)[:60]})'
    for c in clips:
        c.setdefault('features',{}).setdefault('words',None)
        c['rank']=learn.score(c['features'],weights)
        c['score']=round(c['rank']*100)
    clips=sorted(clips,key=lambda c:-c['rank'])
    if select:clips=clips[:count]
    return clips,engine
