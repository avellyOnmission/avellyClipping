"""NeonClipping's native layout geometry, shared by browser preview and FFmpeg."""
import math

CATALOG = [
    ('stack', 'Face + gameplay', 'Camera above the action'),
    ('bottom', 'Gameplay + face', 'Camera below the action'),
    ('blur', 'Blurred fill', 'Keep the complete source'),
    ('fill', 'Fill screen', 'Full-frame centre crop'),
    ('game', 'Gameplay only', 'Use your selected game area'),
    ('pip_tl', 'Camera top-left', 'Floating selected facecam'),
    ('pip_tr', 'Camera top-right', 'Floating selected facecam'),
    ('pip_bl', 'Camera bottom-left', 'Floating selected facecam'),
    ('pip_br', 'Camera bottom-right', 'Floating selected facecam'),
    ('circle', 'Circle camera', 'Round facecam above gameplay'),
    ('side', 'Side by side', 'Camera and gameplay columns'),
]

RESOLUTIONS = {
    '1080p': (1080, 1920),
    '1080': (1080, 1920),
    '720p': (720, 1280),
    '720': (720, 1280),
    '360p': (360, 640),
    '360': (360, 640),
}

def get_dimensions(resolution='1080p'):
    return RESOLUTIONS.get(str(resolution).lower(), (1080, 1920))

def text_positions(name, top=.32, caption_y=1450, resolution='1080p'):
    tw, th = get_dimensions(resolution)
    scale = th / 1920.0
    spec = geometry(name, top, resolution)
    cam = next((layer for layer in spec['layers'] if layer['source']=='cam'), None)
    hook_y = int(260 * scale)
    if cam and cam['y'] < 100 * scale:
        hook_y = cam['y'] + cam['h'] + int(30 * scale)
    if name == 'side': hook_y = int(260 * scale)
    scaled_cap_y = int(caption_y * scale)
    if caption_y == 1450 and cam and cam['y'] > 900 * scale:
        scaled_cap_y = min(scaled_cap_y, cam['y'] - int(120 * scale))
    return {'hook_y': hook_y, 'caption_y': scaled_cap_y}

def geometry(name, top=.32, resolution='1080p'):
    if name not in {x[0] for x in CATALOG}:
        raise ValueError('Choose a valid layout.')
    top = float(top)
    if not math.isfinite(top) or not .2 <= top <= .5:
        raise ValueError('Face size must be between 20% and 50%.')
    tw, th = get_dimensions(resolution)
    h = int(top * th) // 2 * 2
    full = {'source': 'full', 'x': 0, 'y': 0, 'w': tw, 'h': th}
    game = {**full, 'source': 'game'}
    if name == 'blur': return {'mode': 'blur', 'layers': []}
    if name == 'fill': return {'mode': 'layers', 'layers': [full]}
    if name == 'game': return {'mode': 'layers', 'layers': [game]}
    if name in ('stack', 'bottom'):
        cam = {'source':'cam', 'x':0, 'y':0 if name == 'stack' else th-h, 'w':tw, 'h':h}
        return {'mode':'layers', 'layers':[
            {**game, 'y':h if name == 'stack' else 0, 'h':th-h}, cam]}
    if name == 'side':
        w = int(top * tw) // 2 * 2
        return {'mode':'layers', 'layers':[
            {**game, 'x':w, 'w':tw-w}, {'source':'cam','x':0,'y':0,'w':w,'h':th}]}
    w = int(top * tw) // 2 * 2
    size = w if name == 'circle' else int(w * .9) // 2 * 2
    right = name in ('pip_tr','pip_br')
    bottom = name in ('pip_bl','pip_br')
    scale = tw / 1080.0
    return {'mode':'layers', 'layers':[game, {
        'source':'cam', 'x':tw-w-int(36*scale) if right else int(36*scale),
        'y':th-size-int(180*scale) if bottom else int(72*scale), 'w':w, 'h':size,
        'circle':name == 'circle'}]}

def render_graph(name, rects, top=.32, resolution='1080p'):
    spec = geometry(name, top, resolution)
    tw, th = get_dimensions(resolution)
    if spec['mode'] == 'blur':
        bw, bh = max(2, tw // 4 // 2 * 2), max(2, th // 4 // 2 * 2)
        return f'[0:v]split=2[b][f];[b]scale={bw}:{bh}:force_original_aspect_ratio=increase,crop={bw}:{bh},boxblur=8:2,scale={tw}:{th}[bg];[f]scale={tw}:{th}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[base]'
    layers = spec['layers']; parts=[]
    if len(layers)>1: parts.append('[0:v]split='+str(len(layers))+''.join(f'[s{i}]' for i in range(len(layers))))
    for i, layer in enumerate(layers):
        source = f'[s{i}]' if len(layers)>1 else '[0:v]'
        crop = ''
        if layer['source'] != 'full':
            x,y,w,h = rects[0 if layer['source']=='cam' else 1]
            crop = f'crop={w}:{h}:{x}:{y},'
        w,h = layer['w'],layer['h']
        mask = ''
        if layer.get('circle'):
            mask = ",format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(X-W/2,2)+pow(Y-H/2,2),pow(min(W,H)/2,2)),255,0)'"
        parts.append(source+crop+f'scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1'+mask+f'[p{i}]')
    first = layers[0]
    parts.append(f"[p0]pad={tw}:{th}:{first['x']}:{first['y']}:black[b0]")
    for i, layer in enumerate(layers[1:],1):
        parts.append(f"[b{i-1}][p{i}]overlay={layer['x']}:{layer['y']}:shortest=1[b{i}]")
    parts.append(f'[b{len(layers)-1}]null[base]')
    return ';'.join(parts)
